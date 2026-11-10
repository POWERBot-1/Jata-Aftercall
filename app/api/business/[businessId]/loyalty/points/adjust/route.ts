import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { adjustPoints } from "@/lib/business-hub/loyaltyPoints";
import { cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Manual points adjustment (Loyalty 2.0).
 *
 * A correction is a new MANUAL_ADJUSTMENT ledger entry — never an edit of an older one — and it
 * requires a reason and a configure-level permission. An optional `idempotencyKey` makes a retried
 * adjustment safe: the same key can only ever write one entry.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that adjustment." }, 400);
  const cardId = cleanText(body.cardId, 60);
  if (!cardId) return reply({ error: "Choose the customer whose points you are adjusting." }, 400);

  try {
    const result = await adjustPoints({
      businessId,
      cardId,
      points: Number(body.points),
      reason: cleanText(body.reason, 400),
      idempotencyKey: cleanText(body.idempotencyKey, 120) || null,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    if (!result.ok) return reply({ error: result.error }, result.status);
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_ADJUSTED",
      targetType: "LoyaltyPointsAccount",
      targetId: result.account?.id ?? cardId,
      metadata: {
        businessId,
        points: body.points,
        reason: result.entry?.explanation ?? null,
        duplicate: result.duplicate === true,
      },
    }).catch(() => undefined);
    return reply(
      { entry: result.entry, account: result.account, duplicate: result.duplicate === true },
      result.duplicate ? 200 : 201,
    );
  } catch {
    return reply({ error: "We couldn't record that adjustment. Please try again." }, 503);
  }
}
