/**
 * Selling (§27, §31, §33, §54, §62)
 *
 * One engine, one transaction. A sale is priced by `money.ts` from the *server's* copy of the
 * product and the configuration — never from numbers the browser asserts (§56). Money, stock,
 * credit and the audit trail are written together, so a sale can never leave stock moved
 * without a payment row, or a balance changed without a ledger entry (§30, §33).
 *
 * Corrections never rewrite history: a refund, a return or a void adds rows and moves the
 * running totals forward (§54).
 */

import prisma from "@/lib/db";
import { hasCapability } from "./capabilities";
import { decideCredit, validateRepayment, RECEIVABLE } from "./credit";
import { checkAvailability, movementsForReturn, movementsForSale } from "./inventory";
import { calculateSale, discountFromPercent, isCreditMethod, sanitizeAmountKES, validatePayments, validateRefund } from "./money";
import { logPosAuditInTransaction } from "./audit";
import { buildReceipt, formatReceiptNumber, receiptPrefixFromBusinessName, receiptToText } from "./receipt";
import type { ReceiptBusiness } from "./receipt";
import * as store from "./store";
import { resolveTerminology } from "./terminology";
import type { PermissionKey } from "./permissions";
import type { PosClient } from "./store";
import type { ChannelKey, PosConfiguration, ReceiptDocument, SaleLineInput, SaleTotals } from "./types";

/** Who is acting, resolved server-side by `guard.ts` — never taken from the request body (§5). */
export type PosActor = {
  actorId: string | null;
  actorName: string | null;
  roleKey: string;
  permissions: PermissionKey[];
  staffId: string | null;
  branchId: string | null;
};

export function actorCan(actor: PosActor, permission: PermissionKey): boolean {
  return (actor.permissions ?? []).includes(permission);
}

export type SaleItemRequest = {
  productId?: string | null;
  /** Free-text line, honoured only when the configuration allows custom items (§13). */
  name?: string | null;
  quantity?: number;
  /** Price override — ignored unless the actor holds EDIT_PRICE (§36, §56). */
  unitPriceKES?: number | null;
  discountKES?: number | null;
  discountPercent?: number | null;
  unitKey?: string | null;
  variantDesc?: string | null;
};

export type SalePaymentRequest = {
  method: string;
  amountKES: number;
  reference?: string | null;
};

export type SaleRequest = {
  items: SaleItemRequest[];
  payments?: SalePaymentRequest[];
  customerId?: string | null;
  staffId?: string | null;
  branchId?: string | null;
  channel?: string | null;
  notes?: string | null;
  kind?: "SALE" | "QUOTATION" | "INVOICE";
  /** Whole-sale discount in shillings, or a percentage of the subtotal. */
  discountKES?: number | null;
  discountPercent?: number | null;
  /** Delivery or other configured fee (§8). Capped at the configured fee. */
  feeKES?: number | null;
};

export type SaleOutcome = {
  ok: boolean;
  code?: string;
  /** Plain language, safe to show at the till (§38). */
  message?: string;
  warnings: string[];
  sale?: any;
  totals?: SaleTotals;
  receipt?: ReceiptDocument;
  receiptText?: string;
  creditKES?: number;
  changeKES?: number;
  balanceKES?: number;
  shortages?: { name: string; requested: number; available: number; unitKey?: string }[];
};

function problem(code: string, message: string, warnings: string[] = []): SaleOutcome {
  return { ok: false, code, message, warnings };
}

/**
 * Runs writes atomically. When the caller is already inside a transaction (a payment
 * settlement, a bulk import) its client is reused instead of nesting one.
 */
async function inTransaction<T>(client: PosClient | undefined, work: (tx: PosClient) => Promise<T>): Promise<T> {
  if (client && client !== prisma) return work(client);
  return prisma.$transaction(work);
}

/** Channels arrive from many surfaces; the engine stores its own spelling (§28, §70). */
export function normalizeChannel(value: unknown): ChannelKey {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const known: ChannelKey[] = ["walk_in", "phone", "whatsapp", "business_page", "online", "staff", "delivery", "other"];
  return (known.includes(raw as ChannelKey) ? raw : "walk_in") as ChannelKey;
}

