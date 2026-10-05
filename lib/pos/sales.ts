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
import { baselineConfiguration, normalizeConfiguration } from "./configuration";
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

/** Raised inside the sale transaction when a wallet settlement cannot be verified (§112). */
export class WalletSettlementRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "WalletSettlementRefused";
  }
}

/** Raised inside the sale transaction when the credit decision, re-run under the customer's row
 * lock, refuses the sale (§30). The refusal is audited outside the rolled-back transaction. */
export class CreditDecisionRefused extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CreditDecisionRefused";
  }
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
 * Prices a sale request without writing anything (§20, §33, §56, §98).
 *
 * The JATA Payment Orchestrator uses this to work out what to charge the customer: the browser's
 * arithmetic is never trusted, so the amount that goes to a provider is the amount the server
 * priced from its own product and configuration records. `createSale` calls the same function,
 * which is what makes "the amount requested" and "the amount recorded" identical by construction.
 */
export type PricedSale = {
  ok: true;
  warnings: string[];
  lines: SaleLineInput[];
  variants: Record<string, string | null>;
  costKES: number;
  saleDiscount: number;
  feeKES: number;
  channel: ChannelKey;
  payments: SalePaymentRequest[];
  calculation: ReturnType<typeof calculateSale>;
  paymentCheck: ReturnType<typeof validatePayments>;
};

/**
 * `strict: false` in this repository means `ok: true` does not narrow the union returned by
 * `priceSaleRequest`. This guard keeps the pricing result precise for both callers — the till's
 * own sale route and the JATA Payment Orchestrator (§20: one pricing engine).
 */
export function isPricedSale(value: SaleOutcome | PricedSale): value is PricedSale {
  return Boolean(value) && value.ok === true && Array.isArray((value as PricedSale).lines);
}

