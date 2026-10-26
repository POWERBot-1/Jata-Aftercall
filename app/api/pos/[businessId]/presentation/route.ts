/**
 * POS header image (image-first pass).
 *
 * GET returns the effective presentation for this tenant. POST saves the owner's header
 * image choice through `savePosPresentation` (draft + published, no version bump, no
 * trading impact). Authorization is the POS route kit: the tenant comes from the session
 * and URL, and the write needs the same EDIT_CONFIGURATION permission as POS setup.
 *
 * A non-empty image URL is accepted only when it is one JATA can account for *for this
 * business*: a starter-gallery image, a media-library asset this business owns, or the
 * business's own cover/logo. A URL naming another tenant's media is refused, so a header
 * can never be pointed at someone else's library by guessing an address.
 */

import prisma from "@/lib/db";
import { sanitizePosPresentation } from "@/lib/pos/configuration";
import { handlePosRead, handlePosRequest, posFail, posOk } from "@/lib/pos/http";
import { savePosPresentation } from "@/lib/pos/provisioning";
import { isCategoryImageUrl } from "@/lib/categoryImagery";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

async function urlBelongsToBusiness(businessId: string, url: string): Promise<boolean> {
  if (isCategoryImageUrl(url)) return true;
  const [asset, business] = await Promise.all([
    prisma.mediaAsset.findFirst({ where: { businessId, url }, select: { id: true } }).catch(() => null),
    prisma.business
      .findUnique({ where: { id: businessId }, select: { coverUrl: true, logoUrl: true } })
      .catch(() => null),
  ]);
  if (asset) return true;
  return Boolean(business && (business.coverUrl === url || business.logoUrl === url));
}

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRead({
    businessId,
    fallback: "We couldn't load your POS header image.",
    handler: async ({ ctx }) => posOk({ presentation: ctx.configuration.presentation ?? {} }),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_CONFIGURATION" },
    fallback: "We couldn't save your POS header image.",
    handler: async ({ ctx, body }) => {
      const presentation = sanitizePosPresentation(
        (body as Record<string, unknown>)?.presentation ?? body,
      );
      if (presentation.headerImageUrl) {
        const allowed = await urlBelongsToBusiness(businessId, presentation.headerImageUrl);
        if (!allowed) {
          return posFail(
            "Choose one of the ready images, or a photo from your own gallery. That image address does not belong to this business.",
            400,
            "header_image_not_owned",
          );
        }
      }
      const record = await savePosPresentation({
        businessId,
        actorId: ctx.session.userId,
        presentation,
      });
      return posOk({ ok: true, presentation: record.draft.presentation });
    },
  });
}
