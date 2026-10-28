/**
 * Customer-facing product naming.
 *
 * The stored plan key stays `INTERACTIVE_BUSINESS` (it is the billing source of truth), but every
 * owner/customer-facing surface must call the product "Website Studio" — the brand used on the
 * homepage and the workspace rail. These tests pin the canonical name at the behaviour level
 * (entitlement reasons, next actions, status help, AI quota label, plan display name) and as
 * source guards on the components that render the name, so the legacy "Interactive Business"
 * wording cannot silently return to a screen a customer reads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WEBSITE_STUDIO_NAME } from "@/lib/productNames";
import { planDisplayName } from "@/lib/pricing";
import { deriveEntitlement, INTERACTIVE_PLAN_KEY } from "@/lib/experience/entitlement";
import { nextActionFor } from "@/lib/nextAction";
import { entitlementStatusLabel } from "@/lib/statusLabels";
import { INTERACTIVE_AI_QUOTA } from "@/lib/ai/quota";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const future = new Date(Date.now() + 10 * 86_400_000);

describe("canonical product name", () => {
  it("is Website Studio", () => {
    expect(WEBSITE_STUDIO_NAME).toBe("Website Studio");
  });

  it("renders the Website Studio brand for the INTERACTIVE_BUSINESS plan even when the stored name is legacy", () => {
    expect(planDisplayName({ key: INTERACTIVE_PLAN_KEY, name: "Interactive Business — KES 999/month" })).toMatch(
      /^Website Studio\b/,
    );
    expect(planDisplayName({ key: INTERACTIVE_PLAN_KEY, name: "Interactive Business � KES 999/month" })).toBe(
      "Website Studio — KES 999/month",
    );
  });
});

describe("entitlement reasons speak the customer-facing name", () => {
  it("names Website Studio when there is no subscription", () => {
    const state = deriveEntitlement({ subscription: null as never });
    expect(state.reason).toContain(WEBSITE_STUDIO_NAME);
    expect(state.reason).not.toContain("Interactive Business");
  });

  it("names Website Studio when the held plan does not include it", () => {
    const state = deriveEntitlement({
      subscription: { status: "ACTIVE", plan: { key: "MONTHLY" }, expiresAt: future } as never,
      paidPayment: { status: "PAID" },
    });
    expect(state.reason).toContain(WEBSITE_STUDIO_NAME);
    expect(state.reason).not.toContain("Interactive Business");
  });

  it("names Website Studio while payment is pending and when expired", () => {
    const pending = deriveEntitlement({
      subscription: { status: "PENDING", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: future } as never,
    });
    expect(pending.reason).toContain(WEBSITE_STUDIO_NAME);

    const expired = deriveEntitlement({
      subscription: { status: "ACTIVE", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: new Date(Date.now() - 86_400_000) } as never,
      paidPayment: { status: "PAID" },
    });
    expect(expired.reason).toContain(WEBSITE_STUDIO_NAME);
    expect(expired.reason).not.toContain("Interactive Business");
  });
});

describe("dashboard guidance and labels use the same name", () => {
  const base = {
    isPublished: true,
    hasContact: true,
    hasLocation: true,
    servicesCount: 2,
    subscriptionStatus: "ACTIVE",
    expiresAt: future.toISOString(),
  };

  it("calls the first-run action a Website Studio website", () => {
    const action = nextActionFor({ ...base, hasExperience: false });
    expect(action.key).toBe("start-experience");
    expect(action.title).toContain(WEBSITE_STUDIO_NAME);
    expect(action.title).not.toContain("Interactive Business");
  });

  it("calls the renewal prompt Activate Website Studio", () => {
    const action = nextActionFor({ ...base, hasExperience: true, entitlementStatus: "EXPIRED" });
    expect(action.key).toBe("renew");
    expect(action.title).toBe(`Activate ${WEBSITE_STUDIO_NAME}`);
  });

  it("explains the no-package state with the product name", () => {
    expect(entitlementStatusLabel(null).help).toContain(WEBSITE_STUDIO_NAME);
  });

  it("labels the AI quota with the product name", () => {
    expect(INTERACTIVE_AI_QUOTA.planKey).toBe(INTERACTIVE_PLAN_KEY);
    expect(INTERACTIVE_AI_QUOTA.label).toBe(WEBSITE_STUDIO_NAME);
  });
});

describe("customer-facing screens never print the legacy name", () => {
  const guarded = [
    "app/page.tsx",
    "app/dashboard/subscription/page.tsx",
    "components/dashboard/EntitlementBanner.tsx",
    "components/dashboard/PublishPanel.tsx",
    "components/dashboard/WebsiteHealth.tsx",
  ];
  for (const file of guarded) {
    it(`${file} uses Website Studio, not "Interactive Business"`, () => {
      expect(read(file)).not.toContain("Interactive Business");
    });
  }
});
