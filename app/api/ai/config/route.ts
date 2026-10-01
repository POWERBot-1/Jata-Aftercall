import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";

/**
 * AI Configuration (§29) — business-controlled rules for the AI package.
 * Every mutation is tenant-scoped; secrets are never stored here.
 */

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const config = await prisma.aIConfiguration.findUnique({ where: { businessId: businessId! } });
  return NextResponse.json({ config: config || null });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const existing = await prisma.aIConfiguration.findUnique({ where: { businessId: businessId! } });

    // Only configure basic fields; never store secrets or credentials (§6, §43).
    const tone = typeof body.tone === "string" && ["professional", "friendly", "casual", "premium", "local", "formal"].includes(body.tone) ? body.tone : "friendly";
    const language = typeof body.language === "string" ? body.language : "en";
    const salesBehavior = typeof body.salesBehavior === "string" && ["informational", "recommend", "upsell", "cross_sell", "promotions"].includes(body.salesBehavior) ? body.salesBehavior : "informational";
    const orderingAllowed = typeof body.orderingAllowed === "boolean" ? body.orderingAllowed : true;
    const preordersAllowed = typeof body.preordersAllowed === "boolean" ? body.preordersAllowed : false;
    const humanEscalation = typeof body.humanEscalation === "string" && ["always", "business_hours", "specified_topics", "uncertain"].includes(body.humanEscalation) ? body.humanEscalation : "uncertain";
    const welcomeMessage = typeof body.welcomeMessage === "string" ? body.welcomeMessage.trim() || null : null;

    if (existing) {
      const updated = await prisma.aIConfiguration.update({
        where: { businessId: businessId! },
        data: { tone, language, salesBehavior, orderingAllowed, preordersAllowed, humanEscalation, welcomeMessage },
      });
      await logAudit({ actorId: session.userId, action: "AI_CONFIGURATION_UPDATED", targetType: "AI_CONFIGURATION", targetId: updated.id });
      return NextResponse.json({ config: updated });
    }

    const created = await prisma.aIConfiguration.create({
      data: { businessId: businessId!, tone, language, salesBehavior, orderingAllowed, preordersAllowed, humanEscalation, welcomeMessage },
    });
    await logAudit({ actorId: session.userId, action: "AI_CONFIGURATION_CREATED", targetType: "AI_CONFIGURATION", targetId: created.id });
    return NextResponse.json({ config: created }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
