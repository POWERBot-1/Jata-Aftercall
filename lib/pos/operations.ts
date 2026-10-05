/**
 * Running the business (§12, §16, §17, §28, §29, §33)
 *
 * Stock, suppliers, expenses and orders. Same discipline as `sales.ts`: the configuration
 * decides what exists, the actor's permissions decide what they may do, the tenant filter
 * decides which rows they may touch, and every change is written with an audit entry.
 *
 * Nothing here branches on business type (§52). A garage receiving a consignment of brake
 * pads and a bakery receiving flour run the same `receivePurchase`; only the words on screen
 * and the fields on the form differ, and those come from the configuration.
 */

import prisma from "@/lib/db";
import { hasCapability } from "./capabilities";
import { logPosAuditInTransaction } from "./audit";
import { countAdjustment, movementDelta, movementsForTransfer, sanitizeAdjustment } from "./inventory";
import { PAYABLE, RECEIVABLE, validateRepayment } from "./credit";
import { sanitizeAmountKES } from "./money";
import * as store from "./store";
import { initialState, canTransition, nextStates, stateLabel, resolveStates } from "./workflow";
import { resolveTerminology } from "./terminology";
import type { PosActor } from "./sales";
import { actorCan } from "./sales";
import type { PosClient } from "./store";
import type { InventoryMovementReason, PosConfiguration } from "./types";

/** Flat result shape so callers can read `message` under `strictNullChecks: false`. */
export type OperationOutcome<T = Record<string, unknown>> = {
  ok: boolean;
  code?: string;
  message?: string;
  warnings: string[];
} & T;

function failure(code: string, message: string, warnings: string[] = []): OperationOutcome {
  return { ok: false, code, message, warnings };
}

async function inTransaction<T>(client: PosClient | undefined, work: (tx: PosClient) => Promise<T>): Promise<T> {
  if (client && client !== prisma) return work(client);
  return prisma.$transaction(work);
}

function text(value: unknown, max = 200): string | null {
  const clean = typeof value === "string" ? value.replace(/[<>]/g, "").trim() : "";
  return clean ? clean.slice(0, max) : null;
}

function quantity(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.abs(Math.round(parsed * 1000) / 1000), 1_000_000);
}

function words(configuration: PosConfiguration) {
  return resolveTerminology(configuration);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock (§33) — every change has a reason, an actor and a reference
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentOutcome = OperationOutcome<{ quantity?: number; movement?: any }>;

/** A manual stock change: damage, expiry, a found item, an opening balance. */
export async function adjustStock(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  input: Record<string, unknown>;
  client?: PosClient;
}): Promise<AdjustmentOutcome> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.inventory.enabled || !hasCapability(configuration, "stock_adjustments")) {
    return failure("STOCK_TRACKING_OFF", "Stock tracking is switched off for this business.");
  }
  if (!actorCan(actor, "ADJUST_STOCK")) {
    return failure("NOT_ALLOWED", "You don't have permission to adjust stock.");
  }

  const adjustment = sanitizeAdjustment(params.input ?? {});
  if (!adjustment.ok) return failure("INVALID_ADJUSTMENT", adjustment.error ?? "That adjustment could not be saved.", warnings);

  const product = await store.findProduct(businessId, adjustment.productId, client);
  if (!product) return failure("PRODUCT_NOT_FOUND", "That item was not found.", warnings);

  const reason = adjustment.reason as InventoryMovementReason;
  // A stock change lands where the actor's scope says it may (§16, §75).
  const branchDecision = await store.resolveBranch(businessId, actor, adjustment.branchId, client, true);
  if ("code" in branchDecision) return failure(branchDecision.code, branchDecision.message, warnings);
  const branchId = branchDecision.branchId;
  const delta = movementDelta(reason, adjustment.quantity);

  const movement = await inTransaction(params.client, async (tx: PosClient) => {
    const written = await store.recordMovement(
      businessId,
      {
        productId: product.id,
        reason,
        delta,
        quantity: adjustment.quantity,
        unitKey: product.unitKey,
        branchId,
        refType: "ADJUSTMENT",
        note: adjustment.note,
        createdById: actor.actorId,
      },
      tx,
      { configuration },
    );
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_STOCK_ADJUSTED",
      targetType: "PRODUCT",
      targetId: product.id,
      branchId,
      metadata: { reason, delta, note: adjustment.note, productName: product.name },
    });
    return written;
  });

  const level = await store.stockLevels(businessId, [product.id], client);
  const onHand = level
    .filter((item: any) => !branchId || store.branchScope(item.branchId) === store.branchScope(branchId))
    .reduce((total: number, item: any) => total + Number(item.quantity ?? 0), 0);

  return { ok: true, warnings, quantity: onHand, movement };
}

