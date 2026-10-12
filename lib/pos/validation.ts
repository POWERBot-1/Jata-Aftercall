import { validateSaleWrite } from "../sale-pricing";
/**
 * Route input handling (§56, §75)
 *
 * Every POS API route parses its body through this module. Nothing here trusts the browser:
 * ids are strings to be *looked up inside the tenant*, money and quantities are re-derived
 * server-side by `money.ts`/`inventory.ts`, and anything unrecognised is dropped rather than
 * passed along. Keeping the sanitizers in one place means a new screen cannot forget one.
 */

import { sanitizeText } from "@/lib/validation";
import { applyQuestionDefaults, sanitizeAnswers } from "./questionnaire";
import type { QuestionnaireAnswers } from "./types";
import type { RefundRequest, SaleItemRequest, SaleRequest } from "./sales";
import type { CustomerInput, ProductInput, StaffInput, SupplierInput } from "./store";
import type { OrderItemInput, PurchaseLineInput } from "./operations";

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_ITEMS_PER_REQUEST = 100;

export type JsonBody = Record<string, unknown>;

/** Reads a JSON body, refusing anything oversized or unparseable instead of throwing raw (§38). */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  const header = request.headers.get("content-length");
  if (header && Number(header) > MAX_BODY_BYTES) return {};
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {};
  }
  if (!raw || raw.length > MAX_BODY_BYTES) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonBody) : {};
  } catch {
    return {};
  }
}

export function text(body: JsonBody | null | undefined, key: string, max = 200): string {
  const value = body?.[key];
  if (typeof value !== "string") return "";
  return sanitizeText(value, max);
}

export function optionalText(body: JsonBody | null | undefined, key: string, max = 200): string | null {
  const value = text(body, key, max);
  return value || null;
}

export function number(body: JsonBody | null | undefined, key: string, fallback = 0): number {
  const value = body?.[key];
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function positiveNumber(body: JsonBody | null | undefined, key: string, fallback = 0): number {
  return Math.max(0, number(body, key, fallback));
}

export function bool(body: JsonBody | null | undefined, key: string, fallback = false): boolean {
  const value = body?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return fallback;
}

export function arrayOf(value: unknown, limit = MAX_ITEMS_PER_REQUEST): JsonBody[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).slice(0, limit) as JsonBody[];
}

/**
 * `businessId` is never taken from a body or a query string for authorization. Routes resolve
 * it from the URL segment and confirm membership server-side (`guard.ts`); this helper exists
 * only so a mismatch between the two can be detected and refused (§5, §75).
 */
