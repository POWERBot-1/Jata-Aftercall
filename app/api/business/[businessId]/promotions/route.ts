import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { createPromotion, listPromotions, validatePromotionInput } from "@/lib/business-hub/promotions";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Owner list. Includes scheduled, live, paused and expired rows with the computed state. */
export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Promotions are temporarily unavailable." }, 503);
  try {
    const promotions = await listPromotions(businessId);
    return reply({ promotions }, 200);
  } catch {
    return reply({ error: "We couldn't load your promotions. Please try again." }, 503);
  }
}

/** Create a promotion (start/end are read as Africa/Nairobi time). */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Promotions are temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that promotion." }, 400);
  const parsed = validatePromotionInput(body);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  try {
    const record = await createPromotion({
      businessId,
      input: parsed.value,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_PROMOTION_CREATED",
      targetType: "Promotion",
      targetId: record.id,
      metadata: { businessId, title: parsed.value.title, endsAt: parsed.value.endsAt.toISOString() },
    }).catch(() => undefined);
    return reply({ promotion: record }, 201);
  } catch {
    return reply({ error: "We couldn't save that promotion. Please try again." }, 503);
  }
}
