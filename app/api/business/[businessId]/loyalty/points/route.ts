import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import {
  getOrCreateProgramme,
  listAccounts,
  listLedger,
  listRedemptions,
  listRewards,
  pointsStats,
  saveProgramme,
  validateProgrammeInput,
} from "@/lib/business-hub/loyaltyPoints";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Owner view of the POINTS programme (Loyalty 2.0). Stamps live on the sibling `/loyalty` route
 * and are unaffected by anything here: this reads the points tables only.
 */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);
  const { searchParams } = new URL(req.url);
  try {
    const programme = await getOrCreateProgramme(businessId);
    const [accounts, rewards, ledger, redemptions, stats] = await Promise.all([
      listAccounts(businessId, { search: searchParams.get("search") }),
      listRewards(businessId, { includeInactive: true }),
      listLedger(businessId, { take: 50 }),
      listRedemptions(businessId, { take: 50 }),
      pointsStats(businessId),
    ]);
    return reply({ programme, accounts, rewards, ledger, redemptions, stats }, 200);
  } catch {
    return reply({ error: "We couldn't load your points programme. Please try again." }, 503);
  }
}

/**
 * Save the points configuration.
 *
 * The programme leaves this route switched off unless the owner asked for it with a complete
 * earning rate — `validateProgrammeInput` refuses activation rather than inventing a rate.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read those settings." }, 400);
  const parsed = validateProgrammeInput(body);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  try {
    const programme = await saveProgramme({
      businessId,
      input: parsed.value,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_PROGRAMME_UPDATED",
      targetType: "LoyaltyPointsProgramme",
      targetId: programme.id,
      metadata: {
        businessId,
        isActive: programme.isActive,
        kesPerPoint: programme.kesPerPoint,
        pointsPerUnit: programme.pointsPerUnit,
        expiryMonths: programme.expiryMonths,
      },
    }).catch(() => undefined);
    return reply({ programme }, 200);
  } catch {
    return reply({ error: "We couldn't save those settings. Please try again." }, 503);
  }
}
