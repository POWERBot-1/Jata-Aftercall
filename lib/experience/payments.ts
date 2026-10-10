/**
 * Order / booking payments (§25, §27)
 *
 * One payment stack. Customer orders, deposits and subscriptions all go through the
 * existing Paystack integration, the existing payment table and the existing idempotent
 * webhook handling — no second payment system (§25).
 *
 * Payment states are explicit and never inferred from intent:
 *   NOT_STARTED → INITIATED → PENDING → SUCCESS | FAILED | CANCELLED | EXPIRED
 * Order fulfilment stays independent: an order is UNPAID until a *verified* payment exists.
 */

import prisma from "../db";
import { getBaseUrl } from "../url";
import { generatePaymentReference } from "../paymentReference";
import { PAYMENT_CURRENCY } from "../paymentCurrency";
import { initializeTransaction, toKobo, verifyTransaction } from "../paystack";
import { createNotification } from "../notification";
import { logAudit } from "../audit";
import { formatKES } from "../format";

export const PAYMENT_PURPOSE = {
  SUBSCRIPTION: "SUBSCRIPTION",
  ORDER: "ORDER",
  BOOKING_DEPOSIT: "BOOKING_DEPOSIT",
} as const;

export type PaymentState = "NOT_STARTED" | "INITIATED" | "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED" | "EXPIRED";

/** Maps our stored payment row onto the explicit state machine (§27). */
export function paymentStateOf(payment: { status?: string | null } | null | undefined): PaymentState {
  if (!payment) return "NOT_STARTED";
  switch (payment.status) {
    case "PAID":
      return "SUCCESS";
    case "FAILED":
      return "FAILED";
    case "REFUNDED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
      return "PENDING";
    default:
      return "INITIATED";
  }
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  NOT_STARTED: "Not started",
  INITIATED: "Started",
  PENDING: "Processing",
  SUCCESS: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export type InitializeOrderPaymentInput = {
  businessId: string;
  orderId?: string;
  bookingId?: string;
  amountKES: number;
  email: string;
  customerName?: string;
  callbackPath: string;
  purpose?: string;
  metadata?: Record<string, unknown>;
};

export type InitializeResult =
  | { kind: "ok"; reference: string; authorizationUrl: string; mock: boolean; paymentId: string }
  | { kind: "error"; error: string; status: number };

/**
 * Create the payment row first, then ask Paystack to initialize. The amount always comes
 * from the server-priced order — never from the browser (§26).
 */
export type OrderPaymentRecord =
  | { kind: "error"; error: string; status: number }
  | { kind: "record"; paymentId: string; reference: string; amount: number; ownerId: string };

/**
 * Database step only: create the PENDING payment row for an order. No network call, so it can run inside the
 * checkout transaction. The provider call is separate (startOrderPayment) and must run after commit.
 */
export async function createOrderPaymentRecord(input: InitializeOrderPaymentInput, client: any = prisma): Promise<OrderPaymentRecord> {
  const amountKES = Math.max(0, Math.round(Number(input.amountKES) || 0));
  if (amountKES <= 0) return { kind: "error", error: "This order has nothing to pay.", status: 400 };

  const business = await client.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, ownerId: true, slug: true },
  });
  if (!business) return { kind: "error", error: "Business not found.", status: 404 };

  const reference = generatePaymentReference();
  const payment = await client.payment.create({
    data: {
      reference,
      businessId: business.id,
      userId: business.ownerId,
      amount: toKobo(amountKES),
      currency: PAYMENT_CURRENCY,
      status: "PENDING",
      purpose: input.purpose || PAYMENT_PURPOSE.ORDER,
      orderId: input.orderId || null,
      bookingId: input.bookingId || null,
      customerEmail: input.email.slice(0, 160),
    },
    select: { id: true, reference: true, amount: true },
  });
  return { kind: "record", paymentId: payment.id, reference: payment.reference, amount: payment.amount, ownerId: business.ownerId };
}

/**
 * Provider step: ask Paystack to start the payment for a row created by createOrderPaymentRecord. Makes a network
 * call, so it must never run while a database transaction is open.
 */