function clampQuantity(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed * 1000) / 1000, 100000);
}

function clampNote(value: unknown, max = 500): string | null {
  const text = typeof value === "string" ? value.replace(/[<>]/g, "").trim() : "";
  return text ? text.slice(0, max) : null;
}

/**
 * Turns a till request into priced lines. Prices come from the product record; a discount or a
 * price change is applied only when both the configuration and the actor's role allow it, and
 * anything refused is reported back in plain language rather than silently changing the total.
 */
async function resolveLines(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  request: SaleRequest;
  warnings: string[];
  client: PosClient;
}): Promise<{ lines: SaleLineInput[]; variants: Record<string, string | null>; costKES: number } | SaleOutcome> {
  const { businessId, configuration, actor, request, warnings, client } = params;
  const items = (request.items ?? []).filter((item) => item && typeof item === "object");
  if (!items.length) return problem("EMPTY_SALE", "Add something to the sale first.");

  const products = await store.findProductsByIds(businessId, items.map((item) => item.productId ?? ""), client);
  const byId = new Map<string, any>(products.map((product: any) => [product.id, product] as [string, any]));

  const lines: SaleLineInput[] = [];
  const variants: Record<string, string | null> = {};
  let costKES = 0;

  for (const item of items) {
    const quantity = clampQuantity(item.quantity ?? 1);
    if (quantity <= 0) {
      warnings.push("A line with no quantity was left out.");
      continue;
    }

    const product = item.productId ? byId.get(String(item.productId)) : null;

    if (!product) {
      const customAllowed = configuration.sales.customOrders || hasCapability(configuration, "custom_orders");
      const name = clampNote(item.name, 120);
      if (!customAllowed || !name) {
        return problem("PRODUCT_NOT_FOUND", "One of those items is not on your price list. Add it first, then sell it.");
      }
      const unitPrice = sanitizeAmountKES(item.unitPriceKES);
      if (unitPrice <= 0 && !actorCan(actor, "EDIT_PRICE")) {
        return problem("PRICE_REQUIRED", "Enter a price for that item.");
      }
      lines.push({ name, kind: "SERVICE", quantity, unitPriceKES: unitPrice, discountKES: 0, unitKey: undefined });
      variants[name] = clampNote(item.variantDesc, 120);
      continue;
    }

    if (product.isActive === false) {
      return problem("PRODUCT_UNAVAILABLE", `${product.name} is not on sale right now.`);
    }

    const kind = product.kind === "SERVICE" ? "SERVICE" : "PRODUCT";
    if (kind === "PRODUCT" && !configuration.sales.products) {
      return problem("PRODUCTS_NOT_CONFIGURED", "Your POS is not set up to sell products yet.");
    }
    if (kind === "SERVICE" && !configuration.sales.services) {
      return problem("SERVICES_NOT_CONFIGURED", "Your POS is not set up to sell services yet.");
    }

    // §56: the till price is the server's price. An override needs EDIT_PRICE.
    let unitPrice = sanitizeAmountKES(product.priceKES);
    const requestedPrice = item.unitPriceKES == null ? null : sanitizeAmountKES(item.unitPriceKES);
    if (requestedPrice != null && requestedPrice !== unitPrice) {
      if (actorCan(actor, "EDIT_PRICE")) {
        unitPrice = requestedPrice;
      } else {
        warnings.push(`${product.name} was sold at its list price — changing a price needs permission.`);
      }
    }
    // Wholesale price only when the configuration offers it (§8, §18).
    if (
      unitPrice === sanitizeAmountKES(product.priceKES) &&
      configuration.sales.wholesalePricing &&
      product.wholesalePriceKES != null &&
      quantity >= 12
    ) {
      unitPrice = Math.min(unitPrice, sanitizeAmountKES(product.wholesalePriceKES));
    }

    let lineDiscount = 0;
    const requestedDiscount = Math.max(sanitizeAmountKES(item.discountKES), discountFromPercent(quantity * unitPrice, Number(item.discountPercent ?? 0)));
    if (requestedDiscount > 0) {
      if (!configuration.sales.discounts) {
        warnings.push(`Discounts are switched off for ${configuration.business.typeLabel}, so ${product.name} was sold at full price.`);
      } else if (!actorCan(actor, "APPLY_DISCOUNT")) {
        warnings.push(`The discount on ${product.name} was left off — that needs permission.`);
      } else {
        lineDiscount = Math.min(requestedDiscount, quantity * unitPrice);
      }
    }

    lines.push({
      productId: product.id,
      name: String(product.name),
      kind,
      unitKey: clampNote(item.unitKey, 24) ?? product.unitKey,
      quantity,
      unitPriceKES: unitPrice,
      discountKES: lineDiscount,
    });
    variants[product.id] = clampNote(item.variantDesc, 120);
    if (product.costKES != null) costKES += sanitizeAmountKES(product.costKES) * quantity;
  }

  if (!lines.length) return problem("EMPTY_SALE", "Add something to the sale first.");
  return { lines, variants, costKES };
}

