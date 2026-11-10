import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { updateRedemptionStatus } from "@/lib/business-hub/loyaltyPoints";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Move a redemption through its life cycle (Loyalty 2.0): PENDING → FULFILLED, or → CANCELLED.
 *
 * Cancelling returns the points with a compensating ledger entry, and a cancelled redemption can
 * never be cancelled again, so points cannot be returned twice.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ businessId: string; redemptionId: string }> },
) {
  const { businessId, redemptionId } = await params;
  const auth = await authorizeOwner(businessId, "operate");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that change." }, 400);
  const status = cleanText(body.status, 20).toUpperCase();
  if (status === "CANCELLED" && cleanText(body.reason, 400).length < 5) {
    return reply({ error: "Record why this redemption is being cancelled." }, 400);
  }

  try {
    const result = await updateRedemptionStatus({
      businessId,
      redemptionId,
      status,
      reason: cleanOptionalText(body.reason, 400),
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_REDEMPTION_UPDATED",
      targetType: "LoyaltyRewardRedemption",
      targetId: redemptionId,
      metadata: { businessId, status, reason: body.reason ?? null },
    }).catch(() => undefined);
    return reply({ redemption: result.redemption }, 200);
  } catch {
    return reply({ error: "We couldn't update that redemption. Please try again." }, 503);
  }
}
