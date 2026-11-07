import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { listRewards, saveReward, validateRewardInput } from "@/lib/business-hub/loyaltyPoints";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Reward catalogue (Loyalty 2.0). A reward is never deleted — it is paused — so the history of a
 * redemption keeps pointing at what the customer actually received.
 */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);
  try {
    const rewards = await listRewards(businessId, { includeInactive: true });
    return reply({ rewards }, 200);
  } catch {
    return reply({ error: "We couldn't load your rewards. Please try again." }, 503);
  }
}

/** Add a reward. The cost in points, the value and the eligibility are all set by the owner. */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that reward." }, 400);
  const parsed = validateRewardInput(body);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  try {
    const reward = await saveReward({
      businessId,
      input: parsed.value,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_REWARD_CREATED",
      targetType: "LoyaltyReward",
      targetId: reward.id,
      metadata: { businessId, pointsCost: reward.pointsCost, kind: reward.kind },
    }).catch(() => undefined);
    return reply({ reward }, 201);
  } catch {
    // Most often the unique (businessId, title) index: two rewards with the same name.
    return reply({ error: "We couldn't add that reward. A reward with this name may already exist." }, 409);
  }
}