export async function startOrderPayment(
  record: Extract<OrderPaymentRecord, { kind: "record" }>,
  input: InitializeOrderPaymentInput,
): Promise<InitializeResult> {
  const amountKES = Math.max(0, Math.round(Number(input.amountKES) || 0));
  const payment = { id: record.paymentId, reference: record.reference, amount: record.amount };
  const business = { id: input.businessId, ownerId: record.ownerId };

  const callbackUrl = `${getBaseUrl()}${input.callbackPath.startsWith("/") ? input.callbackPath : `/${input.callbackPath}`}`;

  if (!process.env.PAYSTACK_SECRET_KEY) {
    if (process.env.NODE_ENV === "production") {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      return { kind: "error", error: "Online payments are temporarily unavailable. Please try again later.", status: 503 };
    }
    // Test/demo path only: never reachable in production (mirrors the existing checkout route).
    return {
      kind: "ok",
      reference: payment.reference,
      authorizationUrl: `${getBaseUrl()}/checkout/mock?reference=${encodeURIComponent(payment.reference)}&next=${encodeURIComponent(input.callbackPath)}`,
      mock: true,
      paymentId: payment.id,
    };
  }

  try {
    const initialized = await initializeTransaction({
      email: input.email,
      amount: payment.amount,
      currency: PAYMENT_CURRENCY,
      reference: payment.reference,
      callbackUrl,
      metadata: {
        businessId: business.id,
        purpose: input.purpose || PAYMENT_PURPOSE.ORDER,
        orderId: input.orderId || null,
        bookingId: input.bookingId || null,
        ...(input.metadata || {}),
      },
    });
    await logAudit({ actorId: business.ownerId, action: "ORDER_PAYMENT_INITIATED", targetType: "PAYMENT", targetId: payment.id, metadata: { reference: payment.reference, amountKES } });
    return { kind: "ok", reference: payment.reference, authorizationUrl: initialized.authorization_url, mock: false, paymentId: payment.id };
  } catch {
    await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
    return { kind: "error", error: "Paystack could not start this payment. Please try again.", status: 502 };
  }
}

/** Create the payment row, then ask Paystack to initialize (kept for existing callers). */
export async function initializeOrderPayment(input: InitializeOrderPaymentInput): Promise<InitializeResult> {
  const record = await createOrderPaymentRecord(input);
  if (record.kind === "error") return record;
  return startOrderPayment(record, input);
}

/**
 * Settle a verified order/deposit payment. Idempotent: the compare-and-set on PENDING means
 * concurrent webhook retries can only ever settle once (§27).
 */
export async function settleOrderPayment(
  paymentId: string,
  options: { eventId?: string; verification?: { paystackId?: string; raw?: unknown } } = {},
): Promise<{ alreadySettled: boolean; orderId?: string | null; bookingId?: string | null }> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");

    if (options.eventId) {
      const seen = await tx.processedWebhook.findUnique({ where: { id: options.eventId } });
      if (seen) return { alreadySettled: true, orderId: payment.orderId, bookingId: payment.bookingId };
    }
    if (payment.status === "PAID") {
      if (options.eventId) await tx.processedWebhook.create({ data: { id: options.eventId } });
      return { alreadySettled: true, orderId: payment.orderId, bookingId: payment.bookingId };
    }
    if (payment.status !== "PENDING") throw new Error("PAYMENT_NOT_PENDING");

    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "PAID",
        ...(options.verification?.paystackId ? { paystackId: options.verification.paystackId } : {}),
        ...(options.verification?.raw !== undefined ? { raw: JSON.stringify(options.verification.raw) } : {}),
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.payment.findUnique({ where: { id: payment.id } });
      if (latest?.status === "PAID") {
        if (options.eventId) await tx.processedWebhook.create({ data: { id: options.eventId } });
        return { alreadySettled: true, orderId: payment.orderId, bookingId: payment.bookingId };
      }
      throw new Error("PAYMENT_STATE_CHANGED");
    }

    if (payment.orderId) {
      const order = await tx.order.findUnique({ where: { id: payment.orderId }, select: { id: true, businessId: true, orderReference: true, totalKES: true, status: true, customerName: true } });
      if (order) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: "PAID",
            // Only an unpaid, not-yet-advanced order moves forward on payment (§27, §28).
            ...(["PENDING_PAYMENT", "PAYMENT_PROCESSING", "PAYMENT_VERIFIED", "DRAFT", "PENDING_CUSTOMER_CONFIRMATION"].includes(order.status)
              ? { status: "CONFIRMED" }
              : {}),
          },
        });
        await tx.analyticsEvent.create({
          data: { businessId: order.businessId, eventType: "PAYMENT_SUCCESS", subjectId: order.id },
        });
        await tx.notification.create({
          data: {
            businessId: order.businessId,
            eventType: "PAYMENT_VERIFIED",
            title: `Payment received — ${order.orderReference}`,
            message: `${order.customerName || "A customer"} paid ${formatKES(order.totalKES)}. Order ${order.orderReference}.`,
            channel: "WHATSAPP",
            status: "PENDING",
            referenceId: order.id,
            maxRetries: 3,
          },
        });
      }
    }

    if (payment.bookingId) {
      await tx.booking.updateMany({
        where: { id: payment.bookingId },
        data: { paymentStatus: "PAID", status: "CONFIRMED" },
      });
    }

    if (options.eventId) await tx.processedWebhook.create({ data: { id: options.eventId } });
    await tx.auditEvent.create({
      data: { action: "ORDER_PAYMENT_SETTLED", targetType: "PAYMENT", targetId: payment.id, metadata: JSON.stringify({ reference: payment.reference, orderId: payment.orderId, bookingId: payment.bookingId }) },
    });

    return { alreadySettled: false, orderId: payment.orderId, bookingId: payment.bookingId };
  });
}

