/**
 * Order Service (§15, §16, §17, §28, §34) — explicit state machine, deterministic calculation,
 * and idempotency protection.
 *
 * Every transition is validated server-side; frontend state changes or payment claims are
 * never trusted (§15, §35).
 */

import crypto from "crypto";
import prisma from "./db";
import { calculateCommerceTotal } from "./commerce-pricing";
import { chargeableUnitPrice, listPriceKES } from "./sale-pricing";
import { getExtendedAIConfig, resolveDeliveryZoneFee } from "./ai-config";
import { evaluateProductAvailability } from "./inventory";
import { commitOrderOnce, findIdempotencyRecord, requestHashOf, StockConflictError } from "./checkout-transaction";
import { createNotification } from "./notification";
import { logAudit } from "./audit";

export const ORDER_STATES = [
  "DRAFT",
  "PENDING_CUSTOMER_CONFIRMATION",
  "PENDING_PAYMENT",
  "PAYMENT_PROCESSING",
  "PAYMENT_VERIFIED",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export function isValidStateTransition(from: OrderState, to: OrderState): boolean {
  const validTransitions: Record<OrderState, OrderState[]> = {
    DRAFT: ["PENDING_CUSTOMER_CONFIRMATION", "CANCELLED"],
    PENDING_CUSTOMER_CONFIRMATION: ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED"],
    PENDING_PAYMENT: ["PAYMENT_PROCESSING", "PAYMENT_VERIFIED", "CANCELLED", "PENDING_PAYMENT"],
    PAYMENT_PROCESSING: ["PAYMENT_VERIFIED", "CANCELLED"],
    PAYMENT_VERIFIED: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "READY", "CANCELLED"],
    PROCESSING: ["READY", "CANCELLED"],
    READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
    OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
    COMPLETED: ["REFUNDED"],
    CANCELLED: ["CANCELLED"], // Terminal; no exit
    REFUNDED: ["REFUNDED"], // Terminal
  };
  return (validTransitions[from] || []).includes(to);
}

export function formatOrderReference(datePrefix: string, sequence: number): string {
  const seqStr = String(sequence).padStart(6, "0");
  return `JATA-ORD-${datePrefix}-${seqStr}`;
}

export function deriveIdempotentOrderReference(businessId: string, idempotencyKey: string, datePrefix?: string): string {
  const prefix = datePrefix || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const digest = crypto.createHash("sha256").update(`${businessId}:${idempotencyKey}`).digest("hex");
  const numericSeq = parseInt(digest.slice(0, 8), 16) % 1_000_000;
  return formatOrderReference(prefix, numericSeq);
}

export type CreatedOrderSummary = {
  id: string;
  orderReference: string;
  businessId: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  status: OrderState;
  paymentStatus: "UNPAID" | "PAID";
  subtotalKES: number;
  deliveryFeeKES: number;
  discountKES: number;
  taxKES: number;
  totalKES: number;
  currency: string;
  fulfilmentType: "PICKUP" | "DELIVERY";
  deliveryLocation: string | null;
  deliveryInstructions: string | null;
  lineItems: Array<{
    productId?: string;
    serviceId?: string;
    name: string;
    variantDesc?: string;
    quantity: number;
    unitPriceKES: number;
    lineSubtotalKES: number;
  }>;
  preview: boolean;
  idempotent: boolean;
  createdAt: string;
};

/**
 * Idempotency for AI and order-API creation is durable: it is a CheckoutIdempotencyRecord row written in the same
 * transaction as the order (lib/checkout-transaction.ts). No in-memory cache is used.
 */

/**
 * Verifies whether a payment claim is backed by an authoritative server-side PAID Payment record (§15).
 * Browser-supplied `paymentStatus = "PAID"` or `"I have paid"` is never trusted.
 */