/** Moving stock between locations: two movements that cancel out (§16, §33). */
export async function transferStock(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  productId: string;
  quantity: number;
  fromBranchId: string;
  toBranchId: string;
  note?: string | null;
  client?: PosClient;
}): Promise<OperationOutcome<{ movements?: any[] }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.inventory.enabled || !configuration.inventory.transfers) {
    return failure("TRANSFERS_OFF", "Moving stock between locations is switched off for this business.");
  }
  if (!actorCan(actor, "TRANSFER_STOCK")) {
    return failure("NOT_ALLOWED", "You don't have permission to move stock.");
  }

  const amount = quantity(params.quantity);
  if (amount <= 0) return failure("INVALID_QUANTITY", "Enter a quantity greater than zero.", warnings);
  // Moving stock between locations is by definition cross-scope, so only an actor without a
  // fixed location may do it (§16, §75).
  if (actor.branchId) {
    return failure("NOT_ALLOWED", "Staff assigned to a location can't move stock between locations — ask staff without a fixed location to make the move.", warnings);
  }
  const from = text(params.fromBranchId, 64) ?? store.branchScope(actor.branchId);
  const to = text(params.toBranchId, 64);
  if (!to) return failure("DESTINATION_REQUIRED", "Choose where the stock is going.", warnings);
  if (store.branchScope(from) === store.branchScope(to)) {
    return failure("SAME_LOCATION", "Choose a different location to move it to.", warnings);
  }
  // Both locations must belong to this business — a guessed or foreign branch id moves nothing.
  for (const location of [from, to]) {
    if (!location) continue;
    const branch = await client.posBranch.findFirst({ where: { businessId, id: location, isActive: true } });
    if (!branch) return failure("BRANCH_NOT_FOUND", "That location does not belong to this business.", warnings);
  }

  const product = await store.findProduct(businessId, text(params.productId, 64) ?? "", client);
  if (!product) return failure("PRODUCT_NOT_FOUND", "That item was not found.", warnings);

  const levels = await store.stockLevels(businessId, [product.id], client);
  const available = levels
    .filter((item: any) => store.branchScope(item.branchId) === store.branchScope(from))
    .reduce((total: number, item: any) => total + Number(item.quantity ?? 0), 0);
  if (available < amount) {
    return failure("INSUFFICIENT_STOCK", `Only ${available} ${product.unitKey ?? "units"} available at that location.`, warnings);
  }

  const transferId = `TRF-${Date.now().toString(36).toUpperCase()}`;
  const movements = movementsForTransfer({
    productId: product.id,
    quantity: amount,
    fromBranchId: store.branchScope(from),
    toBranchId: store.branchScope(to),
    transferId,
    unitKey: product.unitKey,
  });

  await inTransaction(params.client, async (tx: PosClient) => {
    for (const movement of movements) {
      await store.recordMovement(
        businessId,
        { ...movement, refType: "TRANSFER", refId: transferId, note: text(params.note, 240), createdById: actor.actorId },
        tx,
        { configuration },
      );
    }
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_STOCK_TRANSFERRED",
      targetType: "PRODUCT",
      targetId: product.id,
      metadata: { transferId, quantity: amount, from, to, productName: product.name },
    });
  });

  return { ok: true, warnings, movements };
}

