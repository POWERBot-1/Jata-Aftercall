import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, TenantError } from "@/lib/tenant";
import { activateSubscriptionForPayment, verifyTransaction } from "@/lib/paystack";
import { logAudit } from "@/lib/audit";
import { classifyProviderStatus, validatePaymentEvidence } from "@/lib/paymentVerification";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to check this payment." }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const reference = searchParams.get("reference")?.trim() || "";
  if (!reference || reference.length > 100) return NextResponse.json({ error: "A valid payment reference is required." }, { status: 400 });

  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  if (payment.userId !== session.userId && session.role !== "ADMIN") {
    return NextResponse.json({ error: "You are not authorized to view this payment." }, { status: 403 });
  }
  if (payment.businessId) {
    try { await assertBusinessOwnership(payment.businessId, session); }
    catch (error) {
      const status = error instanceof TenantError ? error.status : 403;
      return NextResponse.json({ error: status === 404 ? "Business not found." : "You are not authorized to view this payment." }, { status });
    }
  }

  if (payment.status === "PAID") {
    const subscription = payment.businessId ? await prisma.subscription.findUnique({ where: { businessId: payment.businessId }, select: { status: true } }) : null;
    if (payment.businessId && !subscription) {
      try {
        const transaction = await verifyTransaction(reference);
        const evidence = validatePaymentEvidence(payment, transaction);
        if (transaction.status !== "success" || evidence.ok === false) {
          return NextResponse.json({ error: "Payment is recorded but could not be safely reconciled. Please contact support." }, { status: 503 });
        }
        const repaired = await activateSubscriptionForPayment(payment.id, undefined, {
          paystackId: String(transaction.id), raw: { status: transaction.status, reference: transaction.reference, amount: transaction.amount, currency: transaction.currency, id: transaction.id },
        });
        return NextResponse.json({ status: "PAID", subscriptionStatus: (repaired.subscription as { status?: string } | null)?.status ?? null, idempotent: true });
      } catch {
        return NextResponse.json({ error: "Payment is recorded but subscription status needs attention. Please try again or contact support." }, { status: 503 });
      }
    }
    return NextResponse.json({ status: "PAID", subscriptionStatus: subscription?.status ?? null, idempotent: true });
  }
  if (payment.status !== "PENDING") return NextResponse.json({ status: payment.status });

  const mockRequested = searchParams.get("mock") === "success";
  if (mockRequested && process.env.NODE_ENV !== "production" && !process.env.PAYSTACK_SECRET_KEY) {
    try {
      const result = await activateSubscriptionForPayment(payment.id, undefined, { raw: { testMock: true }, paystackId: `mock_${payment.reference}` });
      await logAudit({ actorId: payment.userId, action: "PAYMENT_TEST_MOCK_VERIFIED", targetType: "PAYMENT", targetId: payment.id });
      return NextResponse.json({ status: "PAID", subscriptionStatus: (result.subscription as { status?: string } | null)?.status ?? "ACTIVE", testMode: true });
    } catch {
      return NextResponse.json({ error: "This test payment could not be completed." }, { status: 409 });
    }
  }

  try {
    const transaction = await verifyTransaction(reference);
    const evidence = validatePaymentEvidence(payment, transaction);
    if (evidence.ok === false) {
      if (evidence.reason !== "REFERENCE_MISMATCH") {
        await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      }
      const action = evidence.reason === "AMOUNT_MISMATCH" ? "PAYMENT_AMOUNT_MISMATCH" : evidence.reason === "CURRENCY_MISMATCH" ? "PAYMENT_CURRENCY_MISMATCH" : "PAYMENT_REFERENCE_MISMATCH";
      await logAudit({ actorId: payment.userId, action, targetType: "PAYMENT", targetId: payment.id });
      return NextResponse.json({ status: "FAILED", error: "Paystack verification did not match this payment." }, { status: 400 });
    }
    const outcome = classifyProviderStatus(transaction.status);
    if (outcome.kind === "in_progress") {
      // Still in progress at Paystack: leave the payment PENDING so a later success
      // (verify retry or charge.success webhook) can still settle it.
      return NextResponse.json({ status: "PENDING", message: "Paystack is still processing this payment. Your subscription is not active yet." });
    }
    if (outcome.kind === "final_failure") {
      await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: outcome.status } });
      return NextResponse.json({ status: outcome.status, message: outcome.status === "CANCELLED" ? "Payment was cancelled." : "Payment was not completed." });
    }

    const settled = await activateSubscriptionForPayment(payment.id, undefined, {
      paystackId: String(transaction.id), raw: { status: transaction.status, reference: transaction.reference, amount: transaction.amount, currency: transaction.currency, id: transaction.id },
    });
    await logAudit({ actorId: payment.userId, action: "PAYMENT_VERIFIED", targetType: "PAYMENT", targetId: payment.id });
    return NextResponse.json({ status: "PAID", subscriptionStatus: (settled.subscription as { status?: string } | null)?.status ?? "ACTIVE", idempotent: settled.alreadySettled });
  } catch {
    console.error("payment verification failed");
    return NextResponse.json({ error: "Payment verification is temporarily unavailable. Refresh this page to check again." }, { status: 502 });
  }
}

export async function POST(req: Request) { return GET(req); }
