import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import {
  captureLead,
  isValidLeadClassification,
  LEAD_CLASSIFICATIONS,
  listLeadsForBusiness,
} from "@/lib/leads";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      businessId,
      classification,
      customerName,
      customerPhone,
      customerEmail,
      summary,
      conversationId,
      channel,
      referenceId,
      idempotencyKey,
      preview,
    } = body || {};

    if (!businessId || !classification) {
      return NextResponse.json({ error: "businessId and classification required." }, { status: 400 });
    }

    if (!isValidLeadClassification(classification)) {
      return NextResponse.json(
        { error: `Invalid classification. Must be one of: ${LEAD_CLASSIFICATIONS.join(", ")}` },
        { status: 400 },
      );
    }

    const user = await getCurrentUser().catch(() => null);
    if (user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    const result = await captureLead({
      businessId,
      classification,
      customerName,
      customerPhone,
      customerEmail,
      summary: summary || `Lead: ${classification}`,
      conversationId,
      channel,
      referenceId,
      idempotencyKey,
      preview: Boolean(preview),
    });

    return NextResponse.json({
      leadId: result.lead.id,
      lead: result.lead,
      classification: result.lead.classification,
      preview: result.preview,
      idempotent: result.idempotent,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create lead.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    const classificationParam = searchParams.get("classification");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const classification = isValidLeadClassification(classificationParam) ? classificationParam : undefined;
    const leads = await listLeadsForBusiness(businessId, classification);

    return NextResponse.json({ leads });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list leads.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
