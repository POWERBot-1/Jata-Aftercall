/**
 * One payment, as the till and the wallet screen see it (§32, §40, §41).
 *
 * The detail is the merchant's own record — its amount, its state, its timeline, its receipt. It
 * never contains a provider payload, a credential or another tenant's data (§5, §56, §57).
 */

import { handlePosRequest, posFail, posOk } from "@/lib/pos/http";
import { paymentDetail } from "@/lib/payments/store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; transactionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId, transactionId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't load that payment.",
    handler: async () => {
      const detail = await paymentDetail(businessId, transactionId);
      if (!detail) return posFail("That payment was not found for this business.", 404, "NOT_FOUND");
      return posOk(detail);
    },
  });
}
