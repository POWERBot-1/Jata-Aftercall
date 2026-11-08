import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { awardPoints } from "@/lib/business-hub/loyaltyPoints";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Award points for one VERIFIED purchase (Loyalty 2.0).
 *
 * "Owner-verified" means a person with permission on this business typed the purchase and its
 * reference. It is not payment-provider verification, and this route never claims otherwise — the
 * `PAYMENT_PROVIDER` source is refused by `awardPoints`, so no unverified event can be laundered
 * into points here.
 *
 * Replaying the same reference is safe: the idempotency key is derived from it, so a double tap
 * returns the original entry instead of a second award.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "operate");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that purchase." }, 400);
  const cardId = cleanText(body.cardId, 60);
  if (!cardId) return reply({ error: "Choose the customer who made this purchase." }, 400);

  try {
    const result = await awardPoints({
      businessId,
      cardId,
      transactionRef: cleanText(body.transactionRef, 80),
      amountKES: Number(body.amountKES),
      items: Array.isArray(body.items)
        ? body.items.slice(0, 100).map((item: any) => ({
            itemKind: cleanText(item?.itemKind, 20).toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT",
            itemId: cleanText(item?.itemId, 60),
            amountKES: Number(item?.amountKES ?? 0),
          }))
        : [],
      note: cleanOptionalText(body.note, 400),
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_AWARDED",
      targetType: "LoyaltyPointsAccount",
      targetId: result.account?.id ?? cardId,
      metadata: {
        businessId,
        points: result.entry?.points ?? 0,
        transactionRef: result.entry?.sourceReference ?? null,
        duplicate: result.duplicate === true,
      },
    }).catch(() => undefined);
    return reply(
      { entry: result.entry, account: result.account, duplicate: result.duplicate === true },
      result.duplicate ? 200 : 201,
    );
  } catch {
    return reply({ error: "We couldn't award those points. Please try again." }, 503);
  }
}
