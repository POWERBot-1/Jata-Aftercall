/**
 * Procurement (directive module 5, the MGAS bulk-order half)
 *
 * Requisition → purchase order → goods received → supplier bill, on top of the approval object that
 * module 7 shipped. Three properties matter more than the screens:
 *
 * 1. **Nothing is bought without authority.** An order above the requester's limit is submitted for
 *    approval and stays out of "ordered" until somebody spends a grant on it. The grant is the one
 *    `requireApprovalFor` returns; the same single-use rule as expenses applies.
 * 2. **Stock only moves when stock arrives.** Receiving writes `PosInventoryMovement` rows through
 *    the POS store — the same ledger the till uses — so the ERP never keeps a second stock count.
 * 3. **The bill matches the order.** A supplier invoice posts a balanced journal (inventory or cost
 *    of sales, VAT input, accounts payable) and records the variance against the order instead of
 *    quietly agreeing with whatever the supplier typed.
 *
 * Every read and write is tenant-scoped at the query (`businessId` in the `where`), never by a
 * post-hoc comparison.
 */

import { logErpAudit } from "./audit";
import { buildSupplierBillJournal, postJournal } from "./accounting";
import { nextDocumentNumber } from "./sequences";
import { recordMovement } from "../pos/store";
import { createNotification } from "./notifications";
import { normalizeErpRole } from "./access";
import { requireApprovalFor } from "./approvals";

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  AWAITING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

/** 16% is the Kenyan standard rate; 8% covers the few zero-rated-adjacent supplies packs allow. */
export const PURCHASE_TAX_RATES_BPS = [0, 800, 1600] as const;

export function normalizePurchaseOrderStatus(raw: unknown): PurchaseOrderStatus {
  const value = String(raw ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value) ? (value as PurchaseOrderStatus) : "DRAFT";
}

export function isReceivedStatus(status: unknown): boolean {
  const value = normalizePurchaseOrderStatus(status);
  return value === "RECEIVED" || value === "PARTIALLY_RECEIVED";
}

/**
 * The state machine. Deliberately narrow: an order that was received cannot go back to draft, and
 * only an approval (or a limit that did not need one) can make an order placeable.
 */
export function purchaseOrderTransitionAllowed(from: unknown, to: unknown): { ok: boolean; reason?: string } {
  const current = normalizePurchaseOrderStatus(from);
  const next = normalizePurchaseOrderStatus(to);
  if (current === next) return { ok: true };
  const allowed: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
    DRAFT: ["AWAITING_APPROVAL", "APPROVED", "CANCELLED"],
    AWAITING_APPROVAL: ["APPROVED", "CANCELLED"],
    APPROVED: ["ORDERED", "PARTIALLY_RECEIVED", "CANCELLED"],
    ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
    PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED"],
    RECEIVED: [],
    CANCELLED: [],
  };
  if (allowed[current].includes(next)) return { ok: true };
  if (current === "CANCELLED") return { ok: false, reason: "A cancelled order cannot be reopened. Raise a new one." };
  if (current === "RECEIVED") return { ok: false, reason: "This order was fully received; its history is final." };
  return { ok: false, reason: `An order cannot go from ${PURCHASE_ORDER_STATUS_LABELS[current].toLowerCase()} to ${PURCHASE_ORDER_STATUS_LABELS[next].toLowerCase()}.` };
}

export type PurchaseOrderLineInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  unitCostCents: number;
  taxRateBps?: number;
};

export type PurchaseOrderValue = {
  supplierId: string;
  supplierName: string;
  expectedAt: Date | null;
  notes: string | null;
  lines: Array<{
    productId: string | null;
    description: string;
    quantity: number;
    unitCostCents: number;
    taxRateBps: number;
    lineSubtotalCents: number;
    lineTaxCents: number;
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type PurchaseOrderValidation = { ok: boolean; errors: string[]; value: PurchaseOrderValue };

/** Costs are integer cents like every other money column; a fractional cent is a bug, not a rounding. */
function money(raw: unknown, label: string, errors: string[]): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value)) {
    errors.push(`${label} is not a number.`);
    return 0;
  }
  if (!Number.isInteger(value)) {
    errors.push(`${label} must be whole cents.`);
    return 0;
  }
  if (value < 0) {
    errors.push(`${label} cannot be negative.`);
    return 0;
  }
  return value;
}

