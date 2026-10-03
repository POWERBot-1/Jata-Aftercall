import { fromOutcome, handlePosRequest } from "@/lib/pos/http";
import { receivePurchase } from "@/lib/pos/operations";
import { sanitizeReceiveInput } from "@/lib/pos/validation";

/**
 * Receiving stock against a purchase order (§12, §33). Partial receiving is allowed only when
 * the configuration says so; otherwise the full outstanding quantity arrives at once.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; purchaseId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId, purchaseId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_PURCHASE", requireLive: true },
    fallback: "We couldn't receive that delivery.",
    handler: async ({ ctx, actor, body }) => {
      const input = sanitizeReceiveInput({ ...body, purchaseId });
      const outcome = await receivePurchase({
        businessId,
        configuration: ctx.configuration,
        actor,
        purchaseId,
        items: input.items,
        payment: input.payment,
      });
      return fromOutcome(outcome, { purchase: outcome.purchase ?? null, received: outcome.received ?? 0 });
    },
  });
}
