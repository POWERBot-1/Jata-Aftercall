import { describe, it, expect } from "vitest";
import { getSubscriptionPageUrl, getCheckoutUrl, resolveOnboardingRedirect, dashboardRedirectTarget } from "@/lib/subscriptionFlow";

describe("subscription flow — authorized fixes", () => {
  it("existing-business unsubscribed customers go to /dashboard/subscription?businessId=...", () => {
    const dest = resolveOnboardingRedirect({
      ownedBusinessCount: 1,
      businesses: [{ id: "biz_123", hasActiveSubscription: false }],
    });
    expect(dest).toBe("/dashboard/subscription?businessId=biz_123");
  });

  it("all active subscriptions go to /dashboard", () => {
    const dest = resolveOnboardingRedirect({
      ownedBusinessCount: 2,
      businesses: [
        { id: "biz_1", hasActiveSubscription: true },
        { id: "biz_2", hasActiveSubscription: true },
      ],
    });
    expect(dest).toBe("/dashboard");
  });

  it("no business stays in onboarding (null)", () => {
    const dest = resolveOnboardingRedirect({
      ownedBusinessCount: 0,
      businesses: [],
    });
    expect(dest).toBeNull();
  });

  it("first unsubscribed business is selected when multiple", () => {
    const dest = resolveOnboardingRedirect({
      ownedBusinessCount: 3,
      businesses: [
        { id: "biz_active", hasActiveSubscription: true },
        { id: "biz_unsub_1", hasActiveSubscription: false },
        { id: "biz_unsub_2", hasActiveSubscription: false },
      ],
    });
    expect(dest).toBe("/dashboard/subscription?businessId=biz_unsub_1");
  });

  it("getSubscriptionPageUrl formats correctly", () => {
    expect(getSubscriptionPageUrl("abc123")).toBe("/dashboard/subscription?businessId=abc123");
    expect(getSubscriptionPageUrl("biz with spaces")).toContain("businessId=");
  });

  it("plan cards are actionable and lead to /checkout?businessId=...&planId=...", () => {
    const url = getCheckoutUrl("biz_123", "plan_456");
    expect(url).toBe("/checkout?businessId=biz_123&planId=plan_456");
    expect(url).toContain("businessId=");
    expect(url).toContain("planId=");
    expect(url.startsWith("/checkout")).toBe(true);
  });

  it("dashboard provides Subscribe / View plans via getSubscriptionPageUrl", () => {
    const url = getSubscriptionPageUrl("biz_123");
    expect(url).toContain("/dashboard/subscription");
    expect(url).toContain("businessId=biz_123");
  });

  it("dashboardRedirectTarget sends no-business to onboarding", () => {
    expect(dashboardRedirectTarget(0)).toBe("/onboarding");
    expect(dashboardRedirectTarget(1)).toBeNull();
  });
});