export function lineTotals(line: { quantity: number; unitCostCents: number; taxRateBps?: number }) {
  const quantity = Math.max(0, Number(line.quantity) || 0);
  const unit = Math.max(0, Math.round(Number(line.unitCostCents) || 0));
  const bps = Math.max(0, Math.round(Number(line.taxRateBps ?? 0) || 0));
  const lineSubtotalCents = Math.round(quantity * unit);
  const lineTaxCents = Math.round((lineSubtotalCents * bps) / 10_000);
  return { lineSubtotalCents, lineTaxCents };
}

export function purchaseOrderTotals(lines: Array<{ quantity: number; unitCostCents: number; taxRateBps?: number }>) {
  return lines.reduce(
    (totals, line) => {
      const one = lineTotals(line);
      return {
        subtotalCents: totals.subtotalCents + one.lineSubtotalCents,
        taxCents: totals.taxCents + one.lineTaxCents,
        totalCents: totals.totalCents + one.lineSubtotalCents + one.lineTaxCents,
      };
    },
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  );
}

export function validatePurchaseOrderInput(input: Partial<PurchaseOrderValue> & { supplierName?: string }): PurchaseOrderValidation {
  const errors: string[] = [];
  const supplierId = String(input.supplierId ?? "").trim();
  if (!supplierId) errors.push("Choose the supplier you are buying from.");
  const supplierName = String(input.supplierName ?? "").trim().slice(0, 160);
  if (input.supplierName !== undefined && supplierName.length < 2) errors.push("The supplier needs a name.");

  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = rawLines.slice(0, 50).map((line, index) => {
    const description = String(line.description ?? "").trim().slice(0, 200);
    const quantity = Number(line.quantity);
    const unitCostCents = money(line.unitCostCents, `Line ${index + 1} unit cost`, errors);
    const taxRateBps = Math.max(0, Math.round(Number(line.taxRateBps ?? 0) || 0));
    if (description.length < 2) errors.push(`Line ${index + 1} needs a description.`);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Line ${index + 1} needs a quantity above zero.`);
    if (taxRateBps > 10_000) errors.push(`Line ${index + 1} has an impossible VAT rate.`);
    const computed = lineTotals({ quantity: Number.isFinite(quantity) ? quantity : 0, unitCostCents, taxRateBps });
    return {
      productId: line.productId ? String(line.productId) : null,
      description,
      quantity: Number.isFinite(quantity) ? Math.round(quantity * 1000) / 1000 : 0,
      unitCostCents,
      taxRateBps,
      ...computed,
    };
  });
  if (lines.length === 0) errors.push("Add at least one line.");

  let expectedAt: Date | null = null;
  if (input.expectedAt) {
    const parsed = input.expectedAt instanceof Date ? input.expectedAt : new Date(input.expectedAt as string);
    if (Number.isNaN(parsed.getTime())) errors.push("That expected date is not a real date.");
    else expectedAt = parsed;
  }

  const totals = purchaseOrderTotals(lines);
  return {
    ok: errors.length === 0,
    errors,
    value: {
      supplierId,
      supplierName,
      expectedAt,
      notes: input.notes ? String(input.notes).trim().slice(0, 4000) : null,
      lines,
      ...totals,
    },
  };
}

export type CreatePurchaseOrderInput = {
  businessId: string;
  supplierId: string;
  supplierName?: string;
  expectedAt?: string | Date | null;
  notes?: string | null;
  lines: PurchaseOrderLineInput[];
  requestedBy: string;
  requestedName?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Raise a draft order. The supplier must belong to this business — a forged POST naming another
 * tenant's supplier id is refused here, not in the form.
 */
export async function createPurchaseOrder(client: any, input: CreatePurchaseOrderInput) {
  const validation = validatePurchaseOrderInput(input as any);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors[0]), { status: 400, errors: validation.errors });
  }
  const value = validation.value;

  const supplier = await client.posSupplier.findFirst({
    where: { id: value.supplierId, businessId: input.businessId },
    select: { id: true, name: true, isActive: true },
  });
  if (!supplier) throw Object.assign(new Error("That supplier is not in this business."), { status: 404 });
  if (supplier.isActive === false) throw Object.assign(new Error("That supplier is no longer active."), { status: 400 });

  if (input.idempotencyKey) {
    const existing = await client.erpPurchaseOrder
      .findUnique({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: String(input.idempotencyKey) } } })
      .catch(() => null);
    if (existing) return { order: existing, created: false, deduplicated: true };
  }

  const orderNumber = await nextDocumentNumber(client, input.businessId, "purchase_order");
  let order;
  try {
    order = await client.erpPurchaseOrder.create({
      data: {
        businessId: input.businessId,
        orderNumber,
        supplierId: supplier.id,
        supplierName: supplier.name,
        status: "DRAFT",
        subtotalCents: value.subtotalCents,
        taxCents: value.taxCents,
        totalCents: value.totalCents,
        expectedAt: value.expectedAt,
        notes: value.notes,
        requestedBy: input.requestedBy,
        requestedName: input.requestedName ?? null,
        idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
        lines: {
          create: value.lines.map((line, index) => ({
            businessId: input.businessId,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitCostCents: line.unitCostCents,
            taxRateBps: line.taxRateBps,
            lineSubtotalCents: line.lineSubtotalCents,
            lineTaxCents: line.lineTaxCents,
            sortOrder: index,
          })),
        },
      },
      include: { lines: true },
    });
  } catch (error: any) {
    if (input.idempotencyKey && String(error?.code ?? "") === "P2002") {
      const existing = await client.erpPurchaseOrder.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: String(input.idempotencyKey) } },
      });
      if (existing) return { order: existing, created: false, deduplicated: true };
    }
    throw error;
  }

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.requestedBy,
    actorName: input.requestedName ?? null,
    action: "PURCHASE_ORDER_CREATED",
    targetType: "PURCHASE_ORDER",
    targetId: order.id,
    after: { orderNumber: order.orderNumber, supplierId: order.supplierId, totalCents: order.totalCents },
    client,
  });

  return { order, created: true, deduplicated: false };
}

export type SubmitPurchaseOrderInput = {
  businessId: string;
  orderId: string;
  requester: { userId: string; name?: string | null; role: string };
  thresholdCents?: number;
};

/**
 * Ask for the order to be placeable.
 *
 * Within the requester's limit it becomes APPROVED at once. Above it, the order waits and a request
 * is raised; submitting again after somebody decides spends the grant and approves the order.
 */
export async function submitPurchaseOrder(client: any, input: SubmitPurchaseOrderInput) {
  const order = await client.erpPurchaseOrder.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
    include: { lines: true },
  });
  if (!order) throw Object.assign(new Error("That purchase order was not found."), { status: 404 });

  const from = normalizePurchaseOrderStatus(order.status);
  if (from !== "DRAFT" && from !== "AWAITING_APPROVAL") {
    throw Object.assign(new Error("This order has already been submitted."), { status: 400 });
  }

  const gate = await requireApprovalFor({
    client,
    businessId: input.businessId,
    requester: { userId: input.requester.userId, name: input.requester.name ?? null, role: input.requester.role },
    kind: "PURCHASE",
    amountCents: Number(order.totalCents ?? 0),
    title: `Purchase order ${order.orderNumber}: ${order.supplierName}`,
    detail: `${(order.lines as any[]).length} line${(order.lines as any[]).length === 1 ? "" : "s"} · ${order.supplierName}`,
    href: `/dashboard/erp/${encodeURIComponent(input.businessId)}/procurement?order=${order.id}`,
    ref: `purchase-order:${order.id}`,
  });

  if (gate.blocked) {
    const updated = await client.erpPurchaseOrder.update({
      where: { id: order.id },
      data: {
        status: "AWAITING_APPROVAL",
        approvalRequestId: gate.request?.id ?? order.approvalRequestId ?? null,
      },
    });
    await logErpAudit({
      businessId: input.businessId,
      actorId: input.requester.userId,
      actorName: input.requester.name ?? null,
      action: "PURCHASE_ORDER_AWAITING_APPROVAL",
      targetType: "PURCHASE_ORDER",
      targetId: order.id,
      after: { status: "AWAITING_APPROVAL", approvalRequestId: gate.request?.id ?? null },
      client,
    });
    return { order: updated, approved: false, blocked: true, reason: gate.gate.reason, requestId: gate.request?.id ?? null };
  }

  if (!purchaseOrderTransitionAllowed(from, "APPROVED").ok) {
    throw Object.assign(new Error("That order cannot be approved from its current state."), { status: 400 });
  }

  const updated = await client.erpPurchaseOrder.update({
    where: { id: order.id },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: input.requester.userId },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.requester.userId,
    actorName: input.requester.name ?? null,
    action: "PURCHASE_ORDER_APPROVED",
    targetType: "PURCHASE_ORDER",
    targetId: order.id,
    before: { status: order.status },
    after: { status: "APPROVED", consumedApproval: (gate as any).consumed?.id ?? null },
    client,
  });
  return { order: updated, approved: true, blocked: false, reason: null, requestId: null };
}

/** Mark an approved order as actually sent to the supplier. Nothing is sent by this app. */
export async function markPurchaseOrderOrdered(
  client: any,
  input: { businessId: string; orderId: string; actorId?: string | null; actorName?: string | null },
) {
  const order = await client.erpPurchaseOrder.findFirst({ where: { id: input.orderId, businessId: input.businessId } });
  if (!order) throw Object.assign(new Error("That purchase order was not found."), { status: 404 });
  const transition = purchaseOrderTransitionAllowed(order.status, "ORDERED");
  if (!transition.ok) throw Object.assign(new Error(transition.reason ?? "That change is not allowed."), { status: 400 });
  // Marking an order twice is a no-op: it must not reset orderedAt or write a second audit row for
  // what is one event. The status machine allows ORDERED -> ORDERED so a retried click stays valid.
  if (normalizePurchaseOrderStatus(order.status) === "ORDERED") return order;
  const updated = await client.erpPurchaseOrder.update({
    where: { id: order.id },
    data: { status: "ORDERED", orderedAt: new Date() },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: "PURCHASE_ORDER_ORDERED",
    targetType: "PURCHASE_ORDER",
    targetId: order.id,
    client,
  });
  return updated;
}

export type ReceiveLine = { lineId: string; quantity: number };

/**
 * Record what actually arrived.
 *
 * Runs in one transaction: receipt + receipt lines + line received-quantity + POS stock movements +
 * the order status. Over-receipt is refused per line rather than silently capped, because "we
 * received 12 of the 10 we ordered" is information somebody has to deal with.
 */
export async function receivePurchaseOrder(
  client: any,
  input: {
    businessId: string;
    orderId: string;
    lines: ReceiveLine[];
    actorId?: string | null;
    actorName?: string | null;
    note?: string | null;
    receivedAt?: Date;
    idempotencyKey?: string | null;
  },
) {
  const order = await client.erpPurchaseOrder.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
    include: { lines: true },
  });
  if (!order) throw Object.assign(new Error("That purchase order was not found."), { status: 404 });
  if (normalizePurchaseOrderStatus(order.status) === "CANCELLED") {
    throw Object.assign(new Error("A cancelled order cannot receive stock."), { status: 400 });
  }
  if (normalizePurchaseOrderStatus(order.status) === "DRAFT" || normalizePurchaseOrderStatus(order.status) === "AWAITING_APPROVAL") {
    throw Object.assign(new Error("This order has not been approved, so nothing can be received against it."), { status: 400 });
  }

  const wanted = input.lines
    .map((line) => ({ lineId: String(line.lineId ?? ""), quantity: Number(line.quantity) || 0 }))
    .filter((line) => line.lineId && line.quantity > 0);
  if (wanted.length === 0) throw Object.assign(new Error("Enter how much arrived on at least one line."), { status: 400 });

  const byLine = new Map((order.lines as any[]).map((line) => [line.id, line]));
  for (const entry of wanted) {
    const line = byLine.get(entry.lineId);
    if (!line) throw Object.assign(new Error("That line is not part of this order."), { status: 400 });
    const outstanding = Number(line.quantity) - Number(line.receivedQuantity ?? 0);
    if (entry.quantity > outstanding + 0.0005) {
      throw Object.assign(
        new Error(`Line “${line.description}” has ${outstanding} outstanding; you cannot receive ${entry.quantity}.`),
        { status: 400 },
      );
    }
  }

  const commit = client.$transaction(async (tx: any) => {
    if (input.idempotencyKey) {
      const existing = await tx.erpGoodsReceipt.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: String(input.idempotencyKey) } },
      });
      if (existing) return { receipt: existing, order, created: false as const };
    }

    const receipt = await tx.erpGoodsReceipt.create({
      data: {
        businessId: input.businessId,
        purchaseOrderId: order.id,
        receivedAt: input.receivedAt ?? new Date(),
        receivedBy: input.actorId ?? null,
        receivedName: input.actorName ?? null,
        note: input.note ? String(input.note).slice(0, 2000) : null,
        idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
      },
    });

    let allReceived = true;
    for (const line of order.lines as any[]) {
      const entry = wanted.find((row) => row.lineId === line.id);
      const quantity = entry ? entry.quantity : 0;
      if (quantity > 0) {
        await tx.erpGoodsReceiptLine.create({
          data: { businessId: input.businessId, receiptId: receipt.id, lineId: line.id, quantity },
        });
        await tx.erpPurchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: Number(line.receivedQuantity ?? 0) + quantity },
        });
        // The stock ledger the till reads. Never a second count kept by this product.
        if (line.productId) {
          await recordMovement(
            input.businessId,
            {
              productId: line.productId,
              reason: "PURCHASE",
              delta: quantity,
              quantity,
              refType: "PURCHASE_ORDER",
              refId: order.id,
              note: `Received on ${order.orderNumber}`,
              createdById: input.actorId ?? undefined,
            },
            tx,
          );
        }
      }
      const nowReceived = Number(line.receivedQuantity ?? 0) + quantity;
      if (nowReceived + 0.0005 < Number(line.quantity)) allReceived = false;
    }

    const status = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
    const updatedOrder = await tx.erpPurchaseOrder.update({
      where: { id: order.id },
      data: { status, receivedAt: allReceived ? new Date() : order.receivedAt ?? null },
    });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      action: "PURCHASE_ORDER_RECEIVED",
      targetType: "PURCHASE_ORDER",
      targetId: order.id,
      after: { receiptId: receipt.id, status, lines: wanted },
      client: tx,
    });

    return { receipt, order: updatedOrder, created: true as const };
  });

  let result: any;
  try {
    result = await commit;
  } catch (error: any) {
    // Two submits with one key: the loser's whole transaction rolled back (no stock moved twice), and
    // it answers with the winner's receipt instead of an error the person cannot act on.
    if (input.idempotencyKey && String(error?.code ?? "") === "P2002") {
      const existing = await client.erpGoodsReceipt.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: String(input.idempotencyKey) } },
      });
      if (existing) {
        const current = await client.erpPurchaseOrder.findFirst({ where: { id: order.id, businessId: input.businessId } });
        return { receipt: existing, order: current ?? order, created: false as const };
      }
    }
    throw error;
  }

  return Promise.resolve(result).then(async (result: any) => {
    if (result.created && order.requestedBy) {
      // The person who raised the order hears what arrived. Best-effort, deduplicated.
      await createNotification(client, {
        businessId: input.businessId,
        kind: "STORE_ORDER",
        title: `Goods received on ${order.orderNumber}`.slice(0, 160),
        body: `${result.order.status === "RECEIVED" ? "The whole order arrived." : "Part of the order arrived."} Stock has been updated.`,
        href: `/dashboard/erp/${encodeURIComponent(input.businessId)}/procurement?order=${order.id}`,
        priority: "NORMAL",
        recipientId: String(order.requestedBy),
        sourceType: "PURCHASE_ORDER",
        sourceId: order.id,
        dedupeKey: `purchase-receipt:${result.receipt.id}`,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
      }).catch(() => null);
    }
    return result;
  });
}

export async function cancelPurchaseOrder(
  client: any,
  input: { businessId: string; orderId: string; reason: string; actorId?: string | null; actorName?: string | null },
) {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw Object.assign(new Error("Say why the order is being cancelled."), { status: 400 });
  const order = await client.erpPurchaseOrder.findFirst({ where: { id: input.orderId, businessId: input.businessId } });
  if (!order) throw Object.assign(new Error("That purchase order was not found."), { status: 404 });
  const transition = purchaseOrderTransitionAllowed(order.status, "CANCELLED");
  if (!transition.ok) throw Object.assign(new Error(transition.reason ?? "That order cannot be cancelled."), { status: 400 });
  const updated = await client.erpPurchaseOrder.update({
    where: { id: order.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: input.actorId ?? null, cancelReason: reason.slice(0, 2000) },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: "PURCHASE_ORDER_CANCELLED",
    targetType: "PURCHASE_ORDER",
    targetId: order.id,
    before: { status: order.status },
    reason,
    client,
  });
  return updated;
}

/**
 * Record the supplier's invoice against the order and post it.
 *
 * Debits inventory when every line is a stocked product (the goods are an asset), cost of sales
 * otherwise; always debits recoverable VAT and credits accounts payable. The variance against the
 * order is returned and audited, never hidden.
 */
export async function recordPurchaseBill(
  client: any,
  input: {
    businessId: string;
    orderId: string;
    billNumber: string;
    netCents: number;
    taxCents: number;
    dueAt?: Date | string | null;
    actorId?: string | null;
    actorName?: string | null;
  },
) {
  const order = await client.erpPurchaseOrder.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
    include: { lines: true },
  });
  if (!order) throw Object.assign(new Error("That purchase order was not found."), { status: 404 });
  if (normalizePurchaseOrderStatus(order.status) === "CANCELLED") {
    throw Object.assign(new Error("A cancelled order cannot be billed."), { status: 400 });
  }
  const billNumber = String(input.billNumber ?? "").trim().slice(0, 80);
  if (billNumber.length < 2) throw Object.assign(new Error("Enter the supplier's invoice number."), { status: 400 });
  const netCents = Math.round(Number(input.netCents) || 0);
  const taxCents = Math.round(Number(input.taxCents) || 0);
  if (!Number.isInteger(Number(input.netCents)) || !Number.isInteger(Number(input.taxCents))) {
    throw Object.assign(new Error("Amounts must be whole cents."), { status: 400 });
  }
  if (netCents < 0 || taxCents < 0) throw Object.assign(new Error("Amounts cannot be negative."), { status: 400 });
  if (netCents + taxCents <= 0) throw Object.assign(new Error("Enter what the supplier is charging."), { status: 400 });

  let dueAt: Date | null = null;
  if (input.dueAt) {
    const parsed = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt as string);
    if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error("That due date is not valid."), { status: 400 });
    dueAt = parsed;
  }

  const stocked = (order.lines as any[]).every((line) => Boolean(line.productId));
  const totalCents = netCents + taxCents;
  const varianceCents = totalCents - Number(order.totalCents ?? 0);

  const existing = await client.erpSupplierBill.findFirst({
    where: { businessId: input.businessId, supplierId: order.supplierId, billNumber },
  });
  if (existing) throw Object.assign(new Error("That supplier invoice number is already recorded."), { status: 400 });

  return client.$transaction(async (tx: any) => {
    const journal = await postJournal(tx, {
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      entryDate: new Date(),
      description: `Supplier bill ${billNumber} · ${order.supplierName}`,
      sourceType: "SUPPLIER_BILL",
      sourceId: order.id,
      lines: buildSupplierBillJournal({
        expenseCode: stocked ? "1200" : "5000",
        netCents,
        taxCents,
        description: `Purchase order ${order.orderNumber}`,
      }),
      idempotencyKey: `supplier-bill:${order.id}:${billNumber}`,
    });

    const bill = await tx.erpSupplierBill.create({
      data: {
        businessId: input.businessId,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        purchaseOrderId: order.id,
        billNumber,
        dueAt,
        subtotalCents: netCents,
        taxCents,
        totalCents,
        status: "OPEN",
        journalId: journal.id,
      },
    });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      action: "SUPPLIER_BILL_POSTED",
      targetType: "PURCHASE_ORDER",
      targetId: order.id,
      after: { billId: bill.id, billNumber, netCents, taxCents, varianceCents, journalNumber: journal.journalNumber },
      client: tx,
    });

    return { bill, journal, varianceCents };
  });
}

export async function listPurchaseOrders(
  client: any,
  input: { businessId: string; status?: string | null; limit?: number },
) {
  const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
  const where: Record<string, unknown> = { businessId: input.businessId };
  if (input.status) where.status = normalizePurchaseOrderStatus(input.status);
  const rows = await client.erpPurchaseOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: { lines: true, receipts: { orderBy: { receivedAt: "desc" }, take: 3 } },
  });
  return rows as any[];
}

export async function purchaseOrderSummary(client: any, businessId: string) {
  const [draft, awaiting, open, received] = await Promise.all([
    client.erpPurchaseOrder.count({ where: { businessId, status: "DRAFT" } }).catch(() => 0),
    client.erpPurchaseOrder.count({ where: { businessId, status: "AWAITING_APPROVAL" } }).catch(() => 0),
    client.erpPurchaseOrder.count({ where: { businessId, status: { in: ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } } }).catch(() => 0),
    client.erpPurchaseOrder.count({ where: { businessId, status: "RECEIVED" } }).catch(() => 0),
  ]);
  return { draft, awaiting, open, received };
}

/** May this role raise and receive purchase orders? Mirrors what the actions enforce. */
export function canManageProcurement(role: string): boolean {
  const normalized = normalizeErpRole(role);
  return normalized !== "VIEWER";
}
