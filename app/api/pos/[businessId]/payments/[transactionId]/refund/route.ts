/**
 * Refunding a confirmed payment (§47, §48).
 *
 * A refund is additive: the original payment keeps its amount, its provider reference and its
 * receipt, and the refund writes its own row with the person's name, the reason and the provider's
 * answer. If the provider cannot return the money, the screen says so — JATA never marks money
 * returned because somebody tapped a button.
 *
 * The role needs `REFUND_PAYMENT` (owner or manager by default, §36) *and* an explicit
 * confirmation in the moment (§62).
 */

import { fromOutcome, handlePosRequest, posFail, posOk } from "@/lib/pos/http";
import { refundSummary, requestRefund } from "@/lib/payments/refunds";
import { confirmHighRiskAction } from "@/lib/payments/reauth";
import { paymentDetail } from "@/lib/payments/store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; transactionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId, transactionId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't load that refund.",
    handler: async () => {
      const detail = await paymentDetail(businessId, transactionId);
      if (!detail) return posFail("That payment was not found for this business.", 404, "NOT_FOUND");
      return posOk({ refund: refundSummary(detail.payment), payment: detail.payment });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId, transactionId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "REFUND_PAYMENT", fast: true },
    fallback: "We couldn't send that refund.",
    handler: async ({ actor, body }) => {
      const confirmation = await confirmHighRiskAction({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        roleKey: actor.roleKey,
        password: body?.password,
        confirm: body?.confirm,
      });
      if (!confirmation.ok) return fromOutcome({ ...confirmation, warnings: [] }, {}, 403);

      const amountKES = typeof body?.amountKES === "number" ? body.amountKES : Number(body?.amountKES ?? NaN);
      const outcome = await requestRefund({
        businessId,
        transactionId,
        amountKES,
        reason: typeof body?.reason === "string" ? body.reason : "",
        actor: {
          actorId: actor.actorId,
          actorName: actor.actorName,
          roleKey: actor.roleKey,
          permissions: actor.permissions ?? [],
          confirmed: true,
        },
      });
      const detail = await paymentDetail(businessId, transactionId);
      return fromOutcome({ ...outcome, warnings: [] }, { payment: detail?.payment ?? null });
    },
  });
}