/** Stock on hand for a set of products, summed across locations when the business has one (§16). */
async function stockMap(businessId: string, productIds: string[], branchId: string | null, client: PosClient): Promise<Record<string, number>> {
  const items = await store.stockLevels(businessId, productIds, client);
  const scope = store.branchScope(branchId);
  const totals: Record<string, number> = {};
  for (const item of items) {
    if (scope && item.branchId && item.branchId !== scope) continue;
    totals[item.productId] = Number(totals[item.productId] ?? 0) + Number(item.quantity ?? 0);
  }
  return totals;
}

/**
 * Records a sale (§27, §62). Returns the receipt document and text so the till can print or
 * share it immediately, and so the same code path serves the web, tablet and barcode flows.
 */
export async function createSale(params: {
  businessId: string;
  business: ReceiptBusiness;
  configuration: PosConfiguration;
  actor: PosActor;
  request: SaleRequest;
  /** Which published configuration produced this sale, so it stays interpretable later (§48). */
  configurationVersion?: number;
  configurationFingerprint?: string | null;
  client?: PosClient;
}): Promise<SaleOutcome> {
  const { businessId, business, configuration, actor, request } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!actorCan(actor, "CREATE_SALE")) {
    return problem("NOT_ALLOWED", "You don't have permission to record a sale.");
  }

  const resolved = await resolveLines({ businessId, configuration, actor, request, warnings, client });
  if (!("lines" in resolved)) return resolved as SaleOutcome;
  const { lines, variants, costKES } = resolved as { lines: SaleLineInput[]; variants: Record<string, string | null>; costKES: number };

  // ── Whole-sale discount and fee, both configuration- and permission-gated ──
  let saleDiscount = Math.max(sanitizeAmountKES(request.discountKES), 0);
  if (!saleDiscount && request.discountPercent) saleDiscount = discountFromPercent(saleDiscountBase(lines), Number(request.discountPercent));
  if (saleDiscount > 0) {
    if (!configuration.sales.discounts || !actorCan(actor, "APPLY_DISCOUNT")) {
      warnings.push("The whole-sale discount was left off — that needs permission.");
      saleDiscount = 0;
    }
  }

  let feeKES = 0;
  const requestedFee = sanitizeAmountKES(request.feeKES);
  if (requestedFee > 0) {
    if (!configuration.delivery.enabled) {
      warnings.push("Delivery is not switched on, so no delivery fee was added.");
    } else {
      const configuredFee = sanitizeAmountKES(configuration.delivery.feeKES);
      feeKES = actorCan(actor, "EDIT_PRICE") ? requestedFee : Math.min(requestedFee, configuredFee);
      if (feeKES < requestedFee) warnings.push("The delivery fee was capped at your configured amount.");
    }
  }

  const channel = normalizeChannel(request.channel);
  const payments: SalePaymentRequest[] = (request.payments ?? []).filter((payment) => payment && typeof payment === "object");

  const calculation = calculateSale({
    lines,
    saleDiscountKES: saleDiscount,
    feeKES,
    tax: configuration.sales.tax,
    payments: payments.map((payment) => ({
      method: String(payment.method ?? "cash"),
      amountKES: sanitizeAmountKES(payment.amountKES),
      reference: clampNote(payment.reference, 80) ?? undefined,
    })),
  });

  const paymentCheck = validatePayments(configuration, calculation);
  if (!paymentCheck.ok) return problem(paymentCheck.code ?? "PAYMENT_INVALID", paymentCheck.message ?? "That payment could not be accepted.", warnings);

  const { totals } = calculation;
  const creditKES = paymentCheck.creditKES ?? 0;

  // ── Customer and credit (§14, §30) ──
  let customer: any = null;
  const requestedCustomerId = clampNote(request.customerId, 64);
  const needsCustomer = creditKES > 0 || configuration.customers.repeat || configuration.customers.history;
  if (requestedCustomerId) {
    customer = await store.findCustomer(businessId, requestedCustomerId, client);
    if (!customer) return problem("CUSTOMER_NOT_FOUND", `That ${customerWord(configuration)} record does not belong to this business.`);
  } else if (creditKES > 0) {
    return problem("CUSTOMER_REQUIRED", `Choose the ${customerWord(configuration)} this sale is for before putting it on credit.`);
  }

  let creditDecision: ReturnType<typeof decideCredit> | null = null;
  if (creditKES > 0) {
    const entries = await store.listCreditEntries(businessId, { partyType: RECEIVABLE, partyId: customer.id, take: 200 }, client);
    const oldestDebit = entries.filter((entry: any) => entry.direction === "DEBIT").map((entry: any) => entry.createdAt).sort()[0] ?? null;
    creditDecision = decideCredit({
      config: configuration,
      party: { balanceKES: Number(customer.balanceKES ?? 0), limitKES: Number(customer.creditLimitKES ?? 0), partyType: RECEIVABLE },
      amountKES: creditKES,
      roleKey: actor.roleKey,
      oldestEntryAt: oldestDebit,
    });
    if (!creditDecision.allowed) {
      await logPosAuditInTransaction(client, {
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CREDIT_DECLINED",
        targetType: "CUSTOMER",
        targetId: customer.id,
        metadata: { code: creditDecision.code, amountKES: creditKES, reason: creditDecision.reason },
      });
      return problem(creditDecision.code ?? "CREDIT_DECLINED", creditDecision.reason, warnings);
    }
    if (creditDecision.requiresApproval && !actorCan(actor, "APPROVE_CREDIT")) {
      await logPosAuditInTransaction(client, {
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CREDIT_DECLINED",
        targetType: "CUSTOMER",
        targetId: customer.id,
        metadata: { code: "APPROVAL_REQUIRED", amountKES: creditKES },
      });
      return problem("CREDIT_APPROVAL_REQUIRED", "A manager needs to approve this credit sale.");
    }
  }

  // ── Stock (§33) ──
  const productIds = lines.map((line) => line.productId).filter(Boolean) as string[];
  const stock = configuration.inventory.enabled
    ? await stockMap(businessId, productIds, request.branchId ?? actor.branchId, client)
    : {};
  const availability = checkAvailability(configuration, lines, stock);
  if (!availability.ok) {
    return {
      ...problem("INSUFFICIENT_STOCK", `${availability.shortages[0]?.name ?? "An item"} does not have enough stock for that quantity.`),
      shortages: availability.shortages,
    };
  }

  const kind = request.kind === "QUOTATION" && configuration.sales.quotations
    ? "QUOTATION"
    : request.kind === "INVOICE" && configuration.sales.invoices
      ? "INVOICE"
      : "SALE";
  if (request.kind && request.kind !== kind) {
    warnings.push(`${request.kind === "QUOTATION" ? "Quotations" : "Invoices"} are not switched on, so this was saved as a sale.`);
  }

  const branchId = clampNote(request.branchId, 64) ?? actor.branchId;
  const staffId = clampNote(request.staffId, 64) ?? actor.staffId;
  const now = new Date();
  const prefix = receiptPrefixFromBusinessName(configuration.receipt.businessName || business.name);

  const sale = await inTransaction(params.client, async (tx: PosClient) => {
    const sequence = await store.nextSaleSequence(businessId, tx);
    const receiptNumber = formatReceiptNumber(prefix, sequence);
    const status = totals.balanceKES > 0 ? "PARTIALLY_PAID" : "COMPLETED";

    const created = await tx.posSale.create({
      data: {
        businessId,
        branchId,
        receiptNumber,
        sequence,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        staffId,
        staffName: actor.actorName,
        channel,
        status,
        kind,
        subtotalKES: totals.subtotalKES,
        discountKES: totals.discountKES,
        taxKES: totals.taxKES,
        feeKES,
        totalKES: totals.totalKES,
        paidKES: totals.paidKES,
        balanceKES: totals.balanceKES,
        refundedKES: 0,
        costKES: costKES || null,
        notes: clampNote(request.notes),
        configurationVersion: params.configurationVersion ?? 0,
        configurationFingerprint: params.configurationFingerprint ?? null,
        completedAt: kind === "SALE" ? now : null,
      },
    });

    for (const line of calculation.lines) {
      await tx.posSaleItem.create({
        data: {
          businessId,
          saleId: created.id,
          productId: line.productId ?? null,
          name: line.name,
          kind: line.kind,
          unitKey: line.unitKey ?? null,
          quantity: line.quantity,
          unitPriceKES: line.unitPriceKES,
          discountKES: line.lineDiscountKES,
          taxKES: line.lineTaxKES,
          totalKES: line.lineTotalKES,
          costKES: null,
          variantDesc: variants[line.productId ?? line.name] ?? null,
        },
      });
    }

    for (const payment of calculation.payments) {
      if (payment.amountKES <= 0) continue;
      if (isCreditMethod(payment.method)) continue; // credit is a ledger entry, not a payment
      await tx.posPayment.create({
        data: {
          businessId,
          saleId: created.id,
          customerId: customer?.id ?? null,
          branchId,
          direction: "IN",
          purpose: kind === "SALE" ? "SALE" : "DEPOSIT",
          method: String(payment.method),
          amountKES: payment.amountKES,
          reference: payment.reference ?? null,
          status: "SETTLED",
          createdById: actor.actorId,
        },
      });
    }

    // Stock leaves with a reason and a reference back to this sale (§33).
    if (kind === "SALE") {
      for (const movement of movementsForSale(lines, {
        saleId: created.id,
        branchId,
        conversions: configuration.inventory.conversions,
      })) {
        await store.recordMovement(businessId, { ...movement, reason: movement.reason, refType: "SALE", createdById: actor.actorId }, tx);
      }
    }

    if (creditKES > 0 && customer) {
      await store.applyBalanceChange(
        businessId,
        { partyType: RECEIVABLE, partyId: customer.id, partyName: customer.name },
        {
          deltaKES: creditKES,
          direction: "DEBIT",
          dueAt: configuration.credit.termsDays > 0 ? new Date(now.getTime() + configuration.credit.termsDays * 86_400_000) : null,
          saleId: created.id,
          note: `Credit sale ${receiptNumber}`,
        },
        tx,
      );
      await logPosAuditInTransaction(tx, {
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CREDIT_APPROVED",
        targetType: "CUSTOMER",
        targetId: customer.id,
        metadata: { amountKES: creditKES, saleId: created.id, newBalanceKES: creditDecision?.newBalanceKES ?? null },
      });
    }

    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_SALE_CREATED",
      targetType: "SALE",
      targetId: created.id,
      branchId,
      metadata: {
        receiptNumber,
        totalKES: totals.totalKES,
        paidKES: totals.paidKES,
        balanceKES: totals.balanceKES,
        creditKES,
        channel,
        kind,
        lines: lines.length,
        discountKES: totals.discountKES,
      },
    });

    return created;
  });

  const receiptSale = {
    receiptNumber: sale.receiptNumber,
    issuedAt: sale.createdAt ?? now,
    channel: sale.channel,
    cashierName: actor.actorName,
    customer: customer ? { name: customer.name, phone: customer.phone, number: customer.customerNumber } : null,
    lines: calculation.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitKey: line.unitKey ?? null,
      unitPriceKES: line.unitPriceKES,
      discountKES: line.lineDiscountKES,
      taxKES: line.lineTaxKES,
      totalKES: line.lineTotalKES,
    })),
    subtotalKES: totals.subtotalKES,
    discountKES: totals.discountKES,
    taxKES: totals.taxKES,
    totalKES: totals.totalKES,
    payments: calculation.payments.filter((payment) => payment.amountKES > 0),
    balanceKES: totals.balanceKES,
    creditBalanceKES: creditDecision?.newBalanceKES ?? null,
  };
  const receipt = buildReceipt({ config: configuration, business, sale: receiptSale });

  if (paymentCheck.changeKES > 0) warnings.push(`Change due: KES ${paymentCheck.changeKES.toLocaleString("en-KE")}.`);
  if (needsCustomer && !customer && configuration.customers.enabled) {
    warnings.push(`Saved without a ${customerWord(configuration)}. Add one next time to keep their history.`);
  }

  return {
    ok: true,
    warnings,
    sale,
    totals,
    receipt,
    receiptText: receiptToText(receipt),
    creditKES,
    changeKES: paymentCheck.changeKES ?? 0,
    balanceKES: totals.balanceKES,
  };
}

