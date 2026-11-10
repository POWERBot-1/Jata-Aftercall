import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase } from "@/lib/business-hub/guard";
import { runExpiry } from "@/lib/business-hub/loyaltyPoints";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Process expiry for this business (Loyalty 2.0).
 *
 * Safe to press twice and safe to run after an interruption: expiry is idempotent per earning lot.
 * When the programme has no expiry period it does nothing at all and says so — points are never
 * expired on a programme that switched expiry off.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  try {
    const result = await runExpiry({
      businessId,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_EXPIRY_RUN",
      targetType: "LoyaltyPointsProgramme",
      targetId: businessId,
      metadata: { businessId, ...result },
    }).catch(() => undefined);
    return reply(result, 200);
  } catch {
    return reply({ error: "We couldn't process expiry. Please try again." }, 503);
  }
}
