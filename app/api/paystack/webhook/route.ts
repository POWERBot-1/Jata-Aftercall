import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { verifyWebhookSignature, isWebhookProcessed, markWebhookProcessed, activateSubscriptionForPayment } from "@/lib/paystack";
import { logAudit } from "@/lib/audit";

// Paystack sends raw JSON body — we must read as text for HMAC

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!process.env.PAYSTACK_SECRET_KEY) {
    // In dev without secret, allow mock webhook if header absent but body contains mock flag
    // Still enforce idempotency for testing
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.mock === true) {
        const r = await handleEvent(parsed, parsed.id || parsed.data?.reference || `mock-${Date.now()}`);
        return NextResponse.json(r);
      }
    } catch {}
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    await logAudit({ action: "WEBHOOK_SIGNATURE_FAILED", metadata: { signature: signature?.slice(0, 20) } });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = String(event.id || event.data?.reference || `${event.event}-${event.data?.id || Date.now()}`);

  // Idempotency: duplicate delivery check
  if (await isWebhookProcessed(eventId)) {
    return NextResponse.json({ status: "already_processed", id: eventId });
  }

  const result = await handleEvent(event, eventId);
  return NextResponse.json(result);
}

async function handleEvent(event: any, eventId: string) {
  const type = event.event as string; // e.g. charge.success

  // Only process charge.success for activation; others update status
  if (type === "charge.success" || type === "charge.success.test") {
    const data = event.data;
    const reference = data.reference as string;
    const amount = data.amount as number;
    const currency = data.currency as string | undefined;
    const paystackId = String(data.id);

    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) {
      await markWebhookProcessed(eventId);
      await logAudit({ action: "WEBHOOK_UNKNOWN_REFERENCE", metadata: { reference, event: type } });
      return { status: "ignored", reason: "unknown reference" };
    }

    // Amount validation
    if (amount !== payment.amount) {
      await prisma.payment.update({ where: { reference }, data: { status: "FAILED", raw: JSON.stringify(event) } });
      await markWebhookProcessed(eventId);
      await logAudit({ action: "WEBHOOK_AMOUNT_MISMATCH", targetType: "PAYMENT", targetId: payment.id, metadata: { expected: payment.amount, got: amount } });
      return { status: "rejected", reason: "amount mismatch" };
    }

    // Idempotency second layer: if already PAID, don't re-activate
    if (payment.status === "PAID") {
      await markWebhookProcessed(eventId);
      return { status: "already_paid", reference };
    }

    await prisma.payment.update({
      where: { reference },
      data: { status: "PAID", paystackId, raw: JSON.stringify(event) },
    });

    // Activate subscription — activateSubscriptionForPayment is idempotent via its own key
    const updated = await prisma.payment.findUnique({ where: { reference } });
    if (updated?.businessId) {
      await activateSubscriptionForPayment(updated.id);
    }

    await markWebhookProcessed(eventId);
    await logAudit({ actorId: payment.userId, action: "WEBHOOK_CHARGE_SUCCESS", targetType: "PAYMENT", targetId: payment.id, metadata: { reference } });
    return { status: "processed", reference };
  }

  if (type === "charge.failed" || type === "charge.dispute.create") {
    const reference = event.data?.reference;
    if (reference) {
      await prisma.payment.update({ where: { reference }, data: { status: "FAILED", raw: JSON.stringify(event) } }).catch(() => null);
    }
    await markWebhookProcessed(eventId);
    return { status: "marked_failed", reference };
  }

  if (type === "refund.processed" || type === "refund.failed") {
    const reference = event.data?.transaction_reference || event.data?.reference;
    if (reference) {
      await prisma.payment.update({ where: { reference }, data: { status: type === "refund.processed" ? "REFUNDED" : "FAILED", raw: JSON.stringify(event) } }).catch(() => null);
      // Optionally suspend subscription on refund
      if (type === "refund.processed") {
        const pay = await prisma.payment.findUnique({ where: { reference } });
        if (pay?.businessId) {
          await prisma.subscription.update({ where: { businessId: pay.businessId }, data: { status: "SUSPENDED" } }).catch(() => null);
        }
      }
    }
    await markWebhookProcessed(eventId);
    return { status: "refund_processed", reference };
  }

  // Unknown event types are acknowledged but not processed — still mark to prevent replay abuse
  await markWebhookProcessed(eventId);
  return { status: "ignored", event: type };
}

// Paystack may retry with GET? Only accept POST; return 405 for others
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
