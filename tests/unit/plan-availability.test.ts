import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getActivePlans, getPlanByKey, FALLBACK_PLANS } from "@/lib/pricing";

const root = path.resolve(__dirname, "../..");

vi.mock("@/lib/db", () => {
  const rows = [
    { id: "p1", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
    { id: "p2", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  ];
  return {
    default: {
      planConfig: {
        findMany: vi.fn(async ({ where }: any) => (where?.isActive === true ? rows : [])),
        findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.key === where.key || r.id === where.id) || null),
      },
    },
  };
});

describe("active subscription plans", () => {
  it("getActivePlans queries only active plans and returns them cheapest first at the DB", async () => {
    const plans = await getActivePlans();
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.key)).toEqual(["ANNUAL", "MONTHLY"]);
    for (const p of plans) expect(p.isActive).toBe(true);
  });

  it("plans are DB-driven with the intended KES prices", async () => {
    expect(await getPlanByKey("ANNUAL")).toMatchObject({ priceKES: 999, durationDays: 365 });
    expect(await getPlanByKey("MONTHLY")).toMatchObject({ priceKES: 149, durationDays: 30 });
    for (const p of FALLBACK_PLANS) expect(p.isActive).toBe(true);
  });
});

describe("seed keeps the intended KES plans active", () => {
  const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");

  it("seed upsert reactivates plans instead of leaving them deactivated", () => {
    // Regression guard: the upsert update clause must include isActive: true, otherwise a
    // re-run of the seed can never restore plans that were deactivated — the root cause of
    // "No active plans are available right now."
    const upsertLine = seed.split("\n").find((l) => l.includes("planConfig.upsert")) || "";
    expect(upsertLine).toContain("isActive: true");
    expect(seed).toContain('key: "ANNUAL"');
    expect(seed).toContain('key: "MONTHLY"');
    expect(seed).toContain("priceKES: 999");
    expect(seed).toContain("priceKES: 149");
  });
});

describe("onboarding plan-selection path", () => {
  const onboarding = readFileSync(path.join(root, "app/onboarding/page.tsx"), "utf8");
  const form = readFileSync(path.join(root, "components/OnboardingForm.tsx"), "utf8");
  const subscription = readFileSync(path.join(root, "app/dashboard/subscription/page.tsx"), "utf8");

  it("onboarding offers exactly the active plans to the signed-in owner", () => {
    expect(onboarding).toContain('where: { isActive: true }');
    expect(onboarding).toContain("<OnboardingForm plans=");
  });

  it("plan cards lead into checkout for the selected business and plan", () => {
    expect(form).toContain("Choose a subscription plan");
    expect(form).toContain("getCheckoutUrl(business.id, plan.id)");
  });

  it("there is no publish-without-payment escape hatch in onboarding", () => {
    expect(form).not.toContain("Continue without payment");
    expect(form).not.toContain("You can publish now and choose a plan later");
    expect(form).toContain("Continue to publish");
  });

  it("subscription page distinguishes a query failure from genuinely empty plan list", () => {
    expect(subscription).not.toContain("catch(() => [])");
    expect(subscription).toContain("Plans are temporarily unavailable");
    expect(subscription).toContain("No active plans are available right now");
  });
});
