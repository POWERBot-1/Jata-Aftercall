/**
 * Where this business gets paid (§10, §11, §12).
 *
 * GET  — the wallet: every destination, its honest verification state, and the tiles a merchant
 *        can add.
 * POST — "this is my M-PESA till / PayBill / bank account / Paystack account". JATA identifies and
 *        validates the number, verifies it against the provider where that is possible, stores it,
 *        and never asks the merchant for an API key, a webhook or an endpoint (§1, §3, §120).
 *
 * Reading needs `VIEW_PAYMENTS`; adding or changing where money lands needs
 * `MANAGE_PAYMENT_DESTINATIONS`, which is an owner-level action (§62).
 */

import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { addDestination, loadWallet, destinationHistory } from "@/lib/payments/wallet";
import { confirmHighRiskAction } from "@/lib/payments/reauth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't load where your business gets paid.",
    handler: async () => {
      const [wallet, history] = await Promise.all([loadWallet(businessId), destinationHistory(businessId, 15)]);
      return posOk({ wallet, history });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_PAYMENT_DESTINATIONS", fast: true },
    fallback: "We couldn't save that payment destination.",
    handler: async ({ actor, body }) => {
      // The first destination of a business is free; every change after that is confirmed in the
      // moment so a business cannot be re-pointed by a stray tap (§62).
      const wallet = await loadWallet(businessId);
      if (wallet.destinations.length > 0) {
        const confirmation = await confirmHighRiskAction({
          businessId,
          actorId: actor.actorId,
          actorName: actor.actorName,
          roleKey: actor.roleKey,
          password: body?.password,
          confirm: body?.confirm,
        });
        if (!confirmation.ok) return fromOutcome({ ...confirmation, warnings: [] }, {}, 403);
      }

      const outcome = await addDestination({
        businessId,
        actor: {
          actorId: actor.actorId,
          actorName: actor.actorName,
          roleKey: actor.roleKey,
          permissions: actor.permissions ?? [],
        },
        input: {
          kind: body?.kind,
          providerDestinationId: body?.providerDestinationId,
          providerAccountRef: body?.providerAccountRef,
          bankName: body?.bankName,
          accountName: body?.accountName,
        },
      });
      const refreshed = await loadWallet(businessId);
      return fromOutcome({ ...outcome, warnings: [] }, { wallet: refreshed }, outcome.ok ? 201 : 400);
    },
  });
}