export async function priceSaleRequest(params: {
  businessId: string;
  configuration: PosConfiguration;
  actor: PosActor;
  request: SaleRequest;
  client?: PosClient;
  /**
   * Price a cart whose electronic payment has not been confirmed yet. The total is priced exactly
   * as it will be at settlement; only the "the sale is short" rule is relaxed, because the money
   * is being collected by the JATA Payment Orchestrator and will be confirmed by the provider
   * before the sale is recorded (§30: nothing is settled on a promise).
   *
   * `walletSettlement` is passed only by the payment engine when it settles a provider-confirmed
   * wallet payment (§112): it admits the "wallet" tender, which the till's own routes never
   * produce. It never relaxes the amount — the settlement amount is the confirmed amount.
   */
  options?: { unpaid?: boolean; walletSettlement?: boolean };
}): Promise<PricedSale | SaleOutcome> {
  const { businessId, configuration, actor, request } = params;
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

  const paymentCheck = validatePayments(configuration, calculation, { walletSettlement: params.options?.walletSettlement === true });
  if (!paymentCheck.ok) {
    const deferredElectronicPayment = params.options?.unpaid === true && paymentCheck.code === "SHORT_PAYMENT";
    if (!deferredElectronicPayment) {
      return problem(paymentCheck.code ?? "PAYMENT_INVALID", paymentCheck.message ?? "That payment could not be accepted.", warnings);
    }
  }

  return { ok: true, warnings, lines, variants, costKES, saleDiscount, feeKES, channel, payments, calculation, paymentCheck };
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
  /**
   * Deliberate wallet settlement (§112): passed only by the payment engine, and only with the id
   * of the transaction it just moved to CONFIRMED inside its own database transaction. The "wallet"
   * tender is admitted in pricing only when that transaction exists for the same tenant and its
   * provider-confirmed amount matches the tender — so no route, and no caller without a
   * provider-confirmed transaction, can declare a sale paid by wallet.
   */
  options?: { walletSettlement?: { transactionId: string } };
}): Promise<SaleOutcome> {
  const { businessId, business, configuration, actor, request } = params;
  const client: PosClient = params.client ?? prisma;

  // Pricing is one engine call, so a payment requested over the JATA Payment Orchestrator is
  // priced by exactly the same code that records the sale when the money arrives (§20, §56).
  const priced = await priceSaleRequest({ ...params, options: { walletSettlement: params.options?.walletSettlement != null } });
  if (!isPricedSale(priced)) return priced;
  const { warnings, lines, variants, costKES, saleDiscount, feeKES, channel, payments, calculation, paymentCheck } = priced;
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

  // ── Credit, first look (§30) ──
  // The authoritative decision repeats inside the sale transaction under the customer's row
  // lock, so two concurrent credit sales cannot both pass the limit on the same read balance.
  // This early pass exists so the till answers in the same order it always has — a declined
  // credit is refused before a stock question, and the refusal is audited either way.
  if (creditKES > 0 && customer) {
    const entries = await store.listCreditEntries(businessId, { partyType: RECEIVABLE, partyId: customer.id, take: 200 }, client);
    const oldestDebit = entries.filter((entry: any) => entry.direction === "DEBIT").map((entry: any) => entry.createdAt).sort()[0] ?? null;
    const earlyDecision = decideCredit({
      config: configuration,
      party: {
        balanceKES: Number(customer.balanceKES ?? 0),
        limitKES: Number(customer.creditLimitKES ?? 0),
        partyType: RECEIVABLE,
      },
      amountKES: creditKES,
      roleKey: actor.roleKey,
      oldestEntryAt: oldestDebit,
    });
    if (!earlyDecision.allowed) {
      await logPosAuditInTransaction(client, {
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CREDIT_DECLINED",
        targetType: "CUSTOMER",
        targetId: customer.id,
        metadata: { code: earlyDecision.code, amountKES: creditKES, reason: earlyDecision.reason },
      });
      return problem(earlyDecision.code ?? "CREDIT_DECLINED", earlyDecision.reason, warnings);
    }
    if (earlyDecision.requiresApproval && !actorCan(actor, "APPROVE_CREDIT")) {
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

  // ── Branch (§16, §75) ──
  // The location a sale is recorded at is the actor's scope, not the browser's: a staff member
  // bound to a branch always records into that branch, and a branch named by an unbound actor
  // must exist in the business. Stock is checked against the same resolved location.
  const branchDecision = await store.resolveBranch(businessId, actor, request.branchId, client, true);
  if ("code" in branchDecision) return problem(branchDecision.code, branchDecision.message, warnings);
  const saleBranchId = branchDecision.branchId;

  // ── Stock (§33) ──
  const productIds = lines.map((line) => line.productId).filter(Boolean) as string[];
  const stock = configuration.inventory.enabled
    ? await stockMap(businessId, productIds, saleBranchId, client)
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

  const branchId = saleBranchId;
  const staffId = clampNote(request.staffId, 64) ?? actor.staffId;
  const now = new Date();
  const prefix = receiptPrefixFromBusinessName(configuration.receipt.businessName || business.name);

  const walletSettlement = params.options?.walletSettlement ?? null;
  let creditDecision: ReturnType<typeof decideCredit> | null = null;
  let sale: any;
  try {
    sale = await inTransaction(params.client, async (tx: PosClient) => {
    // ── Wallet settlement guard (§112) ─────────────────────────────────────────
    // The "wallet" tender is only real when it is the settlement record of a provider-confirmed
    // transaction of this tenant, for exactly the confirmed amount, and of a transaction that has
    // not already settled another sale. The engine passes the id it just confirmed; anything else
    // is refused before a single row is written.
    if (walletSettlement) {
      const walletTenderKES = calculation.payments
        .filter((payment) => String(payment.method).trim().toLowerCase() === "wallet" && payment.amountKES > 0)
        .reduce((total, payment) => total + payment.amountKES, 0);
      const settlementTransaction = await tx.paymentTransaction.findFirst({
        where: { id: walletSettlement.transactionId, businessId },
      });
      const settlementStatus = String(settlementTransaction?.status ?? "");
      if (
        !settlementTransaction ||
        !["CONFIRMED", "PAID", "PARTIALLY_PAID"].includes(settlementStatus) ||
        Number(settlementTransaction.amountMinor) !== Math.round(walletTenderKES * 100) ||
        settlementTransaction.posSaleId != null
      ) {
        throw new WalletSettlementRefused(
          "WALLET_SETTLEMENT_UNCONFIRMED",
          "A wallet sale can only be recorded from the confirmed wallet payment it settles.",
        );
      }
    }

    // ── Credit, decided under the customer's row lock (§30) ───────────────────
    // The balance the limit is checked against is the current one: a concurrent credit sale for
    // this customer commits before this lock is taken, so its balance is already in it. A sale
    // that fails the check is rolled back — the refusal is audited after the rollback.
    if (creditKES > 0 && customer) {
      await store.lockPartyRow(tx, RECEIVABLE, businessId, customer.id);
      const current = await store.findCustomer(businessId, customer.id, tx);
      const entries = await store.listCreditEntries(businessId, { partyType: RECEIVABLE, partyId: customer.id, take: 200 }, tx);
      const oldestDebit = entries.filter((entry: any) => entry.direction === "DEBIT").map((entry: any) => entry.createdAt).sort()[0] ?? null;
      const decision = decideCredit({
        config: configuration,
        party: {
          balanceKES: Number(current?.balanceKES ?? customer.balanceKES ?? 0),
          limitKES: Number(current?.creditLimitKES ?? customer.creditLimitKES ?? 0),
          partyType: RECEIVABLE,
        },
        amountKES: creditKES,
        roleKey: actor.roleKey,
        oldestEntryAt: oldestDebit,
      });
      if (!decision.allowed) {
        throw new CreditDecisionRefused(decision.code ?? "CREDIT_DECLINED", decision.reason);
      }
      if (decision.requiresApproval && !actorCan(actor, "APPROVE_CREDIT")) {
        throw new CreditDecisionRefused("CREDIT_APPROVAL_REQUIRED", "A manager needs to approve this credit sale.");
      }
      creditDecision = decision;
    }

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
        creditRefundedKES: 0,
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
          returnedQty: 0,
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
        await store.recordMovement(
          businessId,
          { ...movement, reason: movement.reason, refType: "SALE", createdById: actor.actorId },
          tx,
          // Same rule `checkAvailability` used a moment ago: a business that does not track
          // stock levels sells on, a business that does can never be taken below zero (§33, §47).
          { configuration },
        );
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
  } catch (error) {
    if (error instanceof WalletSettlementRefused) {
      return problem(error.code, error.message, warnings);
    }
    if (error instanceof CreditDecisionRefused) {
      if (customer) {
        await logPosAuditInTransaction(client, {
          businessId,
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "POS_CREDIT_DECLINED",
          targetType: "CUSTOMER",
          targetId: customer.id,
          metadata: { code: error.code, amountKES: creditKES, reason: error.message },
        });
      }
      return problem(error.code, error.message, warnings);
    }
    if (error instanceof store.StockShortage) {
      return problem("INSUFFICIENT_STOCK", error.message, warnings);
    }
    throw error;
  }

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
 *
 * Integrity rules (§30, §54, §56, §112):
 *
 * - The sale is locked and re-read inside the transaction, so every limit below is enforced
 *   against the current ledger: two concurrent refunds cannot both spend the same refundable
 *   amount, and the per-line returned quantity can only ever reach the quantity sold.
 * - Money goes back only where it actually came from. The cash part is capped by what the till
 *   collected (the sale's settled `IN` payment rows) minus cash already refunded, and it is the
 *   only part that writes a cash OUT row. The credit part is the DEBIT the sale put on the
 *   customer's receivable minus credit already refunded — capped further by what the customer
 *   still owes — and it is applied back to that receivable. A credit refund never produces
 *   cash, so money that was never received can never be "returned".
 * - A sale that a payment wallet transaction settled is refused here: its refund runs through
 *   the Payment Wallet's refund flow, which is the single ledger for that money (§112).
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

  // Tenant scoping first, without the lock: one answer covers "not yours" and "does not exist",
  // so a foreign id never confirms existence (§56).
  const exists = await store.findSale(businessId, saleId, client);
  if (!exists) return { ok: false, code: "SALE_NOT_FOUND", message: "That sale was not found.", warnings };

  // ── Branch scope (§16, §75) ──
  // The sale id arrives as a path parameter, so nothing in the request names a branch: the only
  // scope that can be applied is the branch the staff row binds this actor to. A cashier may
  // refund and void their own location's sales and no other's — the browser cannot widen it, and
  // the check runs before the sale is locked or a single row is written.
  if (!store.branchRecordInScope(actor, exists.branchId)) {
    return { ok: false, code: "BRANCH_OUT_OF_SCOPE", message: store.branchOutOfScopeMessage(), warnings };
  }

  const requestedReturns = (request.items ?? []).filter((item) => item && typeof item === "object");
  // A refund method is a financial fact, not a preference: it is derived from the tenders this
  // sale was actually paid with (see `resolveRefundMethods` below). The browser's value is only
  // an expression of intent and is validated against that authoritative state — it can never
  // name a method the sale was not funded by, and never an arbitrary label (§35, §57).
  const requestedMethod = clampNote(request.method, 32);
  const reason = clampNote(request.reason, 240);

  const updated = await inTransaction(params.client, async (tx: PosClient) => {
    // ── Lock and re-read: every limit is enforced against the current state ──
    await store.lockSaleRow(tx, businessId, saleId);
    const sale = await store.findSale(businessId, saleId, tx);
    if (!sale) return { returnedToStock: 0, code: "SALE_NOT_FOUND" as string | undefined, message: "That sale was not found.", refundKES: 0 };
    if (sale.status === "VOIDED") return { returnedToStock: 0, code: "ALREADY_VOIDED" as string | undefined, message: "That sale was already voided.", refundKES: 0 };

    // A sale the payment wallet settled has its own refund flow; refunding it here would open a
    // second ledger for the same money (§112).
    const walletTransaction = await tx.paymentTransaction.findFirst({ where: { businessId, posSaleId: sale.id } });
    if (walletTransaction) {
      return {
        returnedToStock: 0,
        code: "REFUND_VIA_PAYMENTS" as string | undefined,
        message: "This sale was paid through your payment wallet. Refund it from Payments so the wallet ledger stays the single source of truth.",
        refundKES: 0,
      };
    }

    const settledPayments = (sale.payments ?? []).filter((payment: any) => payment.status === "SETTLED");
    const collectedKES = settledPayments
      .filter((payment: any) => payment.direction === "IN")
      .reduce((total: number, payment: any) => total + Number(payment.amountKES ?? 0), 0);
    const refundedKES = Number(sale.refundedKES ?? 0);
    const creditRefundedKES = Number(sale.creditRefundedKES ?? 0);
    const cashRefundedKES = Math.max(0, refundedKES - creditRefundedKES);

    // The credit this sale put on the customer's account is recorded by its DEBIT ledger entry —
    // a credit sale counts as "paid" on the sale row, so the receivable ledger, not the sale,
    // is the source of truth for what the credit part of a refund may be (§30).
    const saleCreditEntries = sale.customerId
      ? await tx.posCreditEntry.findMany({ where: { businessId, saleId: sale.id, direction: "DEBIT" }, select: { amountKES: true } })
      : [];
    const creditPortionKES = saleCreditEntries.reduce((total: number, entry: any) => total + Number(entry.amountKES ?? 0), 0);
    // …and it can only come back as far as the customer still owes: money already repaid was
    // received, not extended.
    const receivableNowKES = sale.customerId
      ? Math.max(0, Number((await store.findCustomer(businessId, sale.customerId, tx))?.balanceKES ?? 0))
      : 0;

    const cashRefundableKES = Math.max(0, collectedKES - cashRefundedKES);
    const creditRefundableKES = Math.max(0, Math.min(creditPortionKES - creditRefundedKES, receivableNowKES));

    // ── Which methods may this money come back through? ──
    // Not the browser's: the tenders this sale was actually funded by, less what has already
    // been refunded out of each. The drawer figure is read from these rows, so the method is
    // derived from the ledger (§35, §57).
    const tenders = settledPayments
      .filter((payment: any) => payment.direction === "IN")
      .map((payment: any) => ({ method: String(payment.method ?? "cash"), amountKES: Number(payment.amountKES ?? 0) }));
    const alreadyRefundedByMethod = (sale.payments ?? [])
      .filter((payment: any) => payment.status === "SETTLED" && payment.direction === "OUT" && String(payment.purpose ?? "") === "REFUND")
      .map((payment: any) => ({ method: String(payment.method ?? "cash"), amountKES: Number(payment.amountKES ?? 0) }));
    const methodCapacityKES = allocateRefundMethods({
      tenders,
      alreadyRefunded: alreadyRefundedByMethod,
      requestedMethod: null,
      amountKES: Number.MAX_SAFE_INTEGER,
    }).reduce((total: number, entry) => total + entry.amountKES, 0);
    // Never pay out through a method that did not fund this sale, and never more than the
    // till collected: the stricter of the ledger and the funding decides.
    const fundableKES = Math.max(0, Math.min(cashRefundableKES, methodCapacityKES));

    // ── Items coming back: per line, only what is left to return, claimed atomically ──
    const returnLines: SaleLineInput[] = [];
    const claimLine = async (line: any, quantity: number): Promise<boolean> => {
      // The claim itself is the guard: `returnedQty + quantity` may never pass the quantity
      // sold, and the check and the write are one conditional statement, so a concurrent
      // over-return loses instead of sneaking past a stale read (§54).
      const claimed = await tx.posSaleItem.updateMany({
        where: {
          businessId,
          id: line.id,
          returnedQty: { lte: round3(Number(line.quantity ?? 0)) - quantity + 1e-9 },
        },
        data: { returnedQty: { increment: quantity } },
      });
      if (!claimed?.count) return false;
      returnLines.push(lineFromSaleItem(line, quantity));
      return true;
    };

    if (action === "POS_SALE_VOIDED") {
      for (const item of sale.items ?? []) {
        const remaining = Math.max(0, round3(Number(item.quantity ?? 0)) - round3(Number(item.returnedQty ?? 0)));
        if (remaining > 0) await claimLine(item, remaining);
      }
    } else {
      const itemById = new Map<string, any>((sale.items ?? []).map((item: any) => [item.id, item] as [string, any]));
      for (const entry of requestedReturns) {
        const line = itemById.get(String(entry.saleItemId));
        if (!line) continue;
        const remaining = Math.max(0, round3(Number(line.quantity ?? 0)) - round3(Number(line.returnedQty ?? 0)));
        const requestedLine = clampQuantity(entry.quantity);
        const quantity = Math.min(requestedLine, remaining);
        if (quantity <= 0) {
          warnings.push(`${line.name} has nothing left to return.`);
          continue;
        }
        if (quantity < requestedLine) {
          warnings.push(`Only ${quantity} of ${line.name} is left to return.`);
        }
        if (!(await claimLine(line, quantity))) {
          warnings.push(`${line.name} has nothing left to return.`);
        }
      }
    }

    // ── Money: what goes back, and how it splits between the till and the credit ledger ──
    // A void takes back everything left; an explicit amount is honoured as asked; a return with
    // no amount is priced at what the returned lines are worth, as before.
    const returnedValueKES = returnLines.reduce((total, line) => total + Math.round(line.quantity * line.unitPriceKES), 0);
    const requestedAmount =
      action === "POS_SALE_VOIDED"
        ? cashRefundableKES + creditRefundableKES
        : request.amountKES != null
          ? sanitizeAmountKES(request.amountKES)
          : returnedValueKES;
    const totalRefundableKES = cashRefundableKES + creditRefundableKES;
    if (action !== "POS_SALE_VOIDED" && requestedAmount > totalRefundableKES) {
      return {
        returnedToStock: 0,
        code: "REFUND_INVALID" as string | undefined,
        message: `Only KES ${totalRefundableKES.toLocaleString("en-KE")} of that sale is left to refund.`,
        refundKES: 0,
      };
    }
    // Money is the only part that may leave through a tender; the credit part goes back to the
    // customer's account. Money is taken first, so a sale with both never pays out more than was
    // funded, and never through a method the customer did not pay with.
    const cashPart = Math.min(Math.max(0, requestedAmount), fundableKES);
    const creditPart = Math.min(Math.max(0, requestedAmount - cashPart), creditRefundableKES);
    const refundKES = cashPart + creditPart;

    // The authoritative split: one row per tender, each capped by what that tender funded and
    // has not already returned. A browser that asks for "cash" on a credit sale, or for "mpesa"
    // on a cash sale, gets the tender the ledger says was paid — never the label it sent.
    const methodAllocations = allocateRefundMethods({
      tenders,
      alreadyRefunded: alreadyRefundedByMethod,
      requestedMethod: requestedMethod,
      amountKES: cashPart,
    });

    if (refundKES <= 0 && !returnLines.length) {
      return { returnedToStock: 0, code: "NOTHING_TO_REFUND" as string | undefined, message: "Nothing left to refund on that sale.", refundKES: 0 };
    }

    // ── Apply: money rows, credit ledger, stock back, totals forward, audit ──
    for (const allocation of methodAllocations) {
      if (allocation.amountKES <= 0) continue;
      await tx.posPayment.create({
        data: {
          businessId,
          saleId: sale.id,
          customerId: sale.customerId ?? null,
          branchId: sale.branchId ?? null,
          direction: "OUT",
          purpose: "REFUND",
          method: allocation.method,
          amountKES: allocation.amountKES,
          reference: clampNote(request.reference, 80),
          status: "SETTLED",
          notes: reason,
          createdById: actor.actorId,
        },
      });
    }

    if (creditPart > 0 && sale.customerId) {
      // The credit part goes back to the customer's account — never to the till (§30, §54).
      const result = await store.applyBalanceChange(
        businessId,
        { partyType: RECEIVABLE, partyId: sale.customerId, partyName: sale.customerName ?? null },
        {
          deltaKES: -creditPart,
          direction: "CREDIT",
          saleId: sale.id,
          note: reason ?? `Credit refunded against ${sale.receiptNumber}`,
        },
        tx,
      );
      if (!result) {
        // The receivable row is gone: roll the whole refund back rather than refund cash and
        // leave the credit part hanging.
        throw new RefundAborted("CREDIT_PARTY_MISSING");
      }
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
          { configuration },
        );
        returnedToStock += Math.abs(movement.delta);
      }
    }

    // The totals move with a compare-and-set on the snapshot we locked: a refund that somehow
    // changed the row underneath us (possible on clients without raw SQL locking) changes
    // nothing and is refused instead of double-counting.
    const nextRefundedKES = refundedKES + refundKES;
    const nextCreditRefundedKES = creditRefundedKES + creditPart;
    const nextStatus =
      action === "POS_SALE_VOIDED" ? "VOIDED" : nextRefundedKES >= Number(sale.totalKES ?? 0) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const moved = await tx.posSale.updateMany({
      where: {
        businessId,
        id: sale.id,
        refundedKES,
        creditRefundedKES,
        status: String(sale.status),
      },
      data: {
        refundedKES: nextRefundedKES,
        creditRefundedKES: nextCreditRefundedKES,
        status: nextStatus,
      },
    });
    if (!moved?.count) throw new RefundAborted("REFUND_CONFLICT");

    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action,
      targetType: "SALE",
      targetId: sale.id,
      branchId: sale.branchId ?? null,
      before: { refundedKES, creditRefundedKES, status: String(sale.status) },
      after: { refundedKES: nextRefundedKES, creditRefundedKES: nextCreditRefundedKES, status: nextStatus },
      metadata: {
        receiptNumber: sale.receiptNumber,
        cashPart,
        creditPart,
        // What the ledger recorded, and what the browser asked for: the two are shown side by
        // side so a forged method is visible in the trail even where it was simply ignored.
        methods: methodAllocations.map((entry) => ({ method: entry.method, amountKES: entry.amountKES })),
        requestedMethod: requestedMethod ?? null,
        reason,
        returnedLines: returnLines.length,
      },
    });

    return { returnedToStock, code: undefined, message: undefined, refundKES };
  }).catch(async (error: unknown) => {
    if (error instanceof RefundAborted) {
      if (error.message === "CREDIT_PARTY_MISSING") {
        return { returnedToStock: 0, code: "REFUND_CONFLICT" as string | undefined, message: "That refund could not be recorded — try again.", refundKES: 0 };
      }
      return { returnedToStock: 0, code: "REFUND_CONFLICT" as string | undefined, message: "That sale is changing at the same moment — try the refund again.", refundKES: 0 };
    }
    throw error;
  });

  if (updated.code) {
    return { ok: false, code: updated.code, message: updated.message ?? "That refund could not be recorded.", warnings };
  }

  return {
    ok: true,
    warnings,
    refundedKES: updated.refundKES,
    returnedToStock: updated.returnedToStock,
    sale: await store.findSale(businessId, saleId, client),
  };
}

export type RestoredStockResult = {
  /** Units put back on the shelf this call, in the product's base unit. */
  returnedToStock: number;
  /** Lines that had something left to bring back and were claimed by this call. */
  restoredLines: number;
};

/**
 * Puts a sale's goods back on the shelf — once (§33, §54).
 *
 * A sale the Payment Wallet settled is refunded through the wallet's own flow, which settles
 * money but knows nothing about stock. Without this, refunding such a sale left the money
 * reversed and the goods gone: the ledger said KES 0 out, the shelf said one unit short, and
 * nothing in the business could explain the difference. The wallet path now calls this from
 * inside the same locked transaction that marks the refund COMPLETED, so money and stock move
 * together or not at all.
 *
 * The claim is the guard, exactly as in `refundSale`: `returnedQty` may only be advanced while
 * `returnedQty + quantity` stays within the quantity sold, and the compare and the write are one
 * conditional statement. A line another process has already brought back (a concurrent wallet
 * callback, a duplicate provider result, or a POS-side return) therefore claims nothing here, so
 * the goods can come back once and only once however many times the refund is confirmed.
 *
 * `onlyWhenFullyRefunded` keeps a partial refund honest: someone who was given back part of
 * their money keeps the goods, so nothing returns to stock until the sale's refunded total has
 * reached what it was paid.
 */
export async function restoreRefundedSaleStock(params: {
  businessId: string;
  saleId: string;
  /** Only bring stock back once the money has all come back (a partial refund keeps the goods). */
  onlyWhenFullyRefunded?: boolean;
  paidKES?: number | null;
  refundedKES?: number | null;
  note?: string | null;
  createdById?: string | null;
  client?: PosClient;
}): Promise<RestoredStockResult> {
  const client: PosClient = params.client ?? prisma;
  const sale = await client.posSale.findFirst({ where: { businessId: params.businessId, id: params.saleId } });
  if (!sale) return { returnedToStock: 0, restoredLines: 0 };

  if (params.onlyWhenFullyRefunded !== false) {
    const paid = Number(params.paidKES ?? sale.paidKES ?? 0);
    const refunded = Number(params.refundedKES ?? sale.refundedKES ?? 0);
    if (refunded < paid) return { returnedToStock: 0, restoredLines: 0 };
  }

  const configuration = await loadConfigurationFor(params.businessId, client);
  const items = await client.posSaleItem.findMany({ where: { businessId: params.businessId, saleId: sale.id } });

  let returnedToStock = 0;
  let restoredLines = 0;
  for (const item of items ?? []) {
    if (!item?.productId) continue;
    const sold = round3(Number(item.quantity ?? 0));
    const remaining = Math.max(0, sold - round3(Number(item.returnedQty ?? 0)));
    if (remaining <= 0) continue;
    // Claim the line atomically: whoever wins this statement owns the return.
    const claimed = await client.posSaleItem.updateMany({
      where: {
        businessId: params.businessId,
        id: item.id,
        returnedQty: { lte: sold - remaining + 1e-9 },
      },
      data: { returnedQty: { increment: remaining } },
    });
    if (!claimed?.count) continue;
    restoredLines += 1;

    for (const movement of movementsForReturn(
      [{ productId: item.productId, name: String(item.name ?? "Item"), kind: "PRODUCT", quantity: remaining, unitKey: item.unitKey ?? undefined, unitPriceKES: Number(item.unitPriceKES ?? 0) }],
      { saleId: sale.id, branchId: sale.branchId ?? null, conversions: configuration.inventory.conversions },
    )) {
      await store.recordMovement(
        params.businessId,
        {
          ...movement,
          refType: "SALE",
          note: params.note ?? `Refunded against ${sale.receiptNumber}`,
          createdById: params.createdById ?? null,
        },
        client,
        // A return adds stock, so the negative-stock question never arises; passing the
        // configuration keeps the same contract the POS engine uses everywhere else.
        { configuration },
      );
      returnedToStock += Math.abs(movement.delta);
    }
  }
  return { returnedToStock, restoredLines };
}

/** The configuration a stock movement must be interpreted against, read inside the caller's transaction. */
async function loadConfigurationFor(businessId: string, client: PosClient): Promise<PosConfiguration> {
  const row = await client.posConfiguration?.findFirst?.({ where: { businessId } });
  const raw = row?.publishedJson ?? row?.draftJson ?? null;
  if (!raw) return baselineConfiguration();
  try {
    return normalizeConfiguration(JSON.parse(raw));
  } catch {
    return baselineConfiguration();
  }
}

export type RefundMethodAllocation = { method: string; amountKES: number };

/**
 * Splits the money side of a refund across the tenders the sale was *actually* funded by (§35,
 * §57).
 *
 * A refund is a reversal of money that moved, so the method on the refund row is a financial
 * fact, not a preference the browser may name. The day's cash figure is read from these rows
 * (`dailyClosing` counts `posPayment` rows with `method === "cash"`), so a client-supplied
 * method is a way to forge the drawer: take KES 5,000 out of the till, file it as "mpesa", and
 * the close reports a drawer that is KES 5,000 over.
 *
 * The rules, in order:
 *  - a method may only receive what was tendered in it and not yet refunded out of it;
 *  - the browser's requested method is honoured *only* while that method still has capacity —
 *    it is an expression of intent, validated against the ledger, never a label we write;
 *  - the rest follows the tender order recorded on the sale (the order the money arrived in);
 *  - a method that was never tendered can never appear, whatever the request says.
 */
export function allocateRefundMethods(params: {
  /** Settled money that came IN for this sale: the tenders it was funded by. */
  tenders: { method: string; amountKES: number }[];
  /** Settled refund money already paid OUT per method. */
  alreadyRefunded: { method: string; amountKES: number }[];
  /** What the browser asked for; used only if that method still has room. */
  requestedMethod?: string | null;
  amountKES: number;
}): RefundMethodAllocation[] {
  const key = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const tendered = new Map<string, { method: string; amountKES: number }>();
  for (const tender of params.tenders ?? []) {
    const amount = Math.max(0, Math.round(Number(tender.amountKES ?? 0)));
    if (amount <= 0) continue;
    const id = key(tender.method) || "cash";
    const seen = tendered.get(id);
    // Keep the spelling the sale recorded, so the refund row matches the tender row.
    tendered.set(id, { method: seen?.method ?? String(tender.method ?? "cash"), amountKES: (seen?.amountKES ?? 0) + amount });
  }
  const refunded = new Map<string, number>();
  for (const row of params.alreadyRefunded ?? []) {
    const id = key(row.method) || "cash";
    refunded.set(id, (refunded.get(id) ?? 0) + Math.max(0, Math.round(Number(row.amountKES ?? 0))));
  }

  const capacity = [...tendered.entries()]
    .map(([id, tender]) => ({ id, method: tender.method, amountKES: Math.max(0, tender.amountKES - (refunded.get(id) ?? 0)) }))
    .filter((entry) => entry.amountKES > 0);

  // The requested method leads when it is one of the sale's real tenders and still has room;
  // every other method with room follows in the order the money arrived.
  const requestedId = key(params.requestedMethod);
  const ordered = requestedId
    ? [...capacity.filter((entry) => entry.id === requestedId), ...capacity.filter((entry) => entry.id !== requestedId)]
    : capacity;

  const allocations: RefundMethodAllocation[] = [];
  let remaining = Math.max(0, Math.round(Number(params.amountKES ?? 0)));
  for (const entry of ordered) {
    if (remaining <= 0) break;
    const amountKES = Math.min(remaining, entry.amountKES);
    if (amountKES <= 0) continue;
    allocations.push({ method: entry.method, amountKES });
    remaining -= amountKES;
  }
  return allocations;
}

/** Raised to roll a refund back when its preconditions fail after rows were written. */
class RefundAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundAborted";
  }
}

