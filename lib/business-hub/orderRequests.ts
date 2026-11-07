/**
 * Instant Order Requests (Business Hub feature A).
 *
 * An order request is an ENQUIRY. It is never a confirmed order, never a payment and never a
 * sale — the customer's basket is priced server-side from the owner's catalogue so the page can
 * show an honest estimate, and the only thing that makes it a sale is the owner moving the
 * status to CONFIRMED / COMPLETED in the Smart Customer Hub.
 *
 * Every function takes `businessId` and filters on it, including the item read-back: a foreign
 * request id matches nothing (tests/integration/business-hub-isolation.test.ts proves it).
 */

import prisma from "../db";
import { effectiveUnitPrice } from "../sale-pricing";
import {
  ActionResult,
  HUB_SUBJECTS,
  ValidationResult,
  cleanOptionalText,
  cleanSearch,
  cleanText,
  createReference,
  listHubActivity,
  normaliseContactMethod,
  recordHubActivity,
  validateContact,
} from "./shared";

export const ORDER_REQUEST_STATUSES = ["NEW", "REVIEWING", "CONFIRMED", "DECLINED", "COMPLETED", "CANCELLED"] as const;
export type OrderRequestStatus = (typeof ORDER_REQUEST_STATUSES)[number];

export const ORDER_REQUEST_STATUS_LABELS: Record<OrderRequestStatus, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Outcome language a customer can rely on: none of these statuses implies money changed hands. */
export const ORDER_REQUEST_STATUS_HINTS: Record<OrderRequestStatus, string> = {
  NEW: "The business has not opened this request yet.",
  REVIEWING: "The business is checking availability and price with you.",
  CONFIRMED: "The business confirmed this request. Agree payment and delivery directly with them.",
  DECLINED: "The business could not take this request.",
  COMPLETED: "The business marked this request as completed.",
  CANCELLED: "This request was cancelled.",
};

const MAX_ITEMS = 30;
const MAX_QUANTITY = 999;

/**
 * COMPLETED is final. DECLINED and CANCELLED can be reopened for review (a customer often comes
 * back), but nothing may leave COMPLETED: re-opening a finished request would rewrite history.
 */