export function bodyBusinessId(body: JsonBody): string {
  const value = body.businessId;
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

export function businessIdMismatch(pathBusinessId: string, body: JsonBody): boolean {
  const claimed = bodyBusinessId(body);
  return Boolean(claimed) && claimed !== pathBusinessId;
}

// ── Selling ────────────────────────────────────────────────────────────────────

export function sanitizeSaleItems(body: JsonBody): SaleItemRequest[] {
  return arrayOf(body.items).map((item) => ({
    productId: optionalText(item, "productId", 64),
    name: optionalText(item, "name", 120),
    quantity: positiveNumber(item, "quantity", 1),
    unitPriceKES: item.unitPriceKES == null ? null : positiveNumber(item, "unitPriceKES"),
    discountKES: item.discountKES == null ? null : positiveNumber(item, "discountKES"),
    discountPercent: item.discountPercent == null ? null : positiveNumber(item, "discountPercent"),
    unitKey: optionalText(item, "unitKey", 24),
    variantDesc: optionalText(item, "variantDesc", 120),
  }));
}

export function sanitizePayments(body: JsonBody): { method: string; amountKES: number; reference?: string | null }[] {
  return arrayOf(body.payments, 10).map((payment) => ({
    method: text(payment, "method", 32) || "cash",
    amountKES: positiveNumber(payment, "amountKES"),
    reference: optionalText(payment, "reference", 80),
  }));
}

export function sanitizeSaleRequest(body: JsonBody): SaleRequest {
  const kind = text(body, "kind", 12).toUpperCase();
  return {
    items: sanitizeSaleItems(body),
    payments: sanitizePayments(body),
    customerId: optionalText(body, "customerId", 64),
    staffId: optionalText(body, "staffId", 64),
    branchId: optionalText(body, "branchId", 64),
    channel: optionalText(body, "channel", 32),
    notes: optionalText(body, "notes", 500),
    kind: kind === "QUOTATION" || kind === "INVOICE" ? kind : "SALE",
    discountKES: body.discountKES == null ? null : positiveNumber(body, "discountKES"),
    discountPercent: body.discountPercent == null ? null : positiveNumber(body, "discountPercent"),
    feeKES: body.feeKES == null ? null : positiveNumber(body, "feeKES"),
  };
}

export function sanitizeRefundRequest(body: JsonBody): RefundRequest {
  return {
    saleId: text(body, "saleId", 64),
    amountKES: body.amountKES == null ? null : positiveNumber(body, "amountKES"),
    method: optionalText(body, "method", 32),
    reference: optionalText(body, "reference", 80),
    reason: optionalText(body, "reason", 240),
    items: arrayOf(body.items, MAX_ITEMS_PER_REQUEST).map((item) => ({
      saleItemId: text(item, "saleItemId", 64),
      quantity: positiveNumber(item, "quantity", 1),
    })),
  };
}

export function sanitizeRepayment(body: JsonBody) {
  return {
    customerId: text(body, "customerId", 64),
    amountKES: positiveNumber(body, "amountKES"),
    method: optionalText(body, "method", 32),
    reference: optionalText(body, "reference", 80),
    note: optionalText(body, "note", 500),
  };
}

// ── Catalogue, people and suppliers ────────────────────────────────────────────

export function sanitizeProductInput(body: JsonBody): ProductInput {
  const priceKES = positiveNumber(body, "priceKES");
  // The POS sale uses the same window rule as the catalogue (lib/sale-pricing.ts). Only validated when sent.
  const saleSent = body.salePriceKES !== undefined || body.salePriceStartsAt !== undefined || body.salePriceEndsAt !== undefined;
  let sale: ProductInput["sale"];
  let saleError: string | undefined;
  if (saleSent) {
    const result = validateSaleWrite({
      basePriceKES: priceKES,
      salePriceKES: body.salePriceKES == null || body.salePriceKES === "" ? null : Number(body.salePriceKES),
      startsAt: body.salePriceStartsAt,
      endsAt: body.salePriceEndsAt,
    });
    if (result.ok === true) {
      sale = { salePriceKES: result.salePriceKES, salePriceStartsAt: result.salePriceStartsAt, salePriceEndsAt: result.salePriceEndsAt };
    } else {
      saleError = result.error;
    }
  }
  return {
    saleError,
    sale,
    name: text(body, "name", 160),
    kind: text(body, "kind", 12).toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT",
    category: optionalText(body, "category", 80),
    description: optionalText(body, "description", 2000),
    unitKey: text(body, "unitKey", 24) || "piece",
    priceKES,
    wholesalePriceKES: body.wholesalePriceKES == null ? null : positiveNumber(body, "wholesalePriceKES"),
    costKES: body.costKES == null ? null : positiveNumber(body, "costKES"),
    sku: optionalText(body, "sku", 64),
    barcode: optionalText(body, "barcode", 64),
    trackInventory: bool(body, "trackInventory", true),
    reorderLevel: positiveNumber(body, "reorderLevel"),
    taxable: bool(body, "taxable"),
    durationMinutes: body.durationMinutes == null ? null : positiveNumber(body, "durationMinutes"),
    variantOptions: typeof body.variantOptions === "string" ? body.variantOptions.slice(0, 4000) : null,
    imageUrl: optionalText(body, "imageUrl", 2000),
    isActive: bool(body, "isActive", true),
    sortOrder: positiveNumber(body, "sortOrder"),
  };
}

export function sanitizeCustomerInput(body: JsonBody): CustomerInput {
  return {
    name: text(body, "name", 160),
    phone: optionalText(body, "phone", 32),
    email: optionalText(body, "email", 160),
    location: optionalText(body, "location", 160),
    customerNumber: optionalText(body, "customerNumber", 40),
    segment: optionalText(body, "segment", 60),
    notes: optionalText(body, "notes", 2000),
    creditEnabled: bool(body, "creditEnabled"),
    creditLimitKES: positiveNumber(body, "creditLimitKES"),
    isActive: bool(body, "isActive", true),
  };
}

export function sanitizeSupplierInput(body: JsonBody): SupplierInput {
  return {
    name: text(body, "name", 160),
    phone: optionalText(body, "phone", 32),
    email: optionalText(body, "email", 160),
    location: optionalText(body, "location", 160),
    termsDays: positiveNumber(body, "termsDays"),
    creditEnabled: bool(body, "creditEnabled"),
    notes: optionalText(body, "notes", 2000),
    isActive: bool(body, "isActive", true),
  };
}

export function sanitizeStaffInput(body: JsonBody): StaffInput {
  return {
    name: text(body, "name", 160),
    phone: optionalText(body, "phone", 32),
    email: optionalText(body, "email", 160),
    roleKey: text(body, "roleKey", 40) || "CASHIER",
    branchId: optionalText(body, "branchId", 64),
    commissionPercent: Math.min(100, positiveNumber(body, "commissionPercent")),
    isActive: bool(body, "isActive", true),
  };
}

export function sanitizeAssetInput(body: JsonBody) {
  return {
    label: text(body, "label", 40) || "Item",
    name: text(body, "name", 160),
    identifier: optionalText(body, "identifier", 80),
    detailsJson: typeof body.details === "string" ? body.details.slice(0, 4000) : null,
  };
}

// ── Stock, purchasing, expenses ────────────────────────────────────────────────

export function sanitizeAdjustmentInput(body: JsonBody) {
  return {
    productId: text(body, "productId", 64),
    reason: text(body, "reason", 32).toUpperCase(),
    quantity: positiveNumber(body, "quantity"),
    note: optionalText(body, "note", 240),
    branchId: optionalText(body, "branchId", 64),
  };
}

export function sanitizeTransferInput(body: JsonBody) {
  return {
    productId: text(body, "productId", 64),
    quantity: positiveNumber(body, "quantity"),
    fromBranchId: optionalText(body, "fromBranchId", 64) ?? "",
    toBranchId: text(body, "toBranchId", 64),
    note: optionalText(body, "note", 240),
  };
}

export function sanitizeCountInput(body: JsonBody) {
  return {
    productId: text(body, "productId", 64),
    counted: positiveNumber(body, "counted"),
    branchId: optionalText(body, "branchId", 64),
    note: optionalText(body, "note", 240),
  };
}

export function sanitizePurchaseLines(body: JsonBody): PurchaseLineInput[] {
  return arrayOf(body.items).map((item) => ({
    productId: optionalText(item, "productId", 64),
    name: optionalText(item, "name", 160),
    quantity: positiveNumber(item, "quantity", 1),
    unitCostKES: item.unitCostKES == null ? null : positiveNumber(item, "unitCostKES"),
    unitKey: optionalText(item, "unitKey", 24),
  }));
}

export function sanitizePurchaseInput(body: JsonBody) {
  return {
    supplierId: optionalText(body, "supplierId", 64),
    items: sanitizePurchaseLines(body),
    reference: optionalText(body, "reference", 40),
    expectedAt: optionalText(body, "expectedAt", 40),
    notes: optionalText(body, "notes", 1000),
    // Left undefined when the caller did not say, so `createPurchase` can apply the same default
    // the purchase screen uses rather than a contradiction (§12, §33).
    receiveNow: body.receiveNow == null ? undefined : bool(body, "receiveNow"),
  };
}

export function sanitizeReceiveInput(body: JsonBody) {
  return {
    purchaseId: text(body, "purchaseId", 64),
    items: arrayOf(body.items).map((item) => ({
      purchaseItemId: text(item, "purchaseItemId", 64),
      quantity: positiveNumber(item, "quantity", 1),
    })),
    payment: body.payment && typeof body.payment === "object"
      ? {
          amountKES: positiveNumber(body.payment as JsonBody, "amountKES"),
          method: optionalText(body.payment as JsonBody, "method", 32),
          reference: optionalText(body.payment as JsonBody, "reference", 80),
        }
      : null,
  };
}

export function sanitizeExpenseInput(body: JsonBody) {
  return {
    categoryKey: text(body, "categoryKey", 40) || "other",
    label: optionalText(body, "label", 120),
    amountKES: positiveNumber(body, "amountKES"),
    method: optionalText(body, "method", 32),
    reference: optionalText(body, "reference", 80),
    occurredAt: optionalText(body, "occurredAt", 40),
    notes: optionalText(body, "notes", 1000),
  };
}

// ── Orders (§28, §29) ──────────────────────────────────────────────────────────

export function sanitizeOrderItems(body: JsonBody): OrderItemInput[] {
  return arrayOf(body.items).map((item) => ({
    productId: optionalText(item, "productId", 64),
    name: optionalText(item, "name", 160),
    quantity: positiveNumber(item, "quantity", 1),
    unitPriceKES: item.unitPriceKES == null ? null : positiveNumber(item, "unitPriceKES"),
    modifiers: optionalText(item, "modifiers", 1000),
  }));
}

export function sanitizeOrderInput(body: JsonBody) {
  return {
    customerId: optionalText(body, "customerId", 64),
    customerName: optionalText(body, "customerName", 160),
    customerPhone: optionalText(body, "customerPhone", 32),
    channel: optionalText(body, "channel", 32),
    items: sanitizeOrderItems(body),
    fulfilment: optionalText(body, "fulfilment", 32),
    address: optionalText(body, "address", 240),
    expectedAt: optionalText(body, "expectedAt", 40),
    depositKES: body.depositKES == null ? null : positiveNumber(body, "depositKES"),
    notes: optionalText(body, "notes", 1000),
    assignedToId: optionalText(body, "assignedToId", 64),
  };
}

// ── Configuration (§20, §22, §46, §48) ─────────────────────────────────────────

/**
 * Answers are the only client-supplied part of a configuration, and they are validated
 * question by question: unknown ids are dropped, values are coerced to the question's kind,
 * and options must exist (§22, §56).
 *
 * The defaults the questionnaire was already showing on screen are then made explicit (§41): the
 * profile the server builds must match the profile the owner was looking at, and a question the
 * owner tapped past must not silently configure nothing.
 */
export function sanitizeAnswersPayload(body: JsonBody): QuestionnaireAnswers {
  const answers = body.answers && typeof body.answers === "object" ? body.answers : body;
  return applyQuestionDefaults(sanitizeAnswers(answers));
}

export function sanitizeTerminologyPayload(body: JsonBody): Record<string, string> {
  const source = body.terminology && typeof body.terminology === "object" ? (body.terminology as JsonBody) : {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    const clean = sanitizeText(value, 40);
    if (clean) result[key] = clean;
  }
  return result;
}

export function sanitizeClonePayload(body: JsonBody) {
  return {
    targetBusinessId: text(body, "targetBusinessId", 64),
    scopes: Array.isArray(body.scopes)
      ? body.scopes.filter((scope): scope is string => typeof scope === "string").slice(0, 20)
      : [],
    templateKey: optionalText(body, "templateKey", 40),
  };
}

export function sanitizeTemplatePayload(body: JsonBody) {
  return {
    name: text(body, "name", 80),
    description: optionalText(body, "description", 240),
  };
}

// ── Reporting ranges (§35) ─────────────────────────────────────────────────────

export type RangeQuery = { from?: string; to?: string };

/**
 * A report range comes from the query string, is bounded, and defaults to today.
 *
 * Two rules matter for correctness (§35, §47): a date picked on a screen means *that whole day*,
 * and a default of zero days means "today since midnight" — not "since this exact instant", which
 * would hand a business an empty Sales History immediately after its first sale.
 */
export function sanitizeRange(query: RangeQuery, defaultDays = 0): { from: Date; to: Date } {
  const now = new Date();
  const requestedTo = parseDate(query.to);
  const requestedFrom = parseDate(query.from);
  const to = requestedTo ? endOfDay(requestedTo) : now;
  const from = requestedFrom
    ? startOfDay(requestedFrom)
    : defaultDays <= 0
      ? startOfDay(to)
      : new Date(to.getTime() - defaultDays * 86_400_000);
  if (from.getTime() > to.getTime()) return { from: to, to: from };
  // A range wider than a year is refused rather than scanned (§35: reports stay fast).
  const yearAgo = new Date(to.getTime() - 366 * 86_400_000);
  return { from: from.getTime() < yearAgo.getTime() ? yearAgo : from, to };
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** The last instant of the day a date falls on — "to 3 October" means the whole of 3 October. */
export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
