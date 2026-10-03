import { fromOutcome, handlePosRequest } from "@/lib/pos/http";
import { publishConfiguration } from "@/lib/pos/provisioning";
import { text } from "@/lib/pos/validation";

/**
 * Publishing applies a configuration to the live POS (§43, §48, §49).
 *
 * Refused unless the subscription entitles the business (§44): an unpaid configuration can
 * never become the operating profile. Publishing writes an immutable version, so past
 * transactions stay interpretable and a rollback adds a version rather than rewriting one.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_CONFIGURATION" },
    fallback: "We couldn't publish your POS setup.",
    handler: async ({ ctx, body }) => {
      const result = await publishConfiguration({
        businessId,
        actorId: ctx.session.userId,
        note: text(body, "note", 240) || undefined,
      });
      return fromOutcome(
        { ok: result.ok, message: result.reason, code: result.ok ? undefined : "PUBLISH_REFUSED" },
        { version: result.version ?? null, publishedVersion: result.record?.publishedVersion ?? 0 },
      );
    },
  });
}