/** A stock count writes the *difference*, never a new absolute number (§33). */
export async function recordStockCount(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  productId: string;
  counted: number;
  branchId?: string | null;
  note?: string | null;
  client?: PosClient;
}): Promise<OperationOutcome<{ difference?: number; quantity?: number }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.inventory.enabled || !configuration.inventory.stockCounts) {
    return failure("COUNTS_OFF", "Stock counts are switched off for this business.");
  }
  if (!actorCan(actor, "ADJUST_STOCK")) {
    return failure("NOT_ALLOWED", "You don't have permission to adjust stock.");
  }

  const product = await store.findProduct(businessId, text(params.productId, 64) ?? "", client);
  if (!product) return failure("PRODUCT_NOT_FOUND", "That item was not found.", warnings);

  // A count is written where the actor's scope says it may (§16, §75).
  const countBranch = await store.resolveBranch(businessId, actor, params.branchId, client, true);
  if ("code" in countBranch) return failure(countBranch.code, countBranch.message, warnings);
  const branchId = store.branchScope(countBranch.branchId);
  const levels = await store.stockLevels(businessId, [product.id], client);
  const system = levels
    .filter((item: any) => store.branchScope(item.branchId) === branchId)
    .reduce((total: number, item: any) => total + Number(item.quantity ?? 0), 0);
  const difference = countAdjustment(quantity(params.counted), system);

  if (difference === 0) {
    return { ok: true, warnings: ["The count matched the system, so nothing was changed."], difference: 0, quantity: system };
  }

  await inTransaction(params.client, async (tx: PosClient) => {
    await store.recordMovement(
      businessId,
      {
        productId: product.id,
        reason: "COUNT",
        delta: difference,
        quantity: Math.abs(difference),
        unitKey: product.unitKey,
        branchId: branchId || null,
        refType: "COUNT",
        note: text(params.note, 240) ?? `Counted ${quantity(params.counted)}, system said ${system}`,
        createdById: actor.actorId,
      },
      tx,
      { configuration },
    );
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_STOCK_ADJUSTED",
      targetType: "PRODUCT",
      targetId: product.id,
      branchId: branchId || null,
      before: { quantity: system },
      after: { quantity: system + difference },
      metadata: { reason: "COUNT", counted: quantity(params.counted), difference, productName: product.name },
    });
  });

  return { ok: true, warnings, difference, quantity: system + difference };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suppliers, purchase orders and receiving (§12, §30, §33)
// ─────────────────────────────────────────────────────────────────────────────

export type PurchaseLineInput = { productId?: string | null; name?: string | null; quantity: number; unitCostKES?: number | null; unitKey?: string | null };

