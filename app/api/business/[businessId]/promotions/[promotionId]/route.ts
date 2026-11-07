import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import {
  deletePromotion,
  getPromotion,
  updatePromotion,
  validatePromotionInput,
} from "@/lib/business-hub/promotions";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

type Params = { params: Promise<{ businessId: string; promotionId: string }> };

/**
 * Edit a promotion. Any subset of fields may be sent; the window is validated as a whole, so a
 * partial edit can never leave a promotion with an inverted or half-set window. `isActive` may be
 * toggled on its own — that is the pause/resume switch.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { businessId, promotionId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Promotions are temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that change." }, 400);

  const existing = await getPromotion(businessId, promotionId);
  if (!existing) return reply({ error: "That promotion is not on this business page." }, 404);

  try {
    // A pure pause/resume (or priority) change skips the full window validation.
    const windowFieldsSent = ["startsAt", "endsAt", "title"].some((field) => Object.prototype.hasOwnProperty.call(body, field));
    let patch: Record<string, unknown> = {};

    if (windowFieldsSent) {
      const parsed = validatePromotionInput({
        ...body,
        title: body.title ?? existing.title,
        subtitle: body.subtitle ?? existing.subtitle,
        body: body.body ?? existing.body,
        badge: body.badge ?? existing.badge,
        discountLabel: body.discountLabel ?? existing.discountLabel,
        imageUrl: body.imageUrl ?? existing.imageUrl,
        ctaLabel: body.ctaLabel ?? existing.ctaLabel,
        ctaKind: body.ctaKind ?? existing.ctaKind,
        ctaValue: body.ctaValue ?? existing.ctaValue,
        productIds: body.productIds ?? existing.productIds,
        startsAt: body.startsAt ?? existing.startsAt,
        endsAt: body.endsAt ?? existing.endsAt,
        isActive: body.isActive ?? existing.isActive,
        priority: body.priority ?? existing.priority,
      });
      if (!parsed.ok) return reply({ error: parsed.error }, 400);
      patch = { ...parsed.value, productIds: JSON.stringify(parsed.value.productIds) };
    } else {
      if (Object.prototype.hasOwnProperty.call(body, "isActive")) patch.isActive = Boolean(body.isActive);
      if (Object.prototype.hasOwnProperty.call(body, "priority")) {
        patch.priority = Math.max(0, Math.min(100, Math.round(Number(body.priority) || 0)));
      }
      if (Object.prototype.hasOwnProperty.call(body, "subtitle")) patch.subtitle = typeof body.subtitle === "string" ? body.subtitle.slice(0, 120) : null;
      if (Object.prototype.hasOwnProperty.call(body, "discountLabel")) patch.discountLabel = typeof body.discountLabel === "string" ? body.discountLabel.slice(0, 40) : null;
      if (Object.keys(patch).length === 0) return reply({ error: "Send at least one field to change." }, 400);
    }

    const updated = await updatePromotion({
      businessId,
      id: promotionId,
      patch,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!updated) return reply({ error: "That promotion is not on this business page." }, 404);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_PROMOTION_UPDATED",
      targetType: "Promotion",
      targetId: promotionId,
      metadata: { businessId, fields: Object.keys(patch) },
    }).catch(() => undefined);
    return reply({ promotion: updated }, 200);
  } catch {
    return reply({ error: "We couldn't save that change. Please try again." }, 503);
  }
}

/** Delete a promotion. Deleting is the only way to remove one permanently; pausing is reversible. */
export async function DELETE(_req: Request, { params }: Params) {
  const { businessId, promotionId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Promotions are temporarily unavailable." }, 503);

  try {
    const removed = await deletePromotion({
      businessId,
      id: promotionId,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!removed) return reply({ error: "That promotion is not on this business page." }, 404);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_PROMOTION_DELETED",
      targetType: "Promotion",
      targetId: promotionId,
      metadata: { businessId },
    }).catch(() => undefined);
    return reply({ deleted: true }, 200);
  } catch {
    return reply({ error: "We couldn't delete that promotion. Please try again." }, 503);
  }
}