/** Record a terminal failure without touching order fulfilment (§27). */
export async function failOrderPayment(paymentId: string): Promise<void> {
  await prisma.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED" } });
}

/**
 * Verify a customer's order payment directly with Paystack (used by the confirmation page).
 * Returns the explicit state — never assumes success.
 */
export async function verifyOrderPayment(reference: string): Promise<{ state: PaymentState; orderId?: string | null }> {
  const payment = await prisma.payment.findUnique({ where: { reference }, select: { id: true, status: true, orderId: true, amount: true, purpose: true } });
  if (!payment) return { state: "NOT_STARTED" };
  if (payment.status === "PAID") return { state: "SUCCESS", orderId: payment.orderId };
  if (payment.status !== "PENDING") return { state: paymentStateOf(payment), orderId: payment.orderId };

  if (process.env.NODE_ENV !== "production" && !process.env.PAYSTACK_SECRET_KEY) {
    // Test/demo confirmation path.
    await settleOrderPayment(payment.id, { verification: { paystackId: `mock_${reference}`, raw: { testMock: true } } });
    return { state: "SUCCESS", orderId: payment.orderId };
  }

  try {
    const transaction = await verifyTransaction(reference);
    if (transaction.status !== "success" || transaction.amount !== payment.amount || transaction.reference !== reference) {
      return { state: "PENDING", orderId: payment.orderId };
    }
    const settled = await settleOrderPayment(payment.id, { verification: { paystackId: String(transaction.id), raw: transaction } });
    return { state: "SUCCESS", orderId: settled.orderId };
  } catch {
    return { state: "PENDING", orderId: payment.orderId };
  }
}

/** Notify the business that a new order or booking arrived (§30). */
export async function notifyNewOrder(params: {
  businessId: string;
  orderReference: string;
  customerName: string;
  totalKES: number;
  orderId: string;
  summary: string;
}) {
  try {
    await createNotification({
      businessId: params.businessId,
      eventType: "NEW_ORDER",
      title: `New order ${params.orderReference}`,
      message: `${params.customerName} — ${params.summary}. Total ${formatKES(params.totalKES)}.`,
      referenceId: params.orderId,
    });
  } catch {
    // A failed notification must never roll back a completed order (§37).
  }
}

export async function notifyNewBooking(params: {
  businessId: string;
  customerName: string;
  serviceName: string;
  startAt: Date;
  bookingId: string;
}) {
  try {
    await createNotification({
      businessId: params.businessId,
      eventType: "BOOKING",
      title: "New booking",
      message: `${params.customerName} booked ${params.serviceName} on ${params.startAt.toLocaleString("en-KE")}.`,
      referenceId: params.bookingId,
    });
  } catch {
    // Notifications are best-effort; the booking stands either way (§37).
  }
}
