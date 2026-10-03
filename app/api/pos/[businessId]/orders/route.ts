import { fromOutcome, handlePosRequest, posOk, queryString, queryInt } from "@/lib/pos/http";
import { createOrder } from "@/lib/pos/operations";
import { orderStatesFor } from "@/lib/pos/presentation";
import { listCustomers, listOrders, orderStateCounts } from "@/lib/pos/store";
import { initialState, nextStates } from "@/lib/pos/workflow";
import { sanitizeOrderInput, sanitizeRange } from "@/lib/pos/validation";

/**
 * Orders (§28, §29).
 *
 * One table, configurable states. The board renders whatever workflow the configuration chose —
 * a restaurant sees New → Preparing → Ready, a laundry sees Dropped off → Washing → Ready for
 * collection — and the server only accepts moves that workflow defines. Channel attribution is
 * recorded so the business can see what came from a call, WhatsApp or its JATA page (§70).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_ORDERS", fast: true },
    fallback: "We couldn't load your orders.",
    handler: async ({ ctx, url }) => {
      const range = sanitizeRange({ from: queryString(url, "from") ?? undefined, to: queryString(url, "to") ?? undefined }, 7);
      const workflowKey = ctx.configuration.orders.workflowKey;
      const [orders, counts] = await Promise.all([
        listOrders(businessId, {
          stateKey: queryString(url, "state") ?? undefined,
          channel: queryString(url, "channel") ?? undefined,
          range: { from: range.from, to: range.to },
          take: Math.min(queryInt(url, "take", 50), 200),
        }),
        orderStateCounts(businessId, workflowKey),
      ]);
      const states = orderStatesFor(ctx.configuration);
      return posOk({
        orders,
        states,
        counts,
        board: states.map((state) => ({
          ...state,
          count: counts.find((entry) => entry.stateKey === state.key)?.count ?? 0,
          orders: orders.filter((order: any) => order.stateKey === state.key),
        })),
        workflowKey,
        channels: ctx.configuration.orders.channels,
        initialState: initialState(workflowKey),
        word: ctx.terminology.order,
        plural: ctx.terminology.orders,
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_ORDERS", requireLive: true },
    fallback: "We couldn't save that order.",
    handler: async ({ ctx, actor, body }) => {
      const outcome = await createOrder({
        businessId,
        configuration: ctx.configuration,
        actor,
        input: sanitizeOrderInput(body),
      });
      return fromOutcome(outcome, {
        order: outcome.order ?? null,
        nextStates: outcome.order ? nextStates(ctx.configuration.orders.workflowKey, outcome.order.stateKey).map((state) => ({ key: state.key, label: state.label })) : [],
      }, 201);
    },
  });
}