export async function createPurchase(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  supplierId?: string | null;
  items: PurchaseLineInput[];
  reference?: string | null;
  expectedAt?: Date | string | null;
  notes?: string | null;
  receiveNow?: boolean;
  client?: PosClient;
}): Promise<OperationOutcome<{ purchase?: any }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.suppliers.enabled) {
    return failure("SUPPLIERS_OFF", `Your POS is not set up with ${words(configuration).supplier.toLowerCase()} records yet.`);
  }
  if (!actorCan(actor, "CREATE_PURCHASE")) {
    return failure("NOT_ALLOWED", "You don't have permission to record a purchase.");
  }

  const lines = (params.items ?? []).filter((item) => item && typeof item === "object");
  if (!lines.length) return failure("NO_ITEMS", "Add at least one item to the order.", warnings);

  const supplier = params.supplierId ? await store.findSupplier(businessId, text(params.supplierId, 64) ?? "", client) : null;
  if (params.supplierId && !supplier) return failure("SUPPLIER_NOT_FOUND", "That supplier was not found.", warnings);

  const products = await store.findProductsByIds(businessId, lines.map((line) => line.productId ?? ""), client);
  const byId = new Map<string, any>(products.map((product: any) => [product.id, product] as [string, any]));

  const reference = text(params.reference, 40) ?? (await store.nextPurchaseReference(businessId, client));
  const items: { productId: string | null; name: string; unitKey: string | null; quantity: number; unitCostKES: number; totalKES: number }[] = [];

  for (const line of lines) {
    const amount = quantity(line.quantity);
    if (amount <= 0) continue;
    const product = line.productId ? byId.get(String(line.productId)) : null;
    const name = product ? String(product.name) : text(line.name, 160);
    if (!name) {
      warnings.push("A line without an item name was left out.");
      continue;
    }
    // The server's cost price is used unless the actor may change prices (§56).
    const serverCost = product?.costKES != null ? sanitizeAmountKES(product.costKES) : 0;
    const requested = line.unitCostKES == null ? null : sanitizeAmountKES(line.unitCostKES);
    const unitCostKES = requested != null && requested !== serverCost
      ? actorCan(actor, "EDIT_PRICE") ? requested : (warnings.push(`${name} was recorded at its usual cost.`), serverCost)
      : serverCost || sanitizeAmountKES(requested);
    items.push({
      productId: product?.id ?? null,
      name,
      unitKey: text(line.unitKey, 24) ?? product?.unitKey ?? null,
      quantity: amount,
      unitCostKES,
      totalKES: Math.round(unitCostKES * amount),
    });
  }

  if (!items.length) return failure("NO_ITEMS", "Add at least one item to the order.", warnings);

  const subtotalKES = items.reduce((total, item) => total + item.totalKES, 0);
  // A business that does not use purchase orders is recording stock that has arrived, which is
  // what the purchase screen assumes. Status, received quantities and stock movements must all
  // agree: a purchase may never claim to be RECEIVED without stock actually coming in (§12, §33).
  const receiveNow = params.receiveNow === true
    || (params.receiveNow === undefined && !configuration.suppliers.purchaseOrders);

  const purchase = await inTransaction(params.client, async (tx: PosClient) => {
    const created = await tx.posPurchase.create({
      data: {
        businessId,
        supplierId: supplier?.id ?? null,
        branchId: actor.branchId,
        reference,
        status: receiveNow ? "RECEIVED" : "ORDERED",
        subtotalKES,
        totalKES: subtotalKES,
        paidKES: 0,
        expectedAt: params.expectedAt ? new Date(params.expectedAt) : null,
        receivedAt: receiveNow ? new Date() : null,
        notes: text(params.notes, 1000),
        createdById: actor.actorId,
      },
    });

    for (const item of items) {
      await tx.posPurchaseItem.create({
        data: {
          businessId,
          purchaseId: created.id,
          productId: item.productId,
          name: item.name,
          unitKey: item.unitKey,
          quantity: item.quantity,
          receivedQty: receiveNow ? item.quantity : 0,
          unitCostKES: item.unitCostKES,
          totalKES: item.totalKES,
        },
      });
    }

    // Supplier credit: what we owe goes on the payables ledger, never the receivables one (§30).
    if (supplier && configuration.suppliers.credit && subtotalKES > 0) {
      await store.applyBalanceChange(
        businessId,
        { partyType: PAYABLE, partyId: supplier.id, partyName: supplier.name },
        {
          deltaKES: subtotalKES,
          direction: "DEBIT",
          dueAt: configuration.suppliers.termsDays > 0
            ? new Date(Date.now() + configuration.suppliers.termsDays * 86_400_000)
            : null,
          note: `Purchase ${reference}`,
        },
        tx,
      );
    }

    if (receiveNow) {
      for (const item of items) {
        if (!item.productId) continue;
        await store.recordMovement(
          businessId,
          {
            productId: item.productId,
            reason: "PURCHASE",
            delta: item.quantity,
            quantity: item.quantity,
            unitKey: item.unitKey,
            branchId: actor.branchId,
            refType: "PURCHASE",
            refId: created.id,
            note: `Received on ${reference}`,
            createdById: actor.actorId,
          },
          tx,
          { configuration },
        );
      }
    }

    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_PURCHASE_RECORDED",
      targetType: "PURCHASE",
      targetId: created.id,
      metadata: { reference, totalKES: subtotalKES, items: items.length, supplierId: supplier?.id ?? null, receiveNow },
    });

    return created;
  });

  return { ok: true, warnings, purchase };
}

/**
 * Receives stock against a purchase order, wholly or in part (§12). Each received line writes
 * its own PURCHASE movement, so the ledger shows exactly what arrived and when.
 */
