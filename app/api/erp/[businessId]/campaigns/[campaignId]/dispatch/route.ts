import prisma from "@/lib/db";
import { handleErpRequest } from "@/lib/erp/http";
import { dispatchBatch, reconcileCampaign } from "@/lib/messaging/pipeline";

export const dynamic = "force-dynamic";

/**
 * Dispatch a bounded batch, or reconcile messages whose provider outcome is unknown.
 *
 * Live sending requires MESSAGING_LIVE_ENABLED=true AND a configured provider; otherwise the
 * sandbox provider is used and the response says so. Nothing here can be triggered by an
 * unauthenticated caller.
 */
export async function POST(request: Request, context: { params: Promise<{ businessId: string; campaignId: string }> }) {
  const { businessId, campaignId } = await context.params;
  return handleErpRequest({
    businessId,
    request,
    permission: "APPROVE_CAMPAIGNS",
    rateLimit: { key: `erp-dispatch:${businessId}`, max: 30, windowMs: 60_000 },
    fallback: "We couldn't process that campaign batch.",
    handler: async ({ body }) => {
      const mode = String(body.mode ?? "dispatch");
      if (mode === "reconcile") {
        const result = await reconcileCampaign(prisma, { businessId, campaignId });
        return { data: { mode, result, message: `Checked ${result.checked}. Delivered ${result.delivered}, failed ${result.failed}, still unknown ${result.stillUnknown}.` } };
      }
      const liveRequested = body.live === true;
      const liveAllowed = process.env.MESSAGING_LIVE_ENABLED === "true";
      if (liveRequested && !liveAllowed) {
        return { status: 409, data: { error: "Live sending is disabled on this deployment. The sandbox provider will be used instead." } };
      }
      const limit = Math.min(200, Math.max(1, Number(body.limit ?? 25) || 25));
      const summary = await dispatchBatch(prisma, {
        businessId,
        campaignId,
        limit,
        providerMode: liveRequested && liveAllowed ? "auto" : "sandbox",
      });
      return {
        data: {
          mode: "dispatch",
          summary,
          provider: liveRequested && liveAllowed ? "configured" : "sandbox",
          note: liveRequested && liveAllowed ? "Handed to the configured provider." : "Sandbox: no real messages were sent.",
        },
      };
    },
  });
}