const ALLOWED_TRANSITIONS: Record<OrderRequestStatus, OrderRequestStatus[]> = {
  NEW: ["REVIEWING", "CONFIRMED", "DECLINED", "CANCELLED"],
  REVIEWING: ["CONFIRMED", "DECLINED", "CANCELLED", "COMPLETED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  DECLINED: ["REVIEWING"],
  CANCELLED: ["REVIEWING"],
  COMPLETED: [],
};

export function isOrderRequestStatus(value: unknown): value is OrderRequestStatus {
  return typeof value === "string" && (ORDER_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isValidOrderRequestTransition(from: string, to: string): boolean {
  if (!isOrderRequestStatus(from) || !isOrderRequestStatus(to)) return false;
  if (from === to) return true; // an idempotent re-submission of the same status is not an error
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type CatalogueProduct = {
  id: string;
  /** PRODUCT rows are priced by `effectiveUnitPrice`; SERVICE rows arrive already priced. */
  kind?: "PRODUCT" | "SERVICE";
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  basePriceKES?: number | null;
  variantPriceKES?: number | null;
  salePriceKES?: number | null;
  salePriceStartsAt?: Date | string | null;
  salePriceEndsAt?: Date | string | null;
  isActive?: boolean | null;
  stockStatus?: string | null;
  /** Set for services: the price the page quoted, or null for a quote-only service. */
  unitPriceKES?: number | null;
};

export type ValidatedOrderRequestItem = {
  /** Null for a service line: the item is a snapshot of what the customer asked for. */
  productId: string | null;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceKES: number;
  lineTotalKES: number;
};

export type ValidatedOrderRequest = {
  requestKey: string;
  customerName: string;
  contactMethod: string;
  contactValue: string;
  message: string | null;
  items: ValidatedOrderRequestItem[];
  estimatedTotalKES: number;
};


/**
 * Validates a public submission against the tenant's own catalogue.
 *
 * The client sends product ids and quantities only — never a price. Prices come from the rows
 * the server loaded for this business, through the same `effectiveUnitPrice` rule the storefront
 * checkout uses, so a tampered request cannot create a KES 0 order estimate.
 */
export function validateOrderRequestInput(
  raw: unknown,
  products: CatalogueProduct[],
  now: Date = new Date(),
): ValidationResult<ValidatedOrderRequest> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const customerName = cleanText(body.customerName, 80);
  if (customerName.length < 2) return { ok: false, error: "Enter your name so the business knows who to reply to." };

  const contactMethod = normaliseContactMethod(body.contactMethod);
  if (!contactMethod) return { ok: false, error: "Choose how the business should reach you." };
  const contact = validateContact(contactMethod, body.contactValue);
  if (!contact.ok) return { ok: false, error: contact.error };

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) return { ok: false, error: "Add at least one item to your request." };
  if (rawItems.length > MAX_ITEMS) return { ok: false, error: `Add up to ${MAX_ITEMS} items in one request.` };

  const byId = new Map(products.filter((product) => product.isActive !== false).map((product) => [product.id, product]));
  const merged = new Map<string, ValidatedOrderRequestItem>();

  for (const entry of rawItems) {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const productId = typeof item.productId === "string" ? item.productId.trim().slice(0, 64) : "";
    const product = byId.get(productId);
    // A product or service id from another business (or a deleted one) simply does not exist here.
    if (!product) return { ok: false, error: "One of the items is no longer available. Please refresh and try again." };

    const quantity = Math.round(Number(item.quantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return { ok: false, error: `Choose between 1 and ${MAX_QUANTITY} of each item.` };
    }

    // Products keep the platform's pricing rule (sale windows included). A service carries the
    // price the page already quoted, and a quote-only service stays at 0 with no price claimed.
    const unitPriceKES =
      product.kind === "SERVICE"
        ? Math.max(0, Math.round(Number(product.unitPriceKES ?? 0)))
        : effectiveUnitPrice(product, now).unitPriceKES;
    const existing = merged.get(productId);
    const nextQuantity = Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + quantity);
    merged.set(productId, {
      productId: product.kind === "SERVICE" ? null : productId,
      name: product.name,
      imageUrl: product.imageUrl ?? null,
      quantity: nextQuantity,
      unitPriceKES,
      lineTotalKES: unitPriceKES * nextQuantity,
    });
  }

  const items = [...merged.values()];
  const requestKey = cleanText(body.requestKey, 64) || createReference("JATA-KEY", now);
  return {
    ok: true,
    value: {
      requestKey,
      customerName,
      contactMethod,
      contactValue: contact.value,
      message: cleanOptionalText(body.message, 500),
      items,
      estimatedTotalKES: items.reduce((total, item) => total + item.lineTotalKES, 0),
    },
  };
}

export type CreateOrderRequestInput = {
  businessId: string;
  input: ValidatedOrderRequest;
  ipHash?: string | null;
  sessionHash?: string | null;
  source?: string;
};

/**
 * Persists a request. Idempotent on `requestKey`: a double tap, a retried POST after a dropped
 * connection, or a browser back-button replay returns the ORIGINAL record instead of creating a
 * second request in the owner's hub. The (businessId, requestKey) unique index is the guard; the
 * pre-read is what lets us answer 200 instead of 500.
 */
export async function createOrderRequest({
  businessId,
  input,
  ipHash = null,
  sessionHash = null,
  source = "BUSINESS_PAGE",
}: CreateOrderRequestInput): Promise<{ idempotent: boolean; record: any }> {
  const existing = await prisma.orderRequest
    .findFirst({ where: { businessId, requestKey: input.requestKey }, include: { items: true } })
    .catch(() => null);
  if (existing) return { idempotent: true, record: existing };

  const reference = createReference("JATA-REQ");
  const record = await prisma.orderRequest.create({
    data: {
      businessId,
      reference,
      requestKey: input.requestKey,
      customerName: input.customerName,
      contactMethod: input.contactMethod,
      contactValue: input.contactValue,
      message: input.message,
      status: "NEW",
      itemCount: input.items.length,
      estimatedTotalKES: input.estimatedTotalKES,
      source: cleanText(source, 40) || "BUSINESS_PAGE",
      ipHash,
      sessionHash,
      items: {
        create: input.items.map((item) => ({
          businessId,
          productId: item.productId,
          name: item.name,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          unitPriceKES: item.unitPriceKES,
          lineTotalKES: item.lineTotalKES,
        })),
      },
    },
    include: { items: true },
  });

  await recordHubActivity(prisma, {
    businessId,
    subjectType: HUB_SUBJECTS.ORDER_REQUEST,
    subjectId: record.id,
    kind: "CREATED",
    summary: `Order request ${reference} from ${input.customerName}`,
    toStatus: "NEW",
    note: input.message,
  });

  return { idempotent: false, record };
}

export async function listOrderRequests(
  businessId: string,
  options: { status?: string | null; search?: string | null; take?: number } = {},
): Promise<any[]> {
  const where: Record<string, unknown> = { businessId };
  if (options.status && isOrderRequestStatus(options.status)) where.status = options.status;
  const search = cleanSearch(options.search);
  if (search) {
    where.OR = [
      { reference: { contains: search } },
      { customerName: { contains: search } },
      { contactValue: { contains: search } },
      { message: { contains: search } },
    ];
  }
  return prisma.orderRequest.findMany({
    where,
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, options.take ?? 200)),
  });
}

