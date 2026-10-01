/**
 * Intelligence Route — Demand Insights (§28, §54, §64, §65)
 * Tracks missed-demand (what customers wanted but couldn't buy) to help
 * business decisions (
§65).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { recordDemandInsight, getDemandInsights } from "@/lib/intelligence";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const insights = await getDemandInsights(businessId!);
  return NextResponse.json({ demandInsights: insights });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const insightType = typeof body.insightType === "string" ? body.insightType.trim() : "MISSED_DEMAND";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });
    if (!subject || subject.length < 2) return NextResponse.json({ error: "Subject required." }, { status: 400 });
    const result = await recordDemandInsight(businessId!, insightType, subject);
    await logAudit({ actorId: session.userId, action: "DEMAND_INSIGHT_RECORDED", targetType: "DEMAND_INSIGHT", targetId: result.id, metadata: { type: insightType, subject } });
    return NextResponse.json({ demandInsight: result }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
