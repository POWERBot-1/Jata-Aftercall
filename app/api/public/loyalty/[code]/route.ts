import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { findCardByCode } from "@/lib/business-hub/loyalty";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/**
 * Customer-visible loyalty progress (Business Hub D).
 *
 * The card code is the customer's bearer token, so this is the only public read of a loyalty
 * record. It returns the card's own progress and the business name — never the owner's notes,
 * never a contact value, never another business's cards.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const limit = rateLimit(req, { key: "hub-loyalty-lookup", max: 30, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429, headers: noStore });

  const { code } = await params;
  const found = await findCardByCode(code);
  if (!found) {
    return NextResponse.json(
      { error: "We couldn't find that loyalty card. Check the code on your card and try again." },
      { status: 404, headers: noStore },
    );
  }

  const { card, business } = found;
  return NextResponse.json(
    {
      businessName: business.name,
      businessSlug: business.slug,
      code: card.code,
      displayCode: card.displayCode,
      customerName: card.customerName,
      status: card.status,
      stamps: card.balance,
      goal: card.goal,
      remaining: card.remaining,
      percent: card.percent,
      rewardsAvailable: card.rewardsAvailable,
      rewardsRedeemed: card.rewardsRedeemed,
      lastStampAt: card.lastStampAt,
      rewardDescription: found.rewardDescription,
      message:
        card.status !== "ACTIVE"
          ? "This card is not active. Please speak to the business."
          : "Stamps are added by the business after it verifies your purchase. Progress updates as soon as they do.",
    },
    { status: 200, headers: noStore },
  );
}
