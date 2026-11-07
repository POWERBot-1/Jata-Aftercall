import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { saveReward, setRewardActive, validateRewardInput } from "@/lib/business-hub/loyaltyPoints";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Update or pause one reward (Loyalty 2.0).
 *
 * There is no DELETE on purpose: a paused reward keeps its history. Pausing stops new redemptions
 * without rewriting what customers already received.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ businessId: string; rewardId: string }> }) {
  const { businessId, rewardId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that change." }, 400);

  try {
    // A toggle (`{ "isActive": false }`) is enough to pause or publish; anything else is treated as
    // a full edit of the reward.
    const isToggle = typeof body.isActive === "boolean" && Object.keys(body).filter((key) => key !== "isActive").length === 0;
    if (isToggle) {
      const reward = await setRewardActive({
        businessId,
        rewardId,
        isActive: Boolean(body.isActive),
        actorId: auth.actor.userId,
        actorLabel: auth.actor.label,
      });
      if (!reward) return reply({ error: "That reward is not part of your programme." }, 404);
      await logAudit({
        actorId: auth.actor.userId,
        action: "BUSINESS_HUB_POINTS_REWARD_UPDATED",
        targetType: "LoyaltyReward",
        targetId: reward.id,
        metadata: { businessId, isActive: reward.isActive },
      }).catch(() => undefined);
      return reply({ reward }, 200);
    }

    const parsed = validateRewardInput(body);
    if (!parsed.ok) return reply({ error: parsed.error }, 400);
    const reward = await saveReward({
      businessId,
      rewardId,
      input: parsed.value,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_REWARD_UPDATED",
      targetType: "LoyaltyReward",
      targetId: reward.id,
      metadata: { businessId, pointsCost: reward.pointsCost, kind: reward.kind },
    }).catch(() => undefined);
    return reply({ reward }, 200);
  } catch {
    return reply({ error: "We couldn't save that reward. Please try again." }, 503);
  }
}
