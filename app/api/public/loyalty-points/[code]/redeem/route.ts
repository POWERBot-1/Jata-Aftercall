import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { hasDurableDatabase, isSameSiteRequest, OFFLINE_WRITE_ERROR, readJsonBody } from "@/lib/business-hub/guard";
import { normaliseCardCode, redeemPoints } from "@/lib/business-hub/loyaltyPoints";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Customer redemption (Loyalty 2.0).
 *
 * Unauthenticated by design — the card code identifies the customer — so the guards matter:
 * rate limit, same-site origin, published business only, and a client-supplied `requestKey`.
 * That key becomes the redemption's idempotency key, so a double tap on a slow connection, or two
 * staff members pressing at once, produce ONE redemption and ONE deduction.
 *
 * Nothing here moves money. A redemption records that the business now owes the customer a reward;
 * it is never a payment, a refund or a cash withdrawal.
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const limit = rateLimit(req, { key: "hub-points-redeem", max: 20, windowMs: 60_000 });
  if (!limit.allowed) return reply({ error: "Too many attempts. Please wait a minute." }, 429);
  if (!isSameSiteRequest(req)) return reply({ error: "Send this redemption from the business's own page." }, 403);

  const raw = await readJsonBody(req);
  if (!raw) return reply({ error: "We couldn't read that redemption. Nothing was sent." }, 400);
  if (typeof raw.website === "string" && raw.website.trim().length > 0) {
    return reply({ received: true, reference: null }, 202);
  }
  if (!hasDurableDatabase()) return reply({ error: OFFLINE_WRITE_ERROR }, 503);

  const { code } = await params;
  // The same normalisation and the same business scoping as the wallet read: a hand-typed code
  // resolves to the one row, and a card issued by another business cannot be spent here.
  const cardCode = normaliseCardCode(code);
  const expectedSlug = cleanOptionalText(raw.business, 120);
  const rewardId = cleanText(raw.rewardId, 60);
  const requestKey = cleanText(raw.requestKey, 80);
  if (!rewardId) return reply({ error: "Choose the reward you want." }, 400);
  if (requestKey.length < 8) return reply({ error: "That redemption request was incomplete. Please try again." }, 400);
  if (!cardCode) return reply({ error: "We couldn't find that loyalty card." }, 404);

  let card: { id: string; businessId: string; status: string } | null = null;
  try {
    card = await prisma.loyaltyCard.findUnique({
      where: { code: cardCode },
      select: { id: true, businessId: true, status: true },
    });
  } catch {
    return reply({ error: OFFLINE_WRITE_ERROR }, 503);
  }
  if (!card) return reply({ error: "We couldn't find that loyalty card." }, 404);

  try {
    const business = await prisma.business.findUnique({
      where: { id: card.businessId },
      select: { slug: true, isPublished: true, status: true },
    });
    // Refused with the same 404 as a code that does not exist, so this never confirms that the
    // code belongs to another business.
    if (expectedSlug && business?.slug !== expectedSlug) {
      return reply({ error: "We couldn't find that loyalty card." }, 404);
    }
    if (!business || !business.isPublished || business.status === "SUSPENDED") {
      return reply({ error: "This business is not accepting redemptions right now." }, 404);
    }
  } catch {
    return reply({ error: OFFLINE_WRITE_ERROR }, 503);
  }
  if (card.status !== "ACTIVE") {
    return reply({ error: "This card is not active. Please speak to the business." }, 409);
  }

  try {
    const result = await redeemPoints({
      businessId: card.businessId,
      cardId: card.id,
      rewardId,
      // The same request key can only ever create one redemption, however often it is retried.
      idempotencyKey: `PUBLIC:${cardCode}:${requestKey}`,
      note: cleanOptionalText(raw.note, 400),
      channel: "CUSTOMER",
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    return reply(
      {
        reference: result.redemption?.reference ?? null,
        rewardTitle: result.redemption?.rewardTitleSnapshot ?? null,
        pointsSpent: result.redemption?.pointsSpent ?? 0,
        availablePoints: result.account?.availablePoints ?? null,
        status: result.redemption?.status ?? "PENDING",
        duplicate: result.duplicate === true,
        message: result.duplicate
          ? "You already redeemed that reward. Show the business your redemption reference."
          : "Redeemed. Show the business your redemption reference to collect.",
      },
      result.duplicate ? 200 : 201,
    );
  } catch {
    return reply({ error: "We couldn't complete that redemption. Please try again." }, 503);
  }
}
