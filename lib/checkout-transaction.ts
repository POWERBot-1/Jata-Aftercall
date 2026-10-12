/**
 * One transaction per order, durable idempotency, and no network call inside the transaction.
 *
 * `commitOrderOnce` writes, in a single database transaction:
 *   1. the idempotency record (unique on businessId + scope + key). It is inserted FIRST, so a duplicate request
 *      fails on the unique index before it touches stock or creates anything;
 *   2. a compare-and-set stock decrement for each tracked product (a concurrent buyer makes the update match
 *      zero rows, which rolls the whole order back);
 *   3. the order (and any caller-created rows, such as the pending payment row);
 *   4. the record's link to the order, state ORDER_CREATED.
 *
 * Nothing here calls a payment provider. The provider step runs after commit (see lib/experience/payments.ts), and
 * the record's state lets a retry resume that step instead of creating a second order.
 */
import crypto from "crypto";
import prisma from "./db";

export type IdempotencyScope = "storefront.checkout" | "ai.order";

export type IdempotencyRecordView = {
  id: string;
  state: string;
  orderId: string | null;
  paymentId: string | null;
  requestHash: string;
  responseJson: string | null;
};

export type StockLine = { productId: string; quantity: number; name: string };

export class StockConflictError extends Error {
  productId: string;
  constructor(message: string, productId: string) {
    super(message);
    this.name = "StockConflictError";
    this.productId = productId;
  }
}

export type CommitOrderResult<T> =
  | { kind: "CREATED"; value: T; record: { id: string } | null }
  | { kind: "REPLAY"; record: IdempotencyRecordView }
  | { kind: "KEY_REUSED" };

/** Stable JSON (sorted keys) so the same request always hashes the same way. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function requestHashOf(value: unknown): string {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Compare-and-set stock decrement inside the order transaction. Products without a tracked quantity are not decremented. */
async function decrementStock(tx: any, businessId: string, line: StockLine): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: line.productId, businessId },
    select: { id: true, name: true, quantity: true, stockStatus: true },
  });
  if (!product) throw new StockConflictError(`${line.name} is no longer available.`, line.productId);
  if (typeof product.quantity !== "number") return;
  if (product.quantity < line.quantity) {
    throw new StockConflictError(`Insufficient stock for ${product.name}. Only ${product.quantity} remaining.`, product.id);
  }
  const remaining = product.quantity - line.quantity;
  const nextStatus = remaining === 0 ? "OUT_OF_STOCK" : remaining <= 3 ? "LOW_STOCK" : product.stockStatus;
  const updated = await tx.product.updateMany({
    where: { id: product.id, businessId, quantity: product.quantity },
    data: { quantity: remaining, stockStatus: nextStatus },
  });
  if (updated.count !== 1) {
    throw new StockConflictError(`${product.name} was just bought by another customer. Please review your order.`, product.id);
  }
}

export async function findIdempotencyRecord(
  businessId: string,
  scope: IdempotencyScope,
  key: string,
  client: any = prisma,
): Promise<IdempotencyRecordView | null> {
  return client.checkoutIdempotencyRecord.findUnique({
    where: { businessId_scope_key: { businessId, scope, key } },
    select: { id: true, state: true, orderId: true, paymentId: true, requestHash: true, responseJson: true },
  });
}

/**
 * Create an order atomically with its stock decrement and idempotency record. `create` runs inside the transaction
 * and must return the new order's id (and the payment row id, if it created one). It must not call the network.
 */
export async function commitOrderOnce<T extends { id: string; paymentId?: string | null }>(params: {
  businessId: string;
  scope: IdempotencyScope;
  idempotencyKey: string | null;
  requestHash: string;
  stockLines: StockLine[];
  create: (tx: any) => Promise<T>;
  client?: any;
}): Promise<CommitOrderResult<T>> {
  const db = params.client ?? prisma;
  const key = params.idempotencyKey;
  try {
    return await db.$transaction(async (tx: any) => {
      let recordId: string | null = null;
      if (key) {
        // First statement: a duplicate key fails here, before any stock or order row is written.
        const created = await tx.checkoutIdempotencyRecord.create({
          data: { businessId: params.businessId, scope: params.scope, key, requestHash: params.requestHash, state: "STARTED" },
          select: { id: true },
        });
        recordId = created.id;
      }
      for (const line of params.stockLines) {
        await decrementStock(tx, params.businessId, line);
      }
      const value = await params.create(tx);
      if (recordId) {
        await tx.checkoutIdempotencyRecord.update({
          where: { id: recordId },
          data: { state: "ORDER_CREATED", orderId: value.id, paymentId: value.paymentId ?? null },
        });
      }
      return { kind: "CREATED" as const, value, record: recordId ? { id: recordId } : null };
    });
  } catch (error) {
    if (key && isUniqueViolation(error)) {
      // Another request with the same key committed first. Answer with that request's outcome.
      const existing = await findIdempotencyRecord(params.businessId, params.scope, key, db);
      if (!existing) throw error;
      if (existing.requestHash !== params.requestHash) return { kind: "KEY_REUSED" };
      return { kind: "REPLAY", record: existing };
    }
    throw error;
  }
}

/** Store the final response for a key, so a retry returns the same answer. Only moves ORDER_CREATED or STARTED forward. */
export async function markCheckoutCompleted(recordId: string, response: { status: number; body: unknown }, client: any = prisma) {
  await client.checkoutIdempotencyRecord.updateMany({
    where: { id: recordId, state: { in: ["ORDER_CREATED", "STARTED"] } },
    data: { state: "COMPLETED", responseJson: JSON.stringify(response) },
  });
}

/**
 * Business rule for a new key that repeats an unpaid order. A customer who taps "Place order" twice with different keys,
 * or retries a stalled checkout, must not end up with two unpaid orders for the same basket. If an unpaid order with the
 * same basket, phone and total exists and was created within the window, that order is returned for recovery instead
 * of creating a second one. Its payment attempt is then checked by resumeOrderPayment. The stored Paystack link is
 * never replayed blindly. Nothing is written by this lookup.
 */
export const UNPAID_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

export async function findSameBasketUnpaidOrder(params: {
  businessId: string;
  customerPhone: string;
  totalKES: number;
  lines: { productId?: string | null; variantDesc?: string | null; quantity: number }[];
  now: Date;
  client?: any;
}): Promise<{ orderReference: string } | null> {
  const db = params.client ?? prisma;
  const signature = (items: { productId?: string | null; variantDesc?: string | null; quantity: number }[]) =>
    items.map((i) => `${i.productId ?? ""}|${i.variantDesc ?? ""}|${i.quantity}`).sort().join("\n");
  const wanted = signature(params.lines);
  const candidates = await db.order.findMany({
    where: {
      businessId: params.businessId,
      customerPhone: params.customerPhone,
      status: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      totalKES: params.totalKES,
      createdAt: { gte: new Date(params.now.getTime() - UNPAID_ATTEMPT_WINDOW_MS) },
    },
    select: { orderReference: true, items: { select: { productId: true, variantDesc: true, quantity: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const order of candidates) {
    if (signature(order.items) === wanted) return { orderReference: order.orderReference };
  }
  return null;
}
