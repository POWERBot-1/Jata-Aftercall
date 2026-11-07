import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { redeemReward } from "@/lib/business-hub/loyalty";
import { cleanOptionalText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Redeem one reward cycle.
 *
 * (cardId, cycleIndex) is unique, so the same filled card cannot pay out twice even under
 * concurrent requests; the loser receives 409 and the card is unchanged.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string; cardId: string }> }) {
  const { businessId, cardId } = await params;
  const auth = await authorizeOwner(businessId, "operate");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your loyalty programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req) ?? {};

  try {
    const result = await redeemReward({
      businessId,
      cardId,
      rewardDescription: cleanOptionalText(body.rewardDescription, 160) ?? undefined,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_LOYALTY_REWARD_REDEEMED",
      targetType: "LoyaltyCard",
      targetId: cardId,
      metadata: { businessId, reference: result.redemption.reference },
    }).catch(() => undefined);
    return reply({ redemption: result.redemption, card: result.card }, 201);
  } catch {
    return reply({ error: "We couldn't redeem that reward. Please try again." }, 503);
  }
}
