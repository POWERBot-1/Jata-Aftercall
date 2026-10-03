import { getCheckoutUrl } from "@/lib/subscriptionFlow";
import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { markAwaitingPayment } from "@/lib/pos/provisioning";
import { posPlanDetails } from "@/lib/pos/workspace";

/**
 * Choosing the plan (§43, §44, §45, §67).
 *
 * The price is resolved from PlanConfig on the server — never from the browser. Selecting the
 * plan only moves the configuration to AWAITING_PAYMENT: payment initiation is not success, and
 * nothing becomes commercially active until Paystack confirms the charge and the settlement
 * path provisions the POS.
 *
 * This plan is deliberately absent from every public and customer-facing surface; it is
 * reachable only from inside the authenticated POS workspace.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "EDIT_CONFIGURATION", fast: true },
    fallback: "We couldn't load the plan.",
    handler: async ({ ctx }) => {
      const plan = await posPlanDetails();
      return posOk({
        plan,
        planKey: POS_PLAN_KEY,
        entitled: ctx.entitlement.entitled,
        status: ctx.entitlement.status,
        lifecycle: ctx.lifecycle,
        lifecycleLabel: ctx.lifecycleLabel,
        reason: ctx.entitlement.reason,
        nextAction: ctx.entitlement.nextAction,
        expiresAt: ctx.entitlement.expiresAt ? new Date(ctx.entitlement.expiresAt).toISOString() : null,
        checkoutUrl: plan.id ? getCheckoutUrl(businessId, plan.id) : null,
      });
    },
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "EDIT_CONFIGURATION" },
    fallback: "We couldn't start your payment.",
    handler: async ({ ctx }) => {
      const marked = await markAwaitingPayment(businessId, ctx.session.userId);
      if (!marked.ok) {
        return fromOutcome({ ok: false, message: marked.reason, code: "PLAN_REFUSED" });
      }
      const plan = await posPlanDetails();
      if (!plan.id || !plan.available) {
        return fromOutcome({ ok: false, message: "The Business POS plan is not available right now. Please try again.", code: "PLAN_UNAVAILABLE" });
      }
      return fromOutcome(
        { ok: true },
        {
          planKey: plan.key,
          priceKES: plan.priceKES,
          durationDays: plan.durationDays,
          status: marked.record?.status ?? "AWAITING_PAYMENT",
          checkoutUrl: getCheckoutUrl(businessId, plan.id),
        },
      );
    },
  });
}