function round3(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function lineFromSaleItem(line: any, quantity: number): SaleLineInput {
  // The line recorded its own price at the moment of sale; derive it only where that is absent.
  const recorded = Number(line.unitPriceKES ?? 0);
  const unitPrice = recorded > 0 ? recorded : Number(line.totalKES ?? 0) / Math.max(1e-9, Number(line.quantity ?? 1));
  return {
    productId: line.productId ?? undefined,
    name: line.name,
    kind: line.kind === "SERVICE" ? "SERVICE" : "PRODUCT",
    unitKey: line.unitKey ?? undefined,
    quantity,
    unitPriceKES: Math.round(unitPrice),
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

  const amountKES = sanitizeAmountKES(params.amountKES);
  const result = await inTransaction(params.client, async (tx: PosClient) => {
    // Re-validate against the balance under the customer's row lock: a concurrent refund or
    // sale that changes the balance commits before this lock is taken, so an over-repayment
    // that looked fine a moment ago is still refused here (§30).
    await store.lockPartyRow(tx, RECEIVABLE, businessId, customerId);
    const current = await store.findCustomer(businessId, customerId, tx);
    const check = validateRepayment(Number(current?.balanceKES ?? 0), amountKES);
    if (!check.ok) throw new RepaymentAborted(check.message ?? "That repayment could not be recorded.");
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
    const applied = await store.applyBalanceChange(
      businessId,
      { partyType: RECEIVABLE, partyId: customerId, partyName: customer.name },
      { deltaKES: -check.amountKES, direction: "CREDIT", paymentId: payment.id, note: clampNote(params.note) ?? "Repayment" },
      tx,
    );
    const balanceAfterKES = applied?.balanceKES ?? Number(current?.balanceKES ?? 0) - check.amountKES;
    await logPosAuditInTransaction(tx, {
      businessId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "POS_REPAYMENT_RECORDED",
      targetType: "CUSTOMER",
      targetId: customerId,
      before: { balanceKES: Number(current?.balanceKES ?? customer.balanceKES ?? 0) },
      after: { balanceKES: balanceAfterKES },
      metadata: { amountKES: check.amountKES, method: payment.method, paymentId: payment.id },
    });
    return { amountKES: check.amountKES, balanceKES: balanceAfterKES };
  }).catch((error: unknown) => {
    if (error instanceof RepaymentAborted) return { invalid: error.message };
    throw error;
  });

  if (result && "invalid" in result) {
    return { ok: false, code: "REPAYMENT_INVALID", message: result.invalid, warnings };
  }
  const done = result as { amountKES: number; balanceKES: number } | undefined;
  return { ok: true, warnings, amountKES: done?.amountKES ?? amountKES, balanceKES: done?.balanceKES ?? undefined };
}

/** Raised inside the repayment transaction when the re-validated balance no longer fits (§30). */
class RepaymentAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepaymentAborted";
  }
}
