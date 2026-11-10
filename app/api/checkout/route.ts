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
import { MJENGO_PLAN_KEY } from "@/lib/mjengo/entitlement";
import { mjengoCheckoutRefusal } from "@/lib/mjengo/settlement";
import { isFrontDeskTierKey, assertFrontDeskTierPricing, AI_FRONT_DESK_VOICE_KEY } from "@/lib/frontDeskTiers";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";

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
          "JATA Autopilot plans are not configured in this deployment yet. An administrator must add the missing PlanConfig records before activation can start. No payment was taken.",
        );
      }
    }
    if (!plan) return fail(404, "PLAN_NOT_FOUND", "The selected plan is not available.");
    if (!plan.isActive || !Number.isSafeInteger(plan.priceKES) || plan.priceKES <= 0 || plan.durationDays <= 0) {
      return fail(400, "PLAN_UNAVAILABLE", "The selected plan is not currently available.");
    }

    // Voice checkout is available only after provider configuration, real live-call
    // verification, runtime call enablement and explicit customer-billing approval.
    // This check happens before Payment creation and before contacting Paystack.
    if (plan.key === AI_FRONT_DESK_VOICE_KEY && !getVoiceReadiness().canSell) {
      return fail(409, "PLAN_NOT_READY", "Front Desk Voice is awaiting provider activation. No payment has been started.");
    }

    // A lower Front Desk tier must not replace an active higher tier mid-term. Block before
    // creating a Payment row or contacting Paystack; no charge can be initiated by this path.
    if (isFrontDeskTierKey(plan.key)) {
      const currentSubscription = await prisma.subscription.findUnique({
        where: { businessId },
        select: { planId: true, status: true, expiresAt: true },
      });
      if (
        (currentSubscription?.status === "ACTIVE" || currentSubscription?.status === "EXPIRING") &&
        currentSubscription.expiresAt &&
        currentSubscription.expiresAt > new Date()
      ) {
        const currentPlan = await prisma.planConfig.findUnique({
          where: { id: currentSubscription.planId },
          select: { key: true },
        });
        const tierRank: Record<string, number> = {
          AI_BUSINESS_FRONT_DESK: 1,
          AI_FRONT_DESK_STANDARD: 2,
          AI_FRONT_DESK_PRO: 3,
          AI_FRONT_DESK_VOICE: 4,
        };
        const currentRank = currentPlan?.key ? tierRank[currentPlan.key] : undefined;
        const requestedRank = tierRank[plan.key];
        if (currentRank !== undefined && requestedRank < currentRank) {
          return fail(
            409,
            "DOWNGRADE_AT_PERIOD_END",
            "A lower Front Desk tier cannot replace your active paid tier before it expires. Your current access remains unchanged; contact support to arrange a change at renewal.",
            { currentTier: currentPlan?.key, currentExpiry: currentSubscription.expiresAt.toISOString() },
          );
        }
      }
    }
    // §49 + §41 — every AI Front Desk tier (Starter/Standard/Pro/Voice) must resolve to its
    // approved price / 30 days server-side. The server never trusts a client-supplied amount.
    if (isFrontDeskTierKey(plan.key) && !assertFrontDeskTierPricing(plan).ok) {
      return fail(500, "PLAN_PRICING_INVALID", "AI Front Desk pricing configuration is invalid.");
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
    // MJENGO OS (KES 2,000 / 30 days) is only collectable when it can actually be activated.
    // The refusal runs BEFORE initializeTransaction, so a disabled product or a mispriced plan
    // never takes the customer's money.
    if (plan.key === MJENGO_PLAN_KEY) {
      await assertBusinessRole(businessId, session, "manage_billing");
      const refusal = mjengoCheckoutRefusal(plan);
      if (refusal) return fail(409, "MJENGO_CHECKOUT_REFUSED", refusal);
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