export async function receivePurchase(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  purchaseId: string;
  items?: { purchaseItemId: string; quantity: number }[];
  payment?: { amountKES: number; method?: string | null; reference?: string | null } | null;
  client?: PosClient;
}): Promise<OperationOutcome<{ purchase?: any; received?: number }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.suppliers.enabled) return failure("SUPPLIERS_OFF", "Purchases are switched off for this business.");
  if (!actorCan(actor, "CREATE_PURCHASE")) return failure("NOT_ALLOWED", "You don't have permission to receive stock.");

  const purchase = await store.findPurchase(businessId, text(params.purchaseId, 64) ?? "", client);
  if (!purchase) return failure("PURCHASE_NOT_FOUND", "That purchase order was not found.", warnings);
  if (purchase.status === "CANCELLED") return failure("CANCELLED", "That purchase order was cancelled.", warnings);

  // Receiving moves stock; stock moves only where the actor's scope allows it (§16, §75).
  // An order placed at a different location than a branch-bound actor's is refused rather than
  // silently received into someone else's stock room.
  if (actor.branchId && purchase.branchId && purchase.branchId !== actor.branchId) {
    return failure("BRANCH_OUT_OF_SCOPE", "That order belongs to a different location than the one you are assigned to.", warnings);
  }

  const requested = new Map<string, number>(
    (params.items ?? []).filter((item) => item && typeof item === "object").map((item) => [String(item.purchaseItemId), quantity(item.quantity)] as [string, number]),
  );

  const lines: { item: any; amount: number }[] = [];
  for (const item of purchase.items ?? []) {
    const outstanding = Math.max(0, Number(item.quantity ?? 0) - Number(item.receivedQty ?? 0));
    if (outstanding <= 0) continue;
    const asked = requested.size ? requested.get(item.id) ?? 0 : outstanding;
    const amount = configuration.suppliers.partialReceiving ? Math.min(asked, outstanding) : asked >= outstanding ? outstanding : 0;
    if (amount <= 0) continue;
    lines.push({ item, amount });
  }
  if (!lines.length) return failure("NOTHING_TO_RECEIVE", "Everything on that order has already been received.", warnings);
  if (requested.size && !configuration.suppliers.partialReceiving) {
    warnings.push("Partial receiving is switched off, so the full outstanding quantity was received.");
  }

  const receivedValue = lines.reduce((total, line) => total + Math.round(Number(line.item.unitCostKES ?? 0) * line.amount), 0);
  const paymentAmount = params.payment ? sanitizeAmountKES(params.payment.amountKES) : 0;

  const updated = await inTransaction(params.client, async (tx: PosClient) => {
    let received = 0;
    for (const line of lines) {
      await tx.posPurchaseItem.updateMany({
        where: { businessId, id: line.item.id, purchaseId: purchase.id },
        data: { receivedQty: Number(line.item.receivedQty ?? 0) + line.amount },
      });
      if (line.item.productId) {
        await store.recordMovement(
          businessId,
          {
            productId: line.item.productId,
            reason: "PURCHASE",
            delta: line.amount,
            quantity: line.amount,
            unitKey: line.item.unitKey,
            branchId: purchase.branchId ?? actor.branchId,
            refType: "PURCHASE",
            refId: purchase.id,
            note: `Received on ${purchase.reference}`,
            createdById: actor.actorId,
          },
          tx,
          { configuration },
        );
      }
      received += line.amount;
    }

    const allReceived = (purchase.items ?? []).every((item: any) => {
      const extra = lines.find((line) => line.item.id === item.id);
      const total = Number(item.receivedQty ?? 0) + (extra?.amount ?? 0);
      return total >= Number(item.quantity ?? 0);
    });
    const status = allReceived ? "RECEIVED" : "PARTIAL";
    const paidKES = Number(purchase.paidKES ?? 0) + paymentAmount;

    await tx.posPurchase.updateMany({
      where: { businessId, id: purchase.id },
      data: { status, receivedAt: new Date(), paidKES },
    });

    if (paymentAmount > 0 && purchase.supplierId) {
      const supplier = await store.findSupplier(businessId, purchase.supplierId, tx);
      await tx.posPayment.create({
        data: {
          businessId,
          supplierId: purchase.supplierId,
          branchId: purchase.branchId ?? actor.branchId,
          direction: "OUT",
          purpose: "SUPPLIER_PAYMENT",
          method: text(params.payment?.method, 32) ?? "cash",
          amountKES: paymentAmount,
          reference: text(params.payment?.reference, 80),
          status: "SETTLED",
          notes: `Payment for ${purchase.reference}`,
          createdById: actor.actorId,
        },
      });
      if (supplier) {
        await store.applyBalanceChange(
          businessId,
          { partyType: PAYABLE, partyId: supplier.id, partyName: supplier.name },
          { deltaKES: -paymentAmount, direction: "CREDIT", note: `Payment for ${purchase.reference}` },
          tx,
        );
      }
    }

    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_PURCHASE_RECEIVED",
      targetType: "PURCHASE",
      targetId: purchase.id,
      before: { status: purchase.status },
      after: { status },
      metadata: { reference: purchase.reference, received, receivedValueKES: receivedValue, paymentKES: paymentAmount },
    });

    return { received, status };
  });

  return { ok: true, warnings, received: updated.received, purchase: await store.findPurchase(businessId, purchase.id, client) };
}

