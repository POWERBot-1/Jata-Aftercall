/**
 * Changing the primary destination, or disconnecting one (§62, §103).
 *
 * Both are owner-level acts: `MANAGE_PAYMENT_DESTINATIONS` plus a confirmation in the moment, an
 * audit record with a reason, and a notice to the owner. Disconnecting never deletes: past
 * payments keep pointing at the destination they were made to (§114).
 */

import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { disconnectDestination, loadWallet, setPrimaryDestination } from "@/lib/payments/wallet";
import { confirmHighRiskAction } from "@/lib/payments/reauth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; destinationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId, destinationId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_PAYMENT_DESTINATIONS", fast: true },
    fallback: "We couldn't change where your business gets paid.",
    handler: async ({ actor, body }) => {
      const action = typeof body?.action === "string" ? body.action : "";
      const confirmation = await confirmHighRiskAction({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        roleKey: actor.roleKey,
        password: body?.password,
        confirm: body?.confirm,
      });
      if (!confirmation.ok) return fromOutcome({ ...confirmation, warnings: [] }, {}, 403);

      const reason = typeof body?.reason === "string" ? body.reason : null;
      const outcome =
        action === "disconnect"
          ? await disconnectDestination({ businessId, destinationId, actor: { ...actor, permissions: actor.permissions ?? [] }, reason })
          : await setPrimaryDestination({ businessId, destinationId, actor: { ...actor, permissions: actor.permissions ?? [] }, reason });

      const wallet = await loadWallet(businessId);
      return fromOutcome({ ...outcome, warnings: [] }, { wallet }, outcome.ok ? 200 : 400);
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { businessId, destinationId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't load that payment destination.",
    handler: async () => {
      const wallet = await loadWallet(businessId);
      return posOk({ destination: wallet.destinations.find((entry) => entry.id === destinationId) ?? null });
    },
  });
}