export async function getOrderRequest(businessId: string, id: string): Promise<any | null> {
  if (!businessId || !id) return null;
  return prisma.orderRequest.findFirst({ where: { id, businessId }, include: { items: true } }).catch(() => null);
}

/** Public read-back by reference: only the fields the customer themselves typed. */
export async function getOrderRequestByReference(reference: string): Promise<any | null> {
  const cleaned = cleanText(reference, 40);
  if (!cleaned) return null;
  return prisma.orderRequest
    .findUnique({ where: { reference: cleaned }, include: { items: true } })
    .catch(() => null);
}

export type UpdateOrderResult =
  | { ok: true; record: any; status?: never; error?: never }
  | { ok: false; status: number; error: string; record?: never };

export async function updateOrderRequestStatus(params: {
  businessId: string;
  id: string;
  status: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<UpdateOrderResult> {
  if (!isOrderRequestStatus(params.status)) {
    return { ok: false, status: 400, error: "Choose one of the available request statuses." };
  }
  const record = await getOrderRequest(params.businessId, params.id);
  if (!record) return { ok: false, status: 404, error: "That request is not in your customer hub." };
  if (!isValidOrderRequestTransition(record.status, params.status)) {
    return { ok: false, status: 409, error: `A ${record.status.toLowerCase()} request cannot move to ${params.status.toLowerCase()}.` };
  }

  const updated = await prisma.orderRequest.update({
    where: { id: record.id },
    data: { status: params.status, statusChangedAt: new Date() },
    include: { items: true },
  });

  if (updated.status !== record.status) {
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.ORDER_REQUEST,
      subjectId: record.id,
      kind: "STATUS_CHANGED",
      summary: `${record.reference} moved from ${record.status} to ${params.status}`,
      fromStatus: record.status,
      toStatus: params.status,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
  }
  return { ok: true, record: updated };
}

/** Owner-only internal note. Never sent to the customer and never shown on the public page. */
export async function setOrderRequestNotes(params: {
  businessId: string;
  id: string;
  notes: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<UpdateOrderResult> {
  const record = await getOrderRequest(params.businessId, params.id);
  if (!record) return { ok: false, status: 404, error: "That request is not in your customer hub." };
  const notes = cleanOptionalText(params.notes, 2000);
  const updated = await prisma.orderRequest.update({
    where: { id: record.id },
    data: { ownerNotes: notes },
    include: { items: true },
  });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.ORDER_REQUEST,
    subjectId: record.id,
    kind: notes ? "NOTE_ADDED" : "NOTE_CLEARED",
    summary: notes ? `Note added to ${record.reference}` : `Note cleared on ${record.reference}`,
    note: notes,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return { ok: true, record: updated };
}

export async function orderRequestHistory(businessId: string, id: string, take = 30) {
  return listHubActivity(prisma, businessId, { subjectType: HUB_SUBJECTS.ORDER_REQUEST, subjectId: id, take });
}

/**
 * Conversion statistics from recorded statuses only — nothing here counts a sale.
 * `confirmedOrCompleted` is "the business said yes", not "money was received".
 */
export async function orderRequestStats(businessId: string): Promise<{
  total: number;
  byStatus: Record<OrderRequestStatus, number>;
  confirmedOrCompleted: number;
  conversionRate: number;
  openRequests: number;
  estimatedValueKES: number;
}> {
  const rows = await prisma.orderRequest
    .findMany({ where: { businessId }, select: { status: true, estimatedTotalKES: true } })
    .catch(() => []);
  const byStatus = ORDER_REQUEST_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as Record<OrderRequestStatus, number>);
  let estimatedValueKES = 0;
  for (const row of rows) {
    if (isOrderRequestStatus(row.status)) byStatus[row.status] += 1;
    estimatedValueKES += Number(row.estimatedTotalKES ?? 0);
  }
  const total = rows.length;
  const confirmedOrCompleted = byStatus.CONFIRMED + byStatus.COMPLETED;
  return {
    total,
    byStatus,
    confirmedOrCompleted,
    conversionRate: total ? Math.round((confirmedOrCompleted / total) * 1000) / 10 : 0,
    openRequests: byStatus.NEW + byStatus.REVIEWING,
    estimatedValueKES,
  };
}