/** Pays a supplier down — the payables side of the credit engine (§30, §31). */
export async function paySupplier(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  supplierId: string;
  amountKES: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  client?: PosClient;
}): Promise<OperationOutcome<{ balanceKES?: number; amountKES?: number }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.suppliers.enabled) return failure("SUPPLIERS_OFF", "Suppliers are switched off for this business.");
  if (!actorCan(actor, "RECORD_SUPPLIER_PAYMENT")) {
    return failure("NOT_ALLOWED", "You don't have permission to pay a supplier.");
  }

  const supplier = await store.findSupplier(businessId, text(params.supplierId, 64) ?? "", client);
  if (!supplier) return failure("SUPPLIER_NOT_FOUND", "That supplier was not found.", warnings);

  const check = validateRepayment(Number(supplier.balanceKES ?? 0), sanitizeAmountKES(params.amountKES));
  if (!check.ok) return failure("PAYMENT_INVALID", check.message ?? "That payment could not be recorded.", warnings);

  await inTransaction(params.client, async (tx: PosClient) => {
    const payment = await tx.posPayment.create({
      data: {
        businessId,
        supplierId: supplier.id,
        branchId: actor.branchId,
        direction: "OUT",
        purpose: "SUPPLIER_PAYMENT",
        method: text(params.method, 32) ?? "cash",
        amountKES: check.amountKES,
        reference: text(params.reference, 80),
        status: "SETTLED",
        notes: text(params.note, 500),
        createdById: actor.actorId,
      },
    });
    await store.applyBalanceChange(
      businessId,
      { partyType: PAYABLE, partyId: supplier.id, partyName: supplier.name },
      { deltaKES: -check.amountKES, direction: "CREDIT", paymentId: payment.id, note: text(params.note) ?? "Supplier payment" },
      tx,
    );
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_SUPPLIER_PAYMENT_RECORDED",
      targetType: "SUPPLIER",
      targetId: supplier.id,
      before: { balanceKES: Number(supplier.balanceKES ?? 0) },
      after: { balanceKES: check.newBalanceKES },
      metadata: { amountKES: check.amountKES, method: payment.method },
    });
  });

  return { ok: true, warnings, amountKES: check.amountKES, balanceKES: check.newBalanceKES };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expenses (§17)
// ─────────────────────────────────────────────────────────────────────────────

export async function recordExpense(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  input: { categoryKey: string; label?: string | null; amountKES: number; method?: string | null; reference?: string | null; occurredAt?: Date | string | null; notes?: string | null };
  client?: PosClient;
}): Promise<OperationOutcome<{ expense?: any }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.expenses.enabled) return failure("EXPENSES_OFF", "Expense tracking is switched off for this business.");
  if (!actorCan(actor, "CREATE_EXPENSE")) return failure("NOT_ALLOWED", "You don't have permission to record an expense.");

  const amountKES = sanitizeAmountKES(params.input?.amountKES);
  if (amountKES <= 0) return failure("INVALID_AMOUNT", "Enter an amount greater than zero.", warnings);

  const requested = text(params.input?.categoryKey, 40) ?? "other";
  const allowed = configuration.expenses.categories ?? [];
  const categoryKey = allowed.includes(requested) ? requested : "other";
  if (categoryKey !== requested) {
    warnings.push(`"${requested}" is not one of your expense categories, so it was saved as Other.`);
  }

  const expense = await inTransaction(params.client, async (tx: PosClient) => {
    const created = await store.createExpense(
      businessId,
      {
        categoryKey,
        label: text(params.input?.label, 120),
        amountKES,
        method: text(params.input?.method, 32) ?? "cash",
        reference: text(params.input?.reference, 80),
        occurredAt: params.input?.occurredAt ?? null,
        notes: text(params.input?.notes, 1000),
        branchId: actor.branchId,
        createdById: actor.actorId,
      },
      tx,
    );
    if (created) {
      // Money left the business: record it so the cash report balances against the ledger,
      // whatever the method (§35, §57). A cash expense is the one that empties the drawer —
      // the daily closing reads these rows, not the expense table.
      await tx.posPayment.create({
        data: {
          businessId,
          branchId: actor.branchId,
          direction: "OUT",
          purpose: "EXPENSE",
          method: text(params.input?.method, 32) ?? "cash",
          amountKES,
          reference: text(params.input?.reference, 80),
          status: "SETTLED",
          notes: text(params.input?.label, 120) ?? categoryKey,
          createdById: actor.actorId,
        },
      });
    }
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_EXPENSE_RECORDED",
      targetType: "EXPENSE",
      targetId: created?.id ?? null,
      metadata: { categoryKey, amountKES },
    });
    return created;
  });

  return { ok: true, warnings, expense };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders and the configured lifecycle (§28, §29)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderItemInput = { productId?: string | null; name?: string | null; quantity: number; unitPriceKES?: number | null; modifiers?: string | null };

