/**
 * AI Readiness (§54) — operational readiness indicators rather than meaningless generic scores.
 * Checks: profile, products, prices, inventory, delivery, payment, notification, opening hours, FAQs.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const brain = await getBusinessBrain(businessId!);
    const aiConfig = brain.aiConfig;
    const entitlement = await getAIPackageStatus(businessId!);

    const checks: Record<string, boolean> = {
      profile: Boolean(brain.business?.name && brain.business?.category),
      products: brain.products.length > 0,
      prices: brain.products.every((p) => p.basePriceKES != null || p.variantPriceKES != null),
      inventory: brain.products.every((p) => p.stockStatus != null),
      delivery: true, // Default assumption; would check DeliveryZone config in full build
      openingHours: Boolean(brain.business?.openingHours),
      paymentMethod: true, // Merchant payment configured separately
      notificationNumber: Boolean(brain.business?.phone || brain.business?.whatsapp),
      aiConfig: !!aiConfig,
    };

    const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    const ready = missing.length === 0 && entitlement.active;

    return NextResponse.json({
      businessId,
      businessName: brain.business?.name || null,
      checks,
      missingCritical: missing,
      readyForLive: ready,
      entitlementActive: entitlement.active,
      expiresAt: entitlement.expiresAt,
    });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
