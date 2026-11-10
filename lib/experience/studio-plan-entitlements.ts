import { getInteractiveEntitlement } from "@/lib/experience/entitlement";

/**
 * The only currently configured Website Studio billing key is the legacy
 * INTERACTIVE_BUSINESS key (customer-facing name: Website Studio).
 * Keep its existing Starter entitlement at one site per business. Future
 * Growth/Pro/Agency limits must be explicitly configured and approved; unknown
 * plan keys fail closed rather than inheriting another JATA product's limits.
 *
 * Team roles, AI quotas and media storage remain delegated to their existing
 * authoritative Website Studio/BusinessMember/R2 subsystems; this module does
 * not create parallel subscriptions, usage counters or storage records.
 */
export const WEBSITE_STUDIO_PLAN_KEY = "INTERACTIVE_BUSINESS";

export type WebsiteStudioEntitlements = {
  planKey: typeof WEBSITE_STUDIO_PLAN_KEY;
  maxWebsitesPerBusiness: number;
  teamAccess: "BUSINESS_MEMBER_ROLES";
  aiUsage: "EXISTING_AI_QUOTA";
  mediaStorage: "EXISTING_MEDIA_STORAGE_POLICY";
  advancedCapabilitiesConfigured: false;
};

export function websiteStudioEntitlementsForPlan(planKey: string | undefined | null): WebsiteStudioEntitlements | null {
  if (planKey !== WEBSITE_STUDIO_PLAN_KEY) return null;
  return {
    planKey: WEBSITE_STUDIO_PLAN_KEY,
    maxWebsitesPerBusiness: 1,
    teamAccess: "BUSINESS_MEMBER_ROLES",
    aiUsage: "EXISTING_AI_QUOTA",
    mediaStorage: "EXISTING_MEDIA_STORAGE_POLICY",
    advancedCapabilitiesConfigured: false,
  };
}

export async function getWebsiteStudioEntitlements(businessId: string) {
  const entitlement = await getInteractiveEntitlement(businessId);
  return {
    ...entitlement,
    limits: websiteStudioEntitlementsForPlan(entitlement.planKey),
  };
}