export async function createOrder(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  input: {
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    channel?: string | null;
    items: OrderItemInput[];
    fulfilment?: string | null;
    address?: string | null;
    expectedAt?: Date | string | null;
    depositKES?: number | null;
    notes?: string | null;
    assignedToId?: string | null;
  };
  client?: PosClient;
}): Promise<OperationOutcome<{ order?: any }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!configuration.orders.enabled) return failure("ORDERS_OFF", `${words(configuration).order} tracking is switched off for this business.`);
  if (!actorCan(actor, "MANAGE_ORDERS")) return failure("NOT_ALLOWED", `You don't have permission to create a ${words(configuration).order.toLowerCase()}.`);

  const lines = (params.input?.items ?? []).filter((item) => item && typeof item === "object");
  if (!lines.length) return failure("NO_ITEMS", "Add at least one item.", warnings);

  const products = await store.findProductsByIds(businessId, lines.map((line) => line.productId ?? ""), client);
  const byId = new Map<string, any>(products.map((product: any) => [product.id, product] as [string, any]));

  const items: { productId: string | null; name: string; quantity: number; unitKey: string | null; unitPriceKES: number; totalKES: number; modifiers: string | null }[] = [];
  for (const line of lines) {
    const amount = quantity(line.quantity);
    if (amount <= 0) continue;
    const product = line.productId ? byId.get(String(line.productId)) : null;
    const name = product ? String(product.name) : text(line.name, 160);
    if (!name) continue;
    // Prices come from the catalogue; an override needs EDIT_PRICE (§56).
    const serverPrice = product ? sanitizeAmountKES(product.priceKES) : 0;
    const requested = line.unitPriceKES == null ? null : sanitizeAmountKES(line.unitPriceKES);
    const unitPriceKES = requested != null && requested !== serverPrice
      ? actorCan(actor, "EDIT_PRICE") ? requested : (warnings.push(`${name} was priced from your price list.`), serverPrice)
      : serverPrice || sanitizeAmountKES(requested);
    items.push({
      productId: product?.id ?? null,
      name,
      quantity: amount,
      unitKey: product?.unitKey ?? null,
      unitPriceKES,
      totalKES: Math.round(unitPriceKES * amount),
      modifiers: text(line.modifiers, 1000),
    });
  }
  if (!items.length) return failure("NO_ITEMS", "Add at least one item.", warnings);

  const subtotalKES = items.reduce((total, item) => total + item.totalKES, 0);
  const customer = params.input?.customerId ? await store.findCustomer(businessId, text(params.input.customerId, 64) ?? "", client) : null;
  if (params.input?.customerId && !customer) return failure("CUSTOMER_NOT_FOUND", `That ${words(configuration).customer.toLowerCase()} was not found.`, warnings);

  const workflowKey = configuration.orders.workflowKey;
  const stateKey = initialState(workflowKey);
  const channel = normalizeOrderChannel(params.input?.channel, configuration);
  const depositKES = configuration.sales.deposits ? Math.min(sanitizeAmountKES(params.input?.depositKES), subtotalKES) : 0;
  const prefix = (words(configuration).order || "Order").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "ORD";
  const reference = await store.nextOrderReference(businessId, prefix, client);

  const order = await inTransaction(params.client, async (tx: PosClient) => {
    const created = await tx.posOrder.create({
      data: {
        businessId,
        branchId: actor.branchId,
        reference,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? text(params.input?.customerName, 160),
        customerPhone: customer?.phone ?? text(params.input?.customerPhone, 32),
        staffId: actor.staffId,
        assignedToId: text(params.input?.assignedToId, 64),
        channel,
        workflowKey,
        stateKey,
        fulfilment: text(params.input?.fulfilment, 32),
        address: text(params.input?.address, 240),
        subtotalKES,
        totalKES: subtotalKES,
        depositKES,
        expectedAt: params.input?.expectedAt ? new Date(params.input.expectedAt) : null,
        notes: text(params.input?.notes, 1000),
        createdById: actor.actorId,
      },
    });

    for (const item of items) {
      await tx.posOrderItem.create({
        data: {
          businessId,
          orderId: created.id,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitKey: item.unitKey,
          unitPriceKES: item.unitPriceKES,
          totalKES: item.totalKES,
          modifiers: item.modifiers,
        },
      });
    }

    await tx.posOrderEvent.create({
      data: { businessId, orderId: created.id, fromState: null, toState: stateKey, note: "Created", createdById: actor.actorId },
    });

    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_ORDER_CREATED",
      targetType: "ORDER",
      targetId: created.id,
      metadata: { reference, channel, stateKey, workflowKey, totalKES: subtotalKES, items: items.length },
    });

    return created;
  });

  return { ok: true, warnings, order };
}

