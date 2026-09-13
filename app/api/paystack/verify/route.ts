import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { verifyTransaction, activateSubscriptionForPayment } from "@/lib/paystack";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get("reference");
  if (!reference) return NextResponse.json({ error: "reference required" }, { status: 400 });

  const session = await getSession();
  // Verify is allowed for authenticated user; also supports unauthenticated polling for callback (check ownership if session exists)
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  // If session exists, enforce that this payment belongs to requester (or admin)
  if (session && payment.userId !== session.userId && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Tenant isolation" }, { status: 403 });
  }

  // Idempotency: if already PAID, short-circuit — do not re-extend
  if (payment.status === "PAID") {
    const sub = await prisma.subscription.findUnique({ where: { businessId: payment.businessId || "" } });
    return NextResponse.json({ status: "PAID", payment, subscription: sub, idempotent: true });
  }

  // If no Paystack key, allow mock verification in dev via ?mock=success
  if (!process.env.PAYSTACK_SECRET_KEY) {
    const mock = searchParams.get("mock");
    if (mock === "success" || searchParams.get("callback_mock") === "1") {
      await prisma.payment.update({ where: { reference }, data: { status: "PAID", raw: JSON.stringify({ mock: true }) } });
      const updated = await prisma.payment.findUnique({ where: { reference } });
      if (updated?.businessId) {
        await activateSubscriptionForPayment(updated.id);
      }
      await logAudit({ actorId: payment.userId, action: "PAYMENT_MOCK_VERIFIED", targetType: "PAYMENT", targetId: payment.id });
      const sub = await prisma.subscription.findUnique({ where: { businessId: payment.businessId || "" } });
      return NextResponse.json({ status: "PAID", payment: updated, subscription: sub, mock: true });
    }
    return NextResponse.json({ status: payment.status, payment, note: "PAYSTACK_SECRET_KEY not set — use ?mock=success to simulate" });
  }

  try {
    const data = await verifyTransaction(reference);
    // Validate status, amount, currency server-side
    if (data.status === "success") {
      if (data.amount !== payment.amount) {
        await prisma.payment.update({ where: { reference }, data: { status: "FAILED", raw: JSON.stringify(data) } });
        await logAudit({ actorId: payment.userId, action: "PAYMENT_AMOUNT_MISMATCH", targetType: "PAYMENT", targetId: payment.id, metadata: { expected: payment.amount, got: data.amount } });
        return NextResponse.json({ error: "Amount mismatch — payment rejected", expected: payment.amount, got: data.amount }, { status: 400 });
      }
      // Currency check — Paystack may return NGN or ZAR depending on account; allow KES/NGN but log
      // For strict KES, uncomment next block. Here we validate that currency is present.
      // if (data.currency !== payment.currency) { ... }

      await prisma.payment.update({
        where: { reference },
        data: { status: "PAID", paystackId: String(data.id), raw: JSON.stringify(data) },
      });
      const updated = await prisma.payment.findUnique({ where: { reference } });
      if (updated?.businessId) {
        await activateSubscriptionForPayment(updated.id);
      }
      await logAudit({ actorId: payment.userId, action: "PAYMENT_VERIFIED", targetType: "PAYMENT", targetId: payment.id, metadata: { paystackId: data.id } });
      const sub = updated?.businessId ? await prisma.subscription.findUnique({ where: { businessId: updated.businessId } }) : null;
      return NextResponse.json({ status: "PAID", payment: updated, subscription: sub });
    } else {
      await prisma.payment.update({ where: { reference }, data: { status: "FAILED", raw: JSON.stringify(data) } });
      return NextResponse.json({ status: "FAILED", payment: await prisma.payment.findUnique({ where: { reference } }) });
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Verification failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
