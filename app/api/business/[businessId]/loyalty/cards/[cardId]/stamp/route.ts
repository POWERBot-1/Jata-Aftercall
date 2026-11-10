import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { awardStamp } from "@/lib/business-hub/loyalty";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Award stamps for one OWNER-VERIFIED transaction (Business Hub D).
 *
 * The duplicate guard is the unique index on (businessId, transactionRef), so replaying this
 * endpoint — deliberately, or by two staff members tapping at once — can never stamp twice.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string; cardId: string }> }) {
  const { businessId, cardId } = await params;
  const auth = await authorizeOwner(businessId, "operate");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your loyalty programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that verification." }, 400);

  try {
    const result = await awardStamp({
      businessId,
      cardId,
      transactionRef: cleanText(body.transactionRef, 80),
      stamps: Number(body.stamps ?? 1),
      note: cleanOptionalText(body.note, 400),
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_LOYALTY_STAMP_AWARDED",
      targetType: "LoyaltyCard",
      targetId: cardId,
      metadata: { businessId, transactionRef: result.record.transactionRef, stamps: result.record.stamps },
    }).catch(() => undefined);
    return reply({ stamp: result.record, card: result.card }, 201);
  } catch {
    return reply({ error: "We couldn't award that stamp. Please try again." }, 503);
  }
}
