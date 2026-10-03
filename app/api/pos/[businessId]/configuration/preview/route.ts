import { buildPreviewSandbox, previewHeadline } from "@/lib/pos/preview";
import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { markPreview } from "@/lib/pos/provisioning";

/**
 * The interactive preview (§23, §42, §44).
 *
 * A sandbox built entirely from the configuration with seeded sample data. It writes no
 * business records: preview is not production, and nothing here can be mistaken for a real
 * sale. POST records the PREVIEW lifecycle state so the owner's journey is explicit.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { fast: true },
    fallback: "We couldn't build your preview.",
    handler: async ({ ctx }) => posOk({
      headline: previewHeadline(ctx.configuration),
      sandbox: buildPreviewSandbox(ctx.configuration, ctx.business.name),
      lifecycle: ctx.lifecycle,
      draftVersion: ctx.record?.draftVersion ?? 1,
      publishedVersion: ctx.record?.publishedVersion ?? 0,
    }),
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    fallback: "We couldn't build your preview.",
    handler: async ({ ctx }) => {
      const record = await markPreview(businessId, ctx.session.userId);
      return fromOutcome(
        { ok: true },
        {
          status: record?.status ?? ctx.lifecycle,
          headline: previewHeadline(ctx.configuration),
          sandbox: buildPreviewSandbox(ctx.configuration, ctx.business.name),
        },
      );
    },
  });
}
