import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, assertBusinessRole, TenantError } from "@/lib/tenant";
import { initializeTransaction, toKobo } from "@/lib/paystack";
import { getBaseUrl } from "@/lib/url";
import { generatePaymentReference } from "@/lib/paymentReference";
import { PAYMENT_CURRENCY } from "@/lib/paymentCurrency";
import { INTERACTIVE_PLAN_KEY, assertInteractivePlanPricing } from "@/lib/experience/entitlement";
import { POS_PLAN_KEY, assertPosPlanPricing } from "@/lib/pos/entitlement";
import { isAutopilotPlanKey, assertAutopilotPlanPricing } from "@/lib/autopilot/entitlement";
import { CHECKOUT_PENDING_WINDOW_MS, checkoutStatusUrl } from "@/lib/checkoutPolicy";

type PlanRow = {
  id: string;
  key: string;
  name: string;
  priceKES: number;
  durationDays: number;
  isActive: boolean;
};

function fail(status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, error, ...extra }, { status });
}

/**
 * Starts a subscription payment.
 *
 * Callers may address a plan either by its stored `planId` (every existing flow) or — for the
 * JATA Autopilot workspace — by its allowlisted `planKey`. The key path exists because an
 * activation button must never be a dead end: a stale or missing stored id used to make the
 * button return before any request was sent, so nothing the owner could see ever happened.
 * The key is checked against the server's own catalogue, and the amount always comes from the
 * stored plan row afterwards — never from the browser.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return fail(401, "SIGN_IN_REQUIRED", "Please sign in to continue.");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "INVALID_REQUEST", "Invalid checkout request."); }
  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  const planKey = typeof body.planKey === "string" ? body.planKey.trim() : "";
  if (!businessId || (!planId && !planKey)) {
    return fail(400, "INVALID_REQUEST", "Choose a business and subscription plan before checkout.");
  }
  // Only the Autopilot workspace addresses plans by key. Any other key is refused rather than
  // silently ignored, so a caller cannot use this path to reach a plan it does not sell.
  if (planKey && !isAutopilotPlanKey(planKey)) {
    return fail(400, "PLAN_NOT_ALLOWED", "That plan cannot be started from this screen.");
  }

  try {
    await assertBusinessOwnership(businessId, session);
    const [business, planById, user] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }),
      planId ? prisma.planConfig.findUnique({ where: { id: planId } }) : Promise.resolve(null),
      prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } }),
    ]);
    if (!business) return fail(404, "BUSINESS_NOT_FOUND", "Business not found.");

    // Resolve the plan server-side. A key request self-heals a stale id: if the id no longer
    // matches a row, the stored row for the allowlisted key is used instead.
    let plan = planById as PlanRow | null;
    if (planKey) {
      if (plan && plan.key !== planKey) {
        return fail(409, "PLAN_MISMATCH", "The selected plan changed. Refresh the page and try again.");
      }
      if (!plan) {
        plan = ((await prisma.planConfig.findUnique({ where: { key: planKey } })) as PlanRow | null) ?? null;
      }
      if (!plan) {
        return fail(
          503,
          "PLAN_NOT_CONFIGURED",
          "JATA Autopilot plans are not configured in this deployment yet. An administrator must run `npm run seed` before activation can start.",
        );
      }
    }
    if (!plan) return fail(404, "PLAN_NOT_FOUND", "The selected plan is not available.");
    if (!plan.isActive || !Number.isSafeInteger(plan.priceKES) || plan.priceKES <= 0 || plan.durationDays <= 0) {
      return fail(400, "PLAN_UNAVAILABLE", "The selected plan is not currently available.");
    }
    // §49 — AI Business Front Desk package must resolve to KES 499 / 30 days server-side.
    // The server never trusts a client-supplied amount. This guard ensures the package price is authoritative.
    if (plan.key === "AI_BUSINESS_FRONT_DESK" && (plan.priceKES !== 499 || plan.durationDays !== 30)) {
      return fail(500, "PLAN_PRICING_INVALID", "AI Business Front Desk pricing configuration is invalid.");
    }
    // §26, §59 — the Interactive Business package resolves to KES 999 / 30 days server-side.
    // A client-supplied amount is never used; only the stored plan configures the charge.
    if (plan.key === INTERACTIVE_PLAN_KEY && !assertInteractivePlanPricing(plan)) {
      return fail(500, "PLAN_PRICING_INVALID", "Website Studio pricing configuration is invalid.");
    }
    // POS spec §45 — the Business POS package must resolve to KES 499 / 30 days server-side.
    // As with the packages above, a client-supplied amount is never used: only the stored plan
    // configures the charge, and a misconfigured plan fails closed instead of undercharging.
    if (plan.key === POS_PLAN_KEY && !assertPosPlanPricing(plan)) {
      return fail(500, "PLAN_PRICING_INVALID", "Business POS pricing configuration is invalid.");
    }
    if (isAutopilotPlanKey(plan.key)) {
      await assertBusinessRole(businessId, session, "manage_billing");
      if (!assertAutopilotPlanPricing(plan).ok) {
        return fail(500, "PLAN_PRICING_INVALID", "JATA Autopilot pricing configuration is invalid.");
      }
    }
    if (!user?.email) {
      return fail(400, "EMAIL_REQUIRED", "Your account needs a valid email before checkout.");
    }

    // Retire attempts nobody completed, so an abandoned Paystack tab cannot keep the plan locked
    // forever. A later provider-verified success still settles an EXPIRED row (lib/paymentVerification).
    await Promise.resolve(
      prisma.payment.updateMany({
        where: {
          businessId,
          planId: plan.id,
          status: "PENDING",
          createdAt: { lt: new Date(Date.now() - CHECKOUT_PENDING_WINDOW_MS) },
        },
        data: { status: "EXPIRED" },
      }),
    ).catch(() => undefined);

    const recentPending = await prisma.payment.findFirst({
      where: {
        businessId,
        planId: plan.id,
        status: "PENDING",
        createdAt: { gte: new Date(Date.now() - CHECKOUT_PENDING_WINDOW_MS) },
      },
      select: { reference: true },
    });
    if (recentPending) {
      return fail(
        409,
        "CHECKOUT_IN_PROGRESS",
        "A payment for this plan is already in progress. Check its status before starting another.",
        { reference: recentPending.reference, statusUrl: checkoutStatusUrl(recentPending.reference) },
      );
    }

    const reference = generatePaymentReference();
    const amount = toKobo(plan.priceKES);
    const payment = await prisma.payment.create({
      data: { reference, businessId, userId: session.userId, planId: plan.id, amount, currency: PAYMENT_CURRENCY, status: "PENDING" },
      select: { id: true, reference: true, amount: true, currency: true, status: true, createdAt: true },
    });

    // Duplicate-click guard. Two requests that both pass the read above can still create two
    // PENDING rows (there is no unique index on Payment). After creating, every attempt looks at
    // the same ordered list and keeps the oldest row; the loser cancels its own row and reports
    // the winner, so at most one Paystack session can be paid twice.
    const pendingRows = typeof (prisma.payment as { findMany?: unknown }).findMany === "function"
      ? await prisma.payment
          .findMany({
            where: { businessId, planId: plan.id, status: "PENDING" },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, reference: true },
          })
          .catch(() => [] as Array<{ id: string; reference: string }>)
      : [];
    const winner = pendingRows[0];
    if (winner && winner.id !== payment.id) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      return fail(
        409,
        "CHECKOUT_IN_PROGRESS",
        "A payment for this plan is already in progress. Check its status before starting another.",
        { reference: winner.reference, statusUrl: checkoutStatusUrl(winner.reference) },
      );
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      if (process.env.NODE_ENV === "production") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
        return fail(
          503,
          "PAYMENTS_UNAVAILABLE",
          "Online payments are temporarily unavailable. Please try again later.",
        );
      }
      return NextResponse.json({
        payment,
        authorization_url: `${getBaseUrl()}/checkout/mock?reference=${encodeURIComponent(reference)}`,
        reference,
        mock: true,
      });
    }

    try {
      const initialized = await initializeTransaction({
        email: user.email,
        amount,
        currency: PAYMENT_CURRENCY,
        reference,
        callbackUrl: `${getBaseUrl()}/checkout/callback`,
        metadata: { businessId, userId: session.userId, planId: plan.id, planKey: plan.key },
      });
      return NextResponse.json({ payment, authorization_url: initialized.authorization_url, reference, planKey: plan.key });
    } catch {
      await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      return fail(
        502,
        "PROVIDER_ERROR",
        "Paystack could not start this payment. Please try again.",
        { reference },
      );
    }
  } catch (error) {
    if (error instanceof TenantError) {
      return fail(
        error.status,
        error.status === 404 ? "BUSINESS_NOT_FOUND" : "TENANT_FORBIDDEN",
        error.status === 404 ? "Business not found." : "You are not authorized to pay for this business.",
      );
    }
    console.error("checkout request failed");
    return fail(500, "CHECKOUT_FAILED", "Checkout could not be started. Please try again.");
  }
}
