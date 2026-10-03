import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { listVersions, rollbackToVersion } from "@/lib/pos/provisioning";
import { text } from "@/lib/pos/validation";

/**
 * Configuration history (§48, §49).
 *
 * Versions are immutable snapshots. Rolling back writes a NEW version containing the old
 * snapshot, so the history of how the business was configured is never rewritten — and neither
 * is any transaction recorded under an earlier configuration.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "EDIT_CONFIGURATION", fast: true },
    fallback: "We couldn't load your POS history.",
    handler: async () => posOk({ versions: await listVersions(businessId, 25) }),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_CONFIGURATION" },
    fallback: "We couldn't roll back your POS setup.",
    handler: async ({ ctx, body }) => {
      const result = await rollbackToVersion({
        businessId,
        versionId: text(body, "versionId", 64),
        actorId: ctx.session.userId,
      });
      return fromOutcome(
        { ok: result.ok, message: result.reason, code: result.ok ? undefined : "ROLLBACK_REFUSED" },
        { version: result.version ?? null },
      );
    },
  });
}
