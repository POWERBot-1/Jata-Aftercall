import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  getSubscriptionPageUrl,
  getCheckoutUrl,
  resolveOnboardingRedirect,
  resolveOnboardingDestination,
  dashboardRedirectTarget,
  type BusinessSubscriptionStatus,
  type OnboardingBusinessSource,
} from "@/lib/subscriptionFlow";

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

// ── Fix 2: onboarding redirect decided outside try/catch ─────────────────────────────────────────

function sourceOf(businesses: BusinessSubscriptionStatus[]): OnboardingBusinessSource {
  return {
    listOwnedBusinesses: async () => businesses,
    countOwnedBusinesses: async () => businesses.length,
  };
}

describe("resolveOnboardingDestination — owner redirect decisions (Fix 2)", () => {
  it("passes the session user id to the data source", async () => {
    const seen: string[] = [];
    const source: OnboardingBusinessSource = {
      listOwnedBusinesses: async (userId) => {
        seen.push(userId);
        return [];
      },
      countOwnedBusinesses: async () => 0,
    };
    await resolveOnboardingDestination("user_42", source);
    expect(seen).toEqual(["user_42"]);
  });

  it("existing business without an active subscription → /dashboard/subscription?businessId=...", async () => {
    const dest = await resolveOnboardingDestination("u1", sourceOf([{ id: "biz_unsub", hasActiveSubscription: false }]));
    expect(dest).toBe("/dashboard/subscription?businessId=biz_unsub");
  });

  it("existing business with an active subscription → /dashboard", async () => {
    const dest = await resolveOnboardingDestination("u1", sourceOf([{ id: "biz_active", hasActiveSubscription: true }]));
    expect(dest).toBe("/dashboard");
  });

  it("several businesses: the first unsubscribed one is selected", async () => {
    const dest = await resolveOnboardingDestination(
      "u1",
      sourceOf([
        { id: "biz_active", hasActiveSubscription: true },
        { id: "biz_unsub_1", hasActiveSubscription: false },
        { id: "biz_unsub_2", hasActiveSubscription: false },
      ]),
    );
    expect(dest).toBe("/dashboard/subscription?businessId=biz_unsub_1");
  });

  it("no business → null (user remains on onboarding)", async () => {
    expect(await resolveOnboardingDestination("u1", sourceOf([]))).toBeNull();
  });

  it("primary read fails, count > 0 → /dashboard (fallback, never a loop)", async () => {
    const source: OnboardingBusinessSource = {
      listOwnedBusinesses: async () => {
        throw new Error("relation subscription unavailable");
      },
      countOwnedBusinesses: async () => 2,
    };
    expect(await resolveOnboardingDestination("u1", source)).toBe("/dashboard");
  });

  it("primary read fails, count = 0 → null (stay on onboarding)", async () => {
    const source: OnboardingBusinessSource = {
      listOwnedBusinesses: async () => {
        throw new Error("db down");
      },
      countOwnedBusinesses: async () => 0,
    };
    expect(await resolveOnboardingDestination("u1", source)).toBeNull();
  });

  it("both reads fail → null and never throws (page still renders)", async () => {
    const source: OnboardingBusinessSource = {
      listOwnedBusinesses: async () => {
        throw new Error("db down");
      },
      countOwnedBusinesses: async () => {
        throw new Error("db down");
      },
    };
    await expect(resolveOnboardingDestination("u1", source)).resolves.toBeNull();
  });

  it("never redirects onboarding to itself", async () => {
    const scenarios: BusinessSubscriptionStatus[][] = [
      [],
      [{ id: "a", hasActiveSubscription: false }],
      [{ id: "a", hasActiveSubscription: true }],
      [
        { id: "a", hasActiveSubscription: true },
        { id: "b", hasActiveSubscription: false },
      ],
    ];
    for (const businesses of scenarios) {
      const dest = await resolveOnboardingDestination("u1", sourceOf(businesses));
      expect(dest === null || !dest.startsWith("/onboarding")).toBe(true);
    }
  });

  it("no onboarding/dashboard loop: dashboard only sends 0-business accounts here, onboarding only sends accounts with businesses away", async () => {
    for (const businesses of [[], [{ id: "a", hasActiveSubscription: false }], [{ id: "a", hasActiveSubscription: true }]]) {
      const fromDashboard = dashboardRedirectTarget(businesses.length); // app/dashboard/layout.tsx
      const fromOnboarding = await resolveOnboardingDestination("u1", sourceOf(businesses)); // app/onboarding/page.tsx
      // Exactly one side may redirect for any given account state.
      expect(fromDashboard !== null && fromOnboarding !== null).toBe(false);
      if (fromDashboard === "/onboarding") expect(fromOnboarding).toBeNull();
      if (fromOnboarding !== null) expect(fromOnboarding.startsWith("/dashboard")).toBe(true);
    }
  });
});

describe("onboarding page and new-business subscription journey", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/onboarding/page.tsx"), "utf8");
  const form = readFileSync(path.resolve(__dirname, "../../components/OnboardingForm.tsx"), "utf8");

  it("requires a signed-in user and loads active plans without redirecting existing owners", () => {
    expect(source).toContain('if (!session) redirect("/login");');
    expect(source).toContain('where: { isActive: true }');
    expect(source).toContain("<OnboardingForm plans=");
    expect(source).not.toContain("resolveOnboardingDestination");
  });

  it("creates and saves business context before offering plan-specific checkout", () => {
    expect(form).toContain('fetch("/api/business"');
    expect(form).toContain("getCheckoutUrl(business.id, plan.id)");
    expect(form).toContain("Choose a subscription plan");
    expect(form).toContain("Continue without payment");
    expect(form).toContain("Business & location");
  });

  it("collects and submits location coordinates while keeping publishing separate", () => {
    expect(form).toContain('id="onboard-lat"');
    expect(form).toContain('id="onboard-lng"');
    expect(form).toContain("isPublished: true");
  });
});