/**
 * Moves an order through its configured lifecycle. The workflow — not the browser — decides
 * which moves exist, and an illegal move is refused with the states that *are* available (§29).
 */
export async function moveOrder(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  orderId: string;
  toState: string;
  note?: string | null;
  client?: PosClient;
}): Promise<OperationOutcome<{ order?: any; fromState?: string; toState?: string }>> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  const order = await store.findOrder(businessId, text(params.orderId, 64) ?? "", client);
  if (!order) return failure("ORDER_NOT_FOUND", `That ${words(configuration).order.toLowerCase()} was not found.`, warnings);
  // A ticket belongs to the location it was taken at (§16, §75). Moving one is a write, so a
  // branch-bound actor naming another location's order is refused with the reason rather than
  // having the move quietly land somewhere else.
  if (!store.branchRecordInScope(actor, order.branchId)) {
    return failure("BRANCH_OUT_OF_SCOPE", store.branchOutOfScopeMessage(), warnings);
  }

  const toState = text(params.toState, 40) ?? "";
  const cancelling = toState.toUpperCase() === "CANCELLED";
  const permission = cancelling ? "CANCEL_ORDER" : "MANAGE_ORDERS";
  if (!actorCan(actor, permission)) {
    return failure("NOT_ALLOWED", cancelling ? "You don't have permission to cancel." : "You don't have permission to move this along.");
  }

  const states = resolveStates(configuration).map((state) => state.key);
  if (toState && !states.includes(toState)) {
    return failure("UNKNOWN_STATE", `"${toState}" is not one of your ${words(configuration).order.toLowerCase()} stages.`, warnings);
  }
  if (!canTransition(order.workflowKey, order.stateKey, toState)) {
    const allowed = nextStates(order.workflowKey, order.stateKey).map((state) => state.label);
    return failure(
      "INVALID_TRANSITION",
      allowed.length
        ? `From "${stateLabel(order.workflowKey, order.stateKey)}" you can move to: ${allowed.join(", ")}.`
        : `This ${words(configuration).order.toLowerCase()} is closed and can't be moved.`,
      warnings,
    );
  }

  await inTransaction(params.client, async (tx: PosClient) => {
    await tx.posOrder.updateMany({ where: { businessId, id: order.id }, data: { stateKey: toState } });
    await tx.posOrderEvent.create({
      data: {
        businessId,
        orderId: order.id,
        fromState: order.stateKey,
        toState,
        note: text(params.note, 240),
        createdById: actor.actorId,
      },
    });
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_ORDER_STATE_CHANGED",
      targetType: "ORDER",
      targetId: order.id,
      before: { stateKey: order.stateKey },
      after: { stateKey: toState },
      metadata: { reference: order.reference, note: text(params.note, 240) },
    });
  });

  return { ok: true, warnings, fromState: order.stateKey, toState, order: await store.findOrder(businessId, order.id, client) };
}

function normalizeOrderChannel(value: unknown, configuration: PosConfiguration): string {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const configured = configuration.orders.channels ?? [];
  if (configured.includes(raw as never)) return raw;
  return configured[0] ?? "walk_in";
}

/** Which customer ledger a repayment belongs to — kept separate by design (§30). */
export const CUSTOMER_LEDGER = RECEIVABLE;
export const SUPPLIER_LEDGER = PAYABLE;
