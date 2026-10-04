/**
 * "Check status" (§67, §68).
 *
 * Asks the provider what actually happened and applies whatever it says — a timeout is never
 * treated as a failure, and the response carries the state JATA now holds. The browser cannot
 * assert money arrived; only the provider's verified answer moves a payment forward (§41, §112).
 */

import { handlePosRequest, posFail, posOk } from "@/lib/pos/http";
import { checkPaymentStatus } from "@/lib/payments/orchestrator";
import { paymentDetail } from "@/lib/payments/store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; transactionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId, transactionId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't check that payment with the provider.",
    handler: async () => {
      await checkPaymentStatus({ businessId, transactionId });
      const detail = await paymentDetail(businessId, transactionId);
      if (!detail) return posFail("That payment was not found for this business.", 404, "NOT_FOUND");
      return posOk(detail);
    },
  });
}
