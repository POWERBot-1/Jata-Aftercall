import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { reversePoints } from "@/lib/business-hub/loyaltyPoints";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Reverse the points from a purchase that was refunded or cancelled (Loyalty 2.0).
 *
 * Deliberately a high-risk permission: taking points back is the one action that can leave a
 * customer worse off. The original earning entry is preserved and a compensating REVERSED entry is
 * written against it; the idempotency key means a refund processed twice reverses once.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "high_risk");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that reversal." }, 400);
  const cardId = cleanText(body.cardId, 60);
  const transactionRef = cleanText(body.transactionRef, 80);
  const reason = cleanText(body.reason, 400);
  if (!cardId) return reply({ error: "Choose the customer whose points you are reversing." }, 400);
  if (reason.length < 5) return reply({ error: "Record why these points are being taken back." }, 400);

  try {
    const result = await reversePoints({
      businessId,
      cardId,
      transactionRef,
      reason: cleanOptionalText(reason, 400),
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_REVERSED",
      targetType: "LoyaltyPointsAccount",
      targetId: result.account?.id ?? cardId,
      metadata: {
        businessId,
        points: result.entry?.points ?? 0,
        transactionRef,
        shortfall: result.shortfall ?? 0,
      },
    }).catch(() => undefined);
    return reply({ entry: result.entry, account: result.account, shortfall: result.shortfall ?? 0 }, 201);
  } catch {
    return reply({ error: "We couldn't reverse those points. Please try again." }, 503);
  }
}
