/**
 * Cancelling an unpaid request (§33).
 *
 * A cashier may stop waiting for a customer who walked away — but only while nothing has been
 * confirmed. Once money has arrived the request is history: JATA never hides it and never deletes
 * it, it can only be refunded (§47, §48, §114).
 */

import { fromOutcome, handlePosRequest } from "@/lib/pos/http";
import { cancelPaymentRequest } from "@/lib/payments/orchestrator";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; transactionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId, transactionId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_SALE", fast: true },
    fallback: "We couldn't cancel that payment request.",
    handler: async ({ actor }) => {
      const outcome = await cancelPaymentRequest({
        businessId,
        transactionId,
        actorId: actor.actorId,
        actorName: actor.actorName,
      });
      return fromOutcome({ ...outcome, warnings: [] });
    },
  });
}
