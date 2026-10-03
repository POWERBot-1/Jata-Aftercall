import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { moveOrder } from "@/lib/pos/operations";
import { findOrder } from "@/lib/pos/store";
import { nextStates } from "@/lib/pos/workflow";
import { text } from "@/lib/pos/validation";

/**
 * One order (§29). GET returns it with the moves the workflow actually allows from its current
 * state; POST makes one of those moves. A move the workflow does not define is refused with the
 * list of states that are available — the state machine, not the browser, is authoritative.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; orderId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId, orderId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "VIEW_ORDERS", fast: true },
    fallback: "We couldn't load that order.",
    handler: async () => {
      const order = await findOrder(businessId, orderId);
      if (!order) return { status: 404, data: { error: "That order was not found." } };
      return posOk({
        order,
        nextStates: nextStates(order.workflowKey, order.stateKey).map((state) => ({ key: state.key, label: state.label, hint: state.hint ?? "" })),
        history: order.events ?? [],
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId, orderId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { requireLive: true },
    fallback: "We couldn't move that order.",
    handler: async ({ ctx, actor, body }) => {
      const outcome = await moveOrder({
        businessId,
        configuration: ctx.configuration,
        actor,
        orderId,
        toState: text(body, "state", 40) || text(body, "toState", 40),
        note: text(body, "note", 240) || null,
      });
      return fromOutcome(outcome, {
        order: outcome.order ?? null,
        fromState: outcome.fromState ?? null,
        toState: outcome.toState ?? null,
      });
    },
  });
}
