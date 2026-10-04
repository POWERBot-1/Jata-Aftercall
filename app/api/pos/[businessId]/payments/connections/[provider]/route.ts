/**
 * One-tap provider authorization (§12, §13).
 *
 * This is the whole merchant-side "integration": the owner taps "Authorize", JATA records that the
 * business has authorized JATA to receive its payments from that provider, and re-checks the
 * destinations it holds for that provider. There is no key to paste, no webhook to register, no
 * endpoint to configure and no credential the merchant ever sees (§1, §120).
 *
 * If JATA's central connector for the provider is not provisioned in this deployment, the route
 * says exactly that — it never implies the connection is live when it is not (§16, §120).
 */

import { fromOutcome, handlePosRequest } from "@/lib/pos/http";
import { authorizeProviderConnection, loadWallet } from "@/lib/payments/wallet";
import { confirmHighRiskAction } from "@/lib/payments/reauth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; provider: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId, provider } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_PAYMENT_DESTINATIONS", fast: true },
    fallback: "We couldn't authorize that provider connection.",
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

      const outcome = await authorizeProviderConnection({
        businessId,
        provider: String(provider).toUpperCase(),
        actor: { ...actor, permissions: actor.permissions ?? [] },
      });
      const wallet = await loadWallet(businessId);
      return fromOutcome({ ...outcome, warnings: [] }, { wallet }, outcome.ok ? 200 : 400);
    },
  });
}
