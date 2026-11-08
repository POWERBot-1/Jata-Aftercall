import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getInteractiveEntitlement: vi.fn() }));
vi.mock("@/lib/experience/entitlement", () => ({
  getInteractiveEntitlement: mocks.getInteractiveEntitlement,
}));

import { getWebsiteStudioEntitlements, websiteStudioEntitlementsForPlan } from "@/lib/experience/studio-plan-entitlements";

describe("Website Studio plan entitlements", () => {
  it("keeps the existing INTERACTIVE_BUSINESS plan at one website per business", () => {
    expect(websiteStudioEntitlementsForPlan("INTERACTIVE_BUSINESS")).toMatchObject({
      planKey: "INTERACTIVE_BUSINESS",
      maxWebsitesPerBusiness: 1,
      teamAccess: "BUSINESS_MEMBER_ROLES",
      aiUsage: "EXISTING_AI_QUOTA",
      mediaStorage: "EXISTING_MEDIA_STORAGE_POLICY",
      advancedCapabilitiesConfigured: false,
    });
  });

  it("fails closed for other JATA plan keys and unapproved future Studio keys", () => {
    expect(websiteStudioEntitlementsForPlan("BUSINESS_POS")).toBeNull();
    expect(websiteStudioEntitlementsForPlan("AI_BUSINESS_FRONT_DESK")).toBeNull();
    expect(websiteStudioEntitlementsForPlan("WEBSITE_STUDIO_PRO")).toBeNull();
    expect(websiteStudioEntitlementsForPlan(null)).toBeNull();
  });

  it("reuses the authoritative Website Studio billing entitlement without a parallel ledger", async () => {
    mocks.getInteractiveEntitlement.mockResolvedValue({
      entitled: true,
      status: "ACTIVE",
      planKey: "INTERACTIVE_BUSINESS",
      reason: "Active",
    });
    await expect(getWebsiteStudioEntitlements("business-a")).resolves.toMatchObject({
      entitled: true,
      limits: { maxWebsitesPerBusiness: 1 },
    });
    expect(mocks.getInteractiveEntitlement).toHaveBeenCalledWith("business-a");
  });
});
