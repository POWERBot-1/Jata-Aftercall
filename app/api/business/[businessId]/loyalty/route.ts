import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import {
  enrolCard,
  getOrCreateProgram,
  listCards,
  loyaltyStats,
  saveProgram,
  validateCardInput,
  validateProgramInput,
} from "@/lib/business-hub/loyalty";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Owner view: programme configuration, cards and programme statistics. */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your loyalty programme is temporarily unavailable." }, 503);
  const { searchParams } = new URL(req.url);
  try {
    const [program, cards, stats] = await Promise.all([
      getOrCreateProgram(businessId),
      listCards(businessId, { search: searchParams.get("search") }),
      loyaltyStats(businessId),
    ]);
    return reply({ program, cards, stats }, 200);
  } catch {
    return reply({ error: "We couldn't load your loyalty programme. Please try again." }, 503);
  }
}

/** Update the programme configuration (milestone, reward description, terms, on/off). */
export async function PUT(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your loyalty programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read those settings." }, 400);
  const parsed = validateProgramInput(body);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  try {
    const program = await saveProgram({
      businessId,
      input: parsed.value,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_LOYALTY_PROGRAM_UPDATED",
      targetType: "LoyaltyProgram",
      targetId: program.id,
      metadata: { businessId, stampGoal: parsed.value.stampGoal },
    }).catch(() => undefined);
    return reply({ program }, 200);
  } catch {
    return reply({ error: "We couldn't save those settings. Please try again." }, 503);
  }
}

/** Enrol a customer and issue a card code. The code is returned once and shown to the owner. */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "operate");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your loyalty programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read those details." }, 400);
  const parsed = validateCardInput(body);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  try {
    const card = await enrolCard({
      businessId,
      input: parsed.value,
      actorId: auth.actor.userId,
      actorLabel: auth.actor.label,
    });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_LOYALTY_CARD_CREATED",
      targetType: "LoyaltyCard",
      targetId: card.id,
      metadata: { businessId },
    }).catch(() => undefined);
    return reply({ card }, 201);
  } catch {
    return reply({ error: "We couldn't issue that card. Please try again." }, 503);
  }
}
