import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { getDemandInsights, recordDemandInsight } from "@/lib/intelligence";

const VALID_TYPES = [
  "DEMAND_INSIGHT",
  "MISSED_DEMAND",
  "UNAVAILABLE_PRODUCT",
  "UNAVAILABLE_SIZE",
  "OUT_OF_ZONE",
  "SERVICE_NOT_OFFERED",
  "PRICE_INQUIRY",
] as const;

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    if (user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    const insights = await getDemandInsights(businessId);
    return NextResponse.json({ insights });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch demand insights.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null);
    const body = await req.json();
    const { businessId, insightType, subject } = body || {};

    if (!businessId || !insightType || !subject) {
      return NextResponse.json({ error: "businessId, insightType, and subject required." }, { status: 400 });
    }
    if (!VALID_TYPES.includes(insightType)) {
      return NextResponse.json(
        { error: `Invalid insightType. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    if (user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    const recorded = await recordDemandInsight(businessId, insightType, subject);
    return NextResponse.json({ insight: recorded });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record demand insight.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
