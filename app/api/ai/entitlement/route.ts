import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { getPlanConfig } from "@/lib/pricing";
import { isFrontDeskTierKey } from "@/lib/frontDeskTiers";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const [status, planForTier] = await Promise.all([
      getAIPackageStatus(businessId),
      getPlanConfig("AI_BUSINESS_FRONT_DESK"),
    ]);
    // Price card for the tier the business actually holds (any of the four Front Desk tiers),
    // falling back to the Starter row for display when no tier is active yet.
    const tierKey =
      status.packageKey && isFrontDeskTierKey(status.packageKey)
        ? status.packageKey
        : "AI_BUSINESS_FRONT_DESK";
    const plan =
      tierKey === "AI_BUSINESS_FRONT_DESK" && planForTier
        ? planForTier
        : (await getPlanConfig(tierKey)) ?? planForTier;

    return NextResponse.json({
      entitlement: status,
      plan,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch entitlement.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
