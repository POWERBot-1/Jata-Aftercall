/**
 * Intelligence Route — AI Quality Tracking (§30) — operational metadata.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { recordAIQualityEvent, getQualityEvents } from "@/lib/intelligence";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const eventType = url.searchParams.get("eventType") || undefined;
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const events = await getQualityEvents(businessId!, eventType);
  return NextResponse.json({ qualityEvents: events });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });

    const event = await recordAIQualityEvent({
      businessId: businessId!,
      conversationId: body.conversationId || null,
      sourceUsed: body.sourceUsed || "structured_data",
      confidence: body.confidence || null,
      escalatedToHuman: Boolean(body.escalatedToHuman),
      customerCorrectedAI: Boolean(body.customerCorrectedAI),
      missingBusinessInfo: Boolean(body.missingBusinessInfo),
      eventType: body.eventType || null,
      metadata: body.metadata || null,
    });
    return NextResponse.json({ qualityEvent: event }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
