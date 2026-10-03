import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { getQualityEvents, recordAIQualityEvent } from "@/lib/intelligence";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    const eventType = searchParams.get("eventType") || undefined;

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    // Tenant data is never served to an anonymous caller: the session is mandatory here.
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const events = await getQualityEvents(businessId, eventType);
    return NextResponse.json({ events });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch quality events.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const body = await req.json();
    const {
      businessId,
      conversationId,
      sourceUsed,
      confidence,
      escalatedToHuman,
      customerCorrectedAI,
      missingBusinessInfo,
      eventType,
      metadata,
    } = body || {};

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    // Tenant data is never served to an anonymous caller: the session is mandatory here.
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const event = await recordAIQualityEvent({
      businessId,
      conversationId,
      sourceUsed,
      confidence,
      escalatedToHuman,
      customerCorrectedAI,
      missingBusinessInfo,
      eventType,
      metadata,
    });
    return NextResponse.json({ event });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record quality event.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