function saleDiscountBase(lines: SaleLineInput[]): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitPriceKES, 0);
}

function customerWord(configuration: PosConfiguration): string {
  const terminology = resolveTerminology(configuration);
  return (terminology.customer ?? "customer").toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Refunds, returns and voids (§54)
// ─────────────────────────────────────────────────────────────────────────────

export type RefundRequest = {
  saleId: string;
  amountKES?: number | null;
  method?: string | null;
  reference?: string | null;
  reason?: string | null;
  /** Lines coming back into stock. Quantities are capped at what was sold. */
  items?: { saleItemId: string; quantity: number }[];
};

export type RefundOutcome = {
  ok: boolean;
  code?: string;
  message?: string;
  warnings: string[];
  sale?: any;
  refundedKES?: number;
  returnedToStock?: number;
};

/**
 * Refunds money and, when items are named, puts stock back with its own RETURN movements.
 * The original sale row keeps its totals; only `refundedKES` and `status` move forward, and
 * the audit log records both the before and the after (§37, §54).
 */
export async function refundSale(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  request: RefundRequest;
  action?: "POS_SALE_REFUNDED" | "POS_SALE_VOIDED";
  client?: PosClient;
}): Promise<RefundOutcome> {
  const { businessId, configuration, actor, request } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];
  const action = params.action ?? "POS_SALE_REFUNDED";

  const permission: PermissionKey = action === "POS_SALE_VOIDED" ? "VOID_SALE" : "REFUND_SALE";
  if (!actorCan(actor, permission)) {
    return { ok: false, code: "NOT_ALLOWED", message: "You don't have permission to do that.", warnings };
  }
  if (!configuration.sales.refunds && action !== "POS_SALE_VOIDED") {
    return { ok: false, code: "REFUNDS_DISABLED", message: "Refunds are switched off for this business.", warnings };
  }

  const saleId = clampNote(request.saleId, 64);
  if (!saleId) return { ok: false, code: "SALE_REQUIRED", message: "Choose the sale to refund.", warnings };

  const sale = await store.findSale(businessId, saleId, client);
  if (!sale) {
    // Same answer for "not yours" and "does not exist" — never confirm another tenant's data (§56).
    return { ok: false, code: "SALE_NOT_FOUND", message: "That sale was not found.", warnings };
  }
  if (sale.status === "VOIDED") {
    return { ok: false, code: "ALREADY_VOIDED", message: "That sale was already voided.", warnings };
  }

  // ── Which items are coming back? ──
  const requestedReturns = (request.items ?? []).filter((item) => item && typeof item === "object");
  const itemById = new Map<string, any>((sale.items ?? []).map((item: any) => [item.id, item] as [string, any]));
  const returnLines: SaleLineInput[] = [];
  for (const entry of requestedReturns) {
    const line = itemById.get(String(entry.saleItemId));
    if (!line) continue;
    const quantity = Math.min(clampQuantity(entry.quantity), Number(line.quantity ?? 0));
    if (quantity <= 0) continue;
    const unitPrice = Number(line.totalKES ?? 0) / Math.max(1, Number(line.quantity ?? 1));
    returnLines.push({
      productId: line.productId ?? undefined,
      name: line.name,
      kind: line.kind === "SERVICE" ? "SERVICE" : "PRODUCT",
      unitKey: line.unitKey ?? undefined,
      quantity,
      unitPriceKES: Math.round(unitPrice),
    });
  }

  // ── How much money goes back? ──
  const stockValueKES = returnLines.reduce((total, line) => total + line.quantity * line.unitPriceKES, 0);
  const requestedAmount = request.amountKES == null ? stockValueKES : sanitizeAmountKES(request.amountKES);
  const amountKES = action === "POS_SALE_VOIDED" ? Math.max(0, Number(sale.paidKES ?? 0) - Number(sale.refundedKES ?? 0)) : requestedAmount;
  const check = validateRefund(Number(sale.paidKES ?? 0), Number(sale.refundedKES ?? 0), amountKES);

  if (action === "POS_SALE_VOIDED") {
    // A void reverses the whole sale: all stock comes back and any money taken goes back.
    for (const item of sale.items ?? []) {
      if (!returnLines.some((line) => line.productId && line.productId === item.productId)) {
        returnLines.push({
          productId: item.productId ?? undefined,
          name: item.name,
          kind: item.kind === "SERVICE" ? "SERVICE" : "PRODUCT",
          unitKey: item.unitKey ?? undefined,
          quantity: Number(item.quantity ?? 0),
          unitPriceKES: Number(item.unitPriceKES ?? 0),
        });
      }
    }
  } else if (!check.ok && stockValueKES <= 0) {
    return { ok: false, code: "REFUND_INVALID", message: check.message ?? "That refund could not be recorded.", warnings };
  }

  const refundKES = check.ok ? check.amountKES : 0;
  if (!refundKES && !returnLines.length) {
    return { ok: false, code: "NOTHING_TO_REFUND", message: "Nothing left to refund on that sale.", warnings };
  }

  const method = clampNote(request.method, 32) ?? "cash";
  const reason = clampNote(request.reason, 240);
  const refundedTotal = Number(sale.refundedKES ?? 0) + refundKES;
  const nextStatus = action === "POS_SALE_VOIDED"
    ? "VOIDED"
    : refundedTotal >= Number(sale.totalKES ?? 0)
      ? "REFUNDED"
      : "PARTIALLY_REFUNDED";

  const updated = await inTransaction(params.client, async (tx: PosClient) => {
    if (refundKES > 0) {
      await tx.posPayment.create({
        data: {
          businessId,
          saleId: sale.id,
          customerId: sale.customerId ?? null,
          branchId: sale.branchId ?? null,
          direction: "OUT",
          purpose: "REFUND",
          method,
          amountKES: refundKES,
          reference: clampNote(request.reference, 80),
          status: "SETTLED",
          notes: reason,
          createdById: actor.actorId,
        },
      });
    }

    let returnedToStock = 0;
    if (returnLines.length) {
      for (const movement of movementsForReturn(returnLines, {
        saleId: sale.id,
        branchId: sale.branchId ?? null,
        conversions: configuration.inventory.conversions,
      })) {
        await store.recordMovement(
          businessId,
          { ...movement, refType: "SALE", note: reason ?? `${action === "POS_SALE_VOIDED" ? "Voided" : "Returned"} against ${sale.receiptNumber}`, createdById: actor.actorId },
          tx,
        );
        returnedToStock += Math.abs(movement.delta);
      }
    }

    await tx.posSale.updateMany({
      where: { businessId, id: sale.id },
      data: { refundedKES: refundedTotal, status: nextStatus },
    });

    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action,
      targetType: "SALE",
      targetId: sale.id,
      branchId: sale.branchId ?? null,
      before: { refundedKES: Number(sale.refundedKES ?? 0), status: sale.status },
      after: { refundedKES: refundedTotal, status: nextStatus },
      metadata: { receiptNumber: sale.receiptNumber, refundKES, method, reason, returnedLines: returnLines.length },
    });

    return { returnedToStock };
  });

  if (refundKES < requestedAmount && action !== "POS_SALE_VOIDED") {
    warnings.push(`Only KES ${refundKES.toLocaleString("en-KE")} was refundable on that sale.`);
  }

  return {
    ok: true,
    warnings,
    refundedKES: refundKES,
    returnedToStock: updated.returnedToStock,
    sale: await store.findSale(businessId, sale.id, client),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit repayments (§30)
// ─────────────────────────────────────────────────────────────────────────────

export type RepaymentOutcome = {
  ok: boolean;
  code?: string;
  message?: string;
  warnings: string[];
  balanceKES?: number;
  amountKES?: number;
};

/** A customer pays down their balance: money in, ledger entry, balance moves (§30, §31). */
export async function recordRepayment(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  customerId: string;
  amountKES: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  client?: PosClient;
}): Promise<RepaymentOutcome> {
  const { businessId, configuration, actor } = params;
  const client: PosClient = params.client ?? prisma;
  const warnings: string[] = [];

  if (!actorCan(actor, "RECORD_REPAYMENT")) {
    return { ok: false, code: "NOT_ALLOWED", message: "You don't have permission to record a repayment.", warnings };
  }
  if (!configuration.credit.enabled) {
    return { ok: false, code: "CREDIT_DISABLED", message: "Credit is not switched on for this business.", warnings };
  }

  const customerId = clampNote(params.customerId, 64);
  if (!customerId) return { ok: false, code: "CUSTOMER_REQUIRED", message: `Choose the ${customerWord(configuration)}.`, warnings };

  const customer = await store.findCustomer(businessId, customerId, client);
  if (!customer) return { ok: false, code: "CUSTOMER_NOT_FOUND", message: "That record was not found.", warnings };

  const check = validateRepayment(Number(customer.balanceKES ?? 0), sanitizeAmountKES(params.amountKES));
  if (!check.ok) return { ok: false, code: "REPAYMENT_INVALID", message: check.message ?? "That repayment could not be recorded.", warnings };

  await inTransaction(params.client, async (tx: PosClient) => {
    const payment = await tx.posPayment.create({
      data: {
        businessId,
        customerId,
        branchId: actor.branchId,
        direction: "IN",
        purpose: "CREDIT_REPAYMENT",
        method: clampNote(params.method, 32) ?? "cash",
        amountKES: check.amountKES,
        reference: clampNote(params.reference, 80),
        status: "SETTLED",
        notes: clampNote(params.note),
        createdById: actor.actorId,
      },
    });
    await store.applyBalanceChange(
      businessId,
      { partyType: RECEIVABLE, partyId: customerId, partyName: customer.name },
      { deltaKES: -check.amountKES, direction: "CREDIT", paymentId: payment.id, note: clampNote(params.note) ?? "Repayment" },
      tx,
    );
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_REPAYMENT_RECORDED",
      targetType: "CUSTOMER",
      targetId: customerId,
      before: { balanceKES: Number(customer.balanceKES ?? 0) },
      after: { balanceKES: check.newBalanceKES },
      metadata: { amountKES: check.amountKES, method: payment.method, paymentId: payment.id },
    });
  });

  return { ok: true, warnings, amountKES: check.amountKES, balanceKES: check.newBalanceKES };
}