export async function hasServerVerifiedOrderPayment(params: {
  businessId: string;
  orderId?: string | null;
  paymentReference?: string | null;
}): Promise<boolean> {
  if (!params.businessId) return false;
  if (!params.orderId && !params.paymentReference) return false;
  try {
    if (params.paymentReference && prisma.payment?.findUnique) {
      const payment = await prisma.payment.findUnique({ where: { reference: params.paymentReference } });
      if (payment && payment.businessId === params.businessId && payment.status === "PAID") {
        return true;
      }
    }
    if (params.orderId && prisma.payment?.findFirst) {
      const payment = await prisma.payment.findFirst({
        where: { businessId: params.businessId, orderId: params.orderId, status: "PAID" },
      });
      if (payment && payment.status === "PAID") {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function createAuthoritativeOrder(input: {
  businessId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  items?: Array<{
    productId?: string;
    serviceId?: string;
    name?: string;
    variantDesc?: string;
    quantity?: number;
    unitPriceKES?: number;
  }>;
  deliveryFeeKES?: number;
  discountKES?: number;
  taxRate?: number;
  fulfilmentType?: "PICKUP" | "DELIVERY";
  deliveryLocation?: string | null;
  deliveryInstructions?: string | null;
  idempotencyKey?: string | null;
  preview?: boolean;
  confirmedByCustomer?: boolean;
  actorId?: string | null;
}): Promise<CreatedOrderSummary> {
  const { businessId } = input;
  if (!businessId) throw new Error("businessId is required — tenant isolation enforced.");

  const preview = Boolean(input.preview);
  const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
    ? input.idempotencyKey.trim().slice(0, 120)
    : null;

  const rawItems = Array.isArray(input.items) ? input.items : [];

  // The request, not the price, identifies the attempt. A retry with the same key and the same request returns the
  // order created the first time, before any repricing or stock check: stock may already be gone because of it.
  const requestHash = requestHashOf({
    scope: "ai.order",
    businessId,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone?.trim() || null,
    customerEmail: input.customerEmail?.trim() || null,
    fulfilment: input.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP",
    deliveryLocation: input.deliveryLocation || null,
    deliveryInstructions: input.deliveryInstructions || null,
    items: rawItems.map((raw: any) => ({
      productId: raw?.productId ?? null,
      serviceId: raw?.serviceId ?? null,
      quantity: Math.max(1, Math.round(Number(raw?.quantity) || 1)),
      variantDesc: raw?.variantDesc ?? null,
    })),
  });
  if (idempotencyKey) {
    const prior = await findIdempotencyRecord(businessId, "ai.order", idempotencyKey);
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw new Error("This request key was already used for a different order.");
      }
      return summaryForStoredOrder(prior.orderId, businessId);
    }
  }
  // One instant for the whole order, so every line is priced at the same moment (sale windows, lib/sale-pricing.ts).
  const now = new Date();
  const bulkRules = await getExtendedAIConfig(businessId)
    .then((config) => config.bulkPricing)
    .catch(() => []);
  const resolvedLines: Array<{
    productId?: string;
    serviceId?: string;
    name: string;
    variantDesc?: string;
    quantity: number;
    unitPriceKES: number;
  }> = [];

  for (const raw of rawItems) {
    const quantity = Math.max(1, Math.round(Number(raw.quantity) || 1));
    if (raw.productId && prisma.product?.findFirst) {
      const dbProduct = await prisma.product
        .findFirst({ where: { id: raw.productId, businessId } })
        .catch(() => null);
      if (dbProduct) {
        const availability = evaluateProductAvailability({ product: dbProduct, requestedQuantity: quantity });
        if (!availability.available) {
          throw new Error(availability.reason);
        }
        // A product with no price cannot be sold at 0 (checkout refuses it too).
        if (listPriceKES(dbProduct) === null) {
          throw new Error(`${dbProduct.name} has no price set, so it cannot be ordered yet.`);
        }
        resolvedLines.push({
          productId: dbProduct.id,
          name: dbProduct.name,
          variantDesc: raw.variantDesc,
          quantity,
          // Always the authoritative database price at this instant, never the client-supplied price (§16).
          unitPriceKES: chargeableUnitPrice({
            product: dbProduct,
            productName: dbProduct.name,
            quantity,
            now,
            rules: bulkRules,
          }).unitPriceKES,
        });
        continue;
      }
    }

    // A line that is not in this business catalogue cannot carry a caller-supplied price.
    throw new Error("Item is not in this business catalogue.");
  }

  const subtotalKES = resolvedLines.reduce((sum, line) => sum + line.quantity * line.unitPriceKES, 0);
  let deliveryFeeKES = 0;
  if (input.fulfilmentType === "DELIVERY") {
    const config = await getExtendedAIConfig(businessId).catch(() => null);
    const zoneResult = config ? resolveDeliveryZoneFee(config.delivery, input.deliveryLocation, subtotalKES) : null;
    if (!zoneResult?.allowed || !zoneResult.matchedZone) {
      throw new Error(`Delivery is not configured for ${input.deliveryLocation || "that area"}.`);
    }
    deliveryFeeKES = zoneResult.feeKES;
  }

  const calculation = calculateCommerceTotal({
    lineItems: resolvedLines,
    deliveryFeeKES,
    // Caller-supplied discounts are not authoritative. There is no customer-controlled discount source.
    discountKES: 0,
    taxRate: input.taxRate,
  });

  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const orderReference = idempotencyKey
    ? deriveIdempotentOrderReference(businessId, idempotencyKey, datePrefix)
    : formatOrderReference(datePrefix, Math.floor(100000 + Math.random() * 899999));

  // Preview mode (§28, §53): strictly isolated from production.
  // Never persists to DB, never reserves stock, never sends live notifications.
  if (preview) {
    const previewSummary: CreatedOrderSummary = {
      id: `preview_${orderReference}`,
      orderReference,
      businessId,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone?.trim() || null,
      customerEmail: input.customerEmail?.trim() || null,
      status: "DRAFT",
      paymentStatus: "UNPAID",
      subtotalKES: calculation.subtotalKES,
      deliveryFeeKES: calculation.deliveryFeeKES,
      discountKES: calculation.discountKES,
      taxKES: calculation.taxKES,
      totalKES: calculation.totalKES,
      currency: calculation.currency,
      fulfilmentType: input.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP",
      deliveryLocation: input.deliveryLocation || null,
      deliveryInstructions: input.deliveryInstructions || null,
      lineItems: calculation.lineItems,
      preview: true,
      idempotent: false,
      createdAt: new Date().toISOString(),
    };
    return previewSummary;
  }

  const initialState: OrderState = input.confirmedByCustomer
    ? "PENDING_PAYMENT"
    : "PENDING_CUSTOMER_CONFIRMATION";

  // One transaction: the idempotency record, the stock decrement (compare-and-set), and the order. A failure in any
  // of them rolls back all of them, so reserved stock is never left behind by a failed order write (§18, §28).
  const committed = await commitOrderOnce({
    businessId,
    scope: "ai.order",
    idempotencyKey,
    requestHash,
    stockLines: calculation.lineItems
      .filter((line) => Boolean(line.productId))
      .map((line) => ({ productId: line.productId as string, quantity: line.quantity, name: line.name })),
    create: async (tx: any) => {
      const created = await tx.order.create({
        data: {
          orderReference,
          businessId,
          customerName: input.customerName.trim(),
          customerPhone: input.customerPhone?.trim() || null,
          customerEmail: input.customerEmail?.trim() || null,
          status: initialState,
          paymentStatus: "UNPAID", // Never PAID on creation without server payment verification (§15)
          subtotalKES: calculation.subtotalKES,
          deliveryFeeKES: calculation.deliveryFeeKES,
          discountKES: calculation.discountKES,
          totalKES: calculation.totalKES,
          currency: calculation.currency,
          fulfilmentType: input.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP",
          deliveryLocation: input.deliveryLocation || null,
          deliveryInstructions: input.deliveryInstructions || null,
          source: "AI_FRONT_DESK",
          ...(calculation.lineItems.length > 0
            ? {
                items: {
                  create: calculation.lineItems.map((line) => ({
                    productId: line.productId || null,
                    serviceId: line.serviceId || null,
                    name: line.name,
                    variantDesc: line.variantDesc || null,
                    quantity: line.quantity,
                    unitPriceKES: line.unitPriceKES,
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });
      return { id: created.id as string };
    },
  }).catch((error: unknown) => {
    if (error instanceof StockConflictError) throw new Error(error.message);
    throw error instanceof Error ? error : new Error("ORDER_PERSISTENCE_FAILED");
  });

  if (committed.kind === "KEY_REUSED") {
    throw new Error("This request key was already used for a different order.");
  }
  if (committed.kind === "REPLAY") {
    return summaryForStoredOrder(committed.record.orderId, businessId);
  }
  const orderId = committed.value.id;

  await logAudit({
    actorId: input.actorId || null,
    action: "ORDER_CREATED",
    targetType: "ORDER",
    targetId: orderId,
    metadata: { businessId, orderReference, totalKES: calculation.totalKES, status: initialState },
  });

  // Notify nominated business recipient asynchronously; notification failure never rolls back order (§22)
  try {
    await createNotification({
      businessId,
      eventType: "NEW_ORDER",
      title: `New Order ${orderReference}`,
      message: `Customer ${input.customerName} started order ${orderReference}. Total: KES ${calculation.totalKES}.`,
      referenceId: orderId,
    });
  } catch {
    // §22: Separate transaction success from notification delivery
  }

  const liveSummary: CreatedOrderSummary = {
    id: orderId,
    orderReference,
    businessId,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone?.trim() || null,
    customerEmail: input.customerEmail?.trim() || null,
    status: initialState,
    paymentStatus: "UNPAID",
    subtotalKES: calculation.subtotalKES,
    deliveryFeeKES: calculation.deliveryFeeKES,
    discountKES: calculation.discountKES,
    taxKES: calculation.taxKES,
    totalKES: calculation.totalKES,
    currency: calculation.currency,
    fulfilmentType: input.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP",
    deliveryLocation: input.deliveryLocation || null,
    deliveryInstructions: input.deliveryInstructions || null,
    lineItems: calculation.lineItems,
    preview: false,
    idempotent: false,
    createdAt: new Date().toISOString(),
  };

  return liveSummary;
}

/** The summary of an order that an earlier request with the same idempotency key already created. */
async function summaryForStoredOrder(orderId: string | null, businessId: string): Promise<CreatedOrderSummary> {
  const existingOrder = orderId
    ? await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } })
    : null;
  if (!existingOrder || existingOrder.businessId !== businessId) {
    throw new Error("ORDER_PERSISTENCE_FAILED");
  }
  return {
    id: existingOrder.id,
    orderReference: existingOrder.orderReference,
    businessId: existingOrder.businessId,
    customerName: existingOrder.customerName || "",
    customerPhone: existingOrder.customerPhone || null,
    customerEmail: existingOrder.customerEmail || null,
    status: existingOrder.status as OrderState,
    paymentStatus: (existingOrder.paymentStatus as "UNPAID" | "PAID") || "UNPAID",
    subtotalKES: existingOrder.subtotalKES,
    deliveryFeeKES: existingOrder.deliveryFeeKES,
    discountKES: existingOrder.discountKES,
    taxKES: 0,
    totalKES: existingOrder.totalKES,
    currency: existingOrder.currency,
    fulfilmentType: (existingOrder.fulfilmentType as "PICKUP" | "DELIVERY") || "PICKUP",
    deliveryLocation: existingOrder.deliveryLocation || null,
    deliveryInstructions: existingOrder.deliveryInstructions || null,
    lineItems: (existingOrder.items || []).map((it: any) => ({
      productId: it.productId || undefined,
      serviceId: it.serviceId || undefined,
      name: it.name,
      variantDesc: it.variantDesc || undefined,
      quantity: it.quantity,
      unitPriceKES: it.unitPriceKES,
      lineSubtotalKES: it.quantity * it.unitPriceKES,
    })),
    preview: false,
    idempotent: true,
    createdAt: existingOrder.createdAt ? new Date(existingOrder.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function resetOrderIdempotencyForTests() {
  // Nothing is held in memory: idempotency is durable in the database. Kept so test setup stays unchanged.
}
