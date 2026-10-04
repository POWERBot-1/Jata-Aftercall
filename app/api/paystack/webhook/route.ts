import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { activateSubscriptionForPayment, isWebhookProcessed, verifyTransaction, verifyWebhookSignature } from "@/lib/paystack";
import { logAudit } from "@/lib/audit";
import { validatePaymentEvidence } from "@/lib/paymentVerification";
import { failOrderPayment, settleOrderPayment } from "@/lib/experience/payments";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!verifyWebhookSignature(rawBody, signature)) {
    await logAudit({ action: "WEBHOOK_SIGNATURE_FAILED" });
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  if (!event || typeof event !== "object") return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  const payload = event as { id?: string | number; event?: string; data?: Record<string, unknown> };
  const eventId = typeof payload.id === "string" ? payload.id.trim() : typeof payload.id === "number" && Number.isSafeInteger(payload.id) ? String(payload.id) : "";
  const type = typeof payload.event === "string" ? payload.event : "";
  const data = payload.data;
  if (!eventId || eventId.length > 200 || !type || type.length > 100 || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (await isWebhookProcessed(eventId)) return NextResponse.json({ status: "already_processed" });

  if (type === "refund.processed") {
    const refundReference = typeof data.transaction_reference === "string" ? data.transaction_reference : typeof data.reference === "string" ? data.reference : "";
    if (!refundReference || refundReference.length > 100) return NextResponse.json({ error: "Invalid webhook reference." }, { status: 400 });
    const refundPayment = await prisma.payment.findUnique({ where: { reference: refundReference } });
    if (!refundPayment) {
      await prisma.processedWebhook.upsert({ where: { id: eventId }, update: {}, create: { id: eventId } });
      return NextResponse.json({ status: "ignored" });
    }
    try {
      // Partial refunds are valid Paystack events, but this app has no partial-refund
      // ledger. Acknowledge and audit them without marking the payment fully refunded.
      if (data.currency === refundPayment.currency && typeof data.amount === "number" &&
          Number.isSafeInteger(data.amount) && data.amount > 0 && data.amount < refundPayment.amount) {
        // The event key and review audit are one atomic unit: never acknowledge a
        // partial refund unless its manual-review record is durably written.
        await prisma.$transaction(async (tx) => {
          await tx.processedWebhook.create({ data: { id: eventId } });
          await tx.auditEvent.create({
            data: {
              actorId: refundPayment.userId,
              action: "WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED",
              targetType: "PAYMENT",
              targetId: refundPayment.id,
              metadata: JSON.stringify({ amount: data.amount, currency: data.currency }),
            },
          });
        });
        return NextResponse.json({ status: "partial_refund_requires_review" });
      }
      if (data.amount !== refundPayment.amount || data.currency !== refundPayment.currency) return NextResponse.json({ error: "Refund evidence did not match this payment." }, { status: 400 });
      // A Business POS payment settles the separate POS subscription (§4, §80), so its refund must
      // revoke the POS — and must leave the business's AFTERCALL page plan alone. Resolved from the
      // stored plan, never from the webhook body.
      const refundPlanKey = refundPayment.planId
        ? (await prisma.planConfig.findUnique({ where: { id: refundPayment.planId }, select: { key: true } }))?.key ?? null
        : null;
      await prisma.$transaction(async (tx) => {
        await tx.processedWebhook.create({ data: { id: eventId } });
        const changed = await tx.payment.updateMany({ where: { id: refundPayment.id, status: "PAID" }, data: { status: "REFUNDED" } });
        if (changed.count && refundPayment.businessId && refundPlanKey === POS_PLAN_KEY) {
          await tx.posSubscription.updateMany({ where: { businessId: refundPayment.businessId }, data: { status: "SUSPENDED" } });
          await tx.posEntitlement.updateMany({ where: { businessId: refundPayment.businessId }, data: { status: "SUSPENDED" } });
          await tx.posConfiguration.updateMany({ where: { businessId: refundPayment.businessId, status: "LIVE" }, data: { status: "SUSPENDED" } });
          await tx.posAuditEvent.create({
            data: {
              businessId: refundPayment.businessId,
              actorId: refundPayment.userId,
              action: "POS_SUSPENDED",
              targetType: "PAYMENT",
              targetId: refundPayment.id,
              metadata: JSON.stringify({ reason: "REFUNDED" }),
            },
          });
        } else if (changed.count && refundPayment.businessId) {
          await tx.subscription.updateMany({ where: { businessId: refundPayment.businessId }, data: { status: "SUSPENDED" } });
          await tx.aIPackageEntitlement?.updateMany?.({ where: { businessId: refundPayment.businessId }, data: { status: "SUSPENDED" } });
        }
      });
      await logAudit({ actorId: refundPayment.userId, action: "WEBHOOK_REFUND_PROCESSED", targetType: "PAYMENT", targetId: refundPayment.id });
      return NextResponse.json({ status: "refund_processed" });
    } catch {
      if (await isWebhookProcessed(eventId)) return NextResponse.json({ status: "already_processed" });
      return NextResponse.json({ error: "Refund event could not be processed; Paystack may retry." }, { status: 503 });
    }
  }

  const reference = typeof data.reference === "string" ? data.reference : "";
  if (!reference || reference.length > 100) return NextResponse.json({ error: "Invalid webhook reference." }, { status: 400 });
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) {
    await prisma.processedWebhook.upsert({ where: { id: eventId }, update: {}, create: { id: eventId } });
    await logAudit({ action: "WEBHOOK_UNKNOWN_REFERENCE", metadata: { event: type } });
    return NextResponse.json({ status: "ignored" });
  }

  if (type === "charge.success") {
    try {
      const transaction = await verifyTransaction(reference);
      const payloadId = data.id === undefined ? "" : String(data.id);
      if (transaction.status !== "success" || !validatePaymentEvidence(payment, transaction).ok ||
          (payloadId && String(transaction.id) !== payloadId)) {
        await logAudit({ actorId: payment.userId, action: "WEBHOOK_TRANSACTION_MISMATCH", targetType: "PAYMENT", targetId: payment.id });
        return NextResponse.json({ error: "Webhook transaction did not match the pending payment." }, { status: 400 });
      }
      // One payment stack, two purposes (§25). Subscriptions activate the plan; orders and
      // deposits settle the order/booking. Both paths are idempotent (§27).
      // Anything that is not explicitly an order/booking payment settles the subscription, so
      // older subscription payments written before `purpose` existed keep working.
      const isOrderPayment =
        Boolean(payment.orderId || payment.bookingId) ||
        (typeof payment.purpose === "string" && payment.purpose !== "SUBSCRIPTION");
      if (!isOrderPayment) {
        const settled = await activateSubscriptionForPayment(payment.id, eventId, {
          paystackId: String(transaction.id),
          raw: { status: transaction.status, reference: transaction.reference, amount: transaction.amount, currency: transaction.currency, id: transaction.id },
        });
        await logAudit({ actorId: payment.userId, action: "WEBHOOK_CHARGE_SUCCESS", targetType: "PAYMENT", targetId: payment.id });
        return NextResponse.json({ status: settled.alreadySettled ? "already_paid" : "processed" });
      }

      const settled = await settleOrderPayment(payment.id, {
        eventId,
        verification: {
          paystackId: String(transaction.id),
          raw: { status: transaction.status, reference: transaction.reference, amount: transaction.amount, currency: transaction.currency, id: transaction.id },
        },
      });
      await logAudit({ actorId: payment.userId, action: "WEBHOOK_ORDER_CHARGE_SUCCESS", targetType: "PAYMENT", targetId: payment.id });
      return NextResponse.json({ status: settled.alreadySettled ? "already_paid" : "processed", orderId: settled.orderId, bookingId: settled.bookingId });
    } catch {
      console.error("payment webhook settlement failed");
      return NextResponse.json({ error: "Webhook could not be processed; Paystack may retry." }, { status: 503 });
    }
  }

  if (type === "charge.failed") {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.processedWebhook.create({ data: { id: eventId } });
        await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
        // An order stays UNPAID and visible to the owner; only the payment is marked failed (§27).
      });
      return NextResponse.json({ status: "marked_failed" });
    } catch {
      if (await isWebhookProcessed(eventId)) return NextResponse.json({ status: "already_processed" });
      return NextResponse.json({ error: "Webhook could not be processed; Paystack may retry." }, { status: 503 });
    }
  }

  // Acknowledge unknown signed events exactly once; they cannot activate a payment.
  await prisma.processedWebhook.upsert({ where: { id: eventId }, update: {}, create: { id: eventId } });
  return NextResponse.json({ status: "ignored" });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
