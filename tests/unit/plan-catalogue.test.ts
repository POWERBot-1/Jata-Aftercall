/**
 * Plan catalogue — the four canonical commercial offerings.
 *
 * Covers the reconciliation defect: the catalogue is database-driven, both new offerings must
 * be present and active, existing plan ids (and therefore existing subscriptions) must be
 * preserved, and no UI page may carry its own hardcoded plan list.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_FALLBACK_PLANS,
  CANONICAL_PLANS,
  canonicalPlanFor,
  planMatchesCanonical,
  planReconciliationReport,
  planReconciliationSummary,
} from "@/lib/canonicalPlans";
import { FALLBACK_PLANS } from "@/lib/pricing";

const root = path.resolve(__dirname, "../..");

describe("canonical commercial offerings", () => {
  it("declares exactly the four offerings at the mandated prices and terms", () => {
    expect(CANONICAL_PLANS.map((plan) => [plan.key, plan.priceKES, plan.durationDays])).toEqual([
      ["ANNUAL", 999, 365],
      ["MONTHLY", 149, 30],
      ["AI_BUSINESS_FRONT_DESK", 499, 30],
      ["INTERACTIVE_BUSINESS", 999, 30],
    ]);
  });

  it("marks both new offerings active in the fallback catalogue", () => {
    for (const key of ["AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]) {
      expect(CANONICAL_FALLBACK_PLANS.find((plan) => plan.key === key)).toMatchObject({ isActive: true });
    }
    expect(CANONICAL_FALLBACK_PLANS.every((plan) => plan.isActive)).toBe(true);
  });

  it("keeps the pricing helper fallback identical to the canonical catalogue", () => {
    expect(FALLBACK_PLANS.map((plan) => [plan.key, plan.priceKES, plan.durationDays, plan.isActive])).toEqual(
      CANONICAL_PLANS.map((plan) => [plan.key, plan.priceKES, plan.durationDays, true]),
    );
  });

  it("recognises only a complete, active, exactly-priced row as canonical", () => {
    const annual = { key: "ANNUAL", name: canonicalPlanFor("ANNUAL")!.name, priceKES: 999, durationDays: 365, isActive: true };
    expect(planMatchesCanonical(annual)).toBe(true);
    expect(planMatchesCanonical({ ...annual, isActive: false })).toBe(false);
    expect(planMatchesCanonical({ ...annual, priceKES: 149 })).toBe(false);
    expect(planMatchesCanonical({ ...annual, durationDays: 30 })).toBe(false);
    expect(planMatchesCanonical({ ...annual, key: "PROMO" })).toBe(false);
  });
});

describe("plan reconciliation decision", () => {
  const productionLikeCatalogue = [
    { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
    { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  ];

  it("creates exactly the two missing offerings and keeps the existing ones untouched", () => {
    const report = planReconciliationReport(productionLikeCatalogue);
    expect(report.actions).toEqual([
      { kind: "unchanged", key: "ANNUAL" },
      { kind: "unchanged", key: "MONTHLY" },
      expect.objectContaining({ kind: "create", key: "AI_BUSINESS_FRONT_DESK" }),
      expect.objectContaining({ kind: "create", key: "INTERACTIVE_BUSINESS" }),
    ]);
    expect(planReconciliationSummary(report)).toEqual({ create: 2, update: 0, unchanged: 2, untouched: 0 });
  });

  it("reactivates a deactivated plan and repairs a drifted price without recreating it", () => {
    const report = planReconciliationReport([
      { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: false },
      { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 1499, durationDays: 365, isActive: true },
    ]);
    expect(report.actions[0]).toMatchObject({ kind: "update", key: "ANNUAL", changes: ["priceKES"] });
    expect(report.actions[1]).toMatchObject({ kind: "update", key: "MONTHLY", changes: ["isActive"] });
    // No action ever deletes: deactivation is repaired, never punished.
    expect(report.actions.every((action) => action.kind !== "unchanged" ? action.kind === "update" || action.kind === "create" : true)).toBe(true);
  });

  it("never touches a plan outside the canonical four", () => {
    const report = planReconciliationReport([
      ...productionLikeCatalogue,
      { key: "PROMO_2026", name: "Promo", priceKES: 1, durationDays: 7, isActive: true },
    ]);
    expect(report.untouchedKeys).toEqual(["PROMO_2026"]);
    // The untouched row is reported, never scheduled for a write or a deactivation.
    expect(report.actions.some((action) => action.key === "PROMO_2026")).toBe(false);
  });

  it("is idempotent: a fully reconciled catalogue plans no writes", () => {
    const reconciled = CANONICAL_PLANS.map((plan) => ({ ...plan, isActive: true }));
    const report = planReconciliationReport(reconciled);
    expect(report.actions.every((action) => action.kind === "unchanged")).toBe(true);
    expect(planReconciliationSummary(report)).toEqual({ create: 0, update: 0, unchanged: 4, untouched: 0 });
  });
});

describe("reconciliation CLI is scoped to PlanConfig only", () => {
  const script = readFileSync(path.join(root, "scripts/reconcile-plans.ts"), "utf8");

  it("refuses to run without DATABASE_URL and is dry-run unless --apply is passed", () => {
    expect(script).toContain("DATABASE_URL");
    expect(script).toContain("refusing to run");
    expect(script).toContain('process.argv.includes("--apply")');
    expect(script).toContain("dry run complete — nothing was written");
  });

  it("writes only to planConfig — never to tenant, payment, subscription or referral data", () => {
    const writeCalls = [
      "prisma.user",
      "prisma.business",
      "prisma.businessMember",
      "prisma.subscription",
      "prisma.payment",
      "prisma.referral",
      "prisma.interactiveBusinessEntitlement",
      "prisma.aIPackageEntitlement",
      "prisma.auditEvent",
      "prisma.processedWebhook",
    ];
    for (const target of writeCalls) expect(script).not.toContain(target);
    expect(script).toContain("prisma.planConfig.upsert");
    expect(script).not.toContain("deleteMany");
    expect(script).not.toContain("$executeRaw");
    expect(script).not.toContain("prisma.$executeRawUnsafe");
    expect(script).not.toContain("prisma.planConfig.delete");
    expect(script).not.toContain("prisma.planConfig.updateMany");
    // It must not shell out to the general seed.
    expect(script).not.toContain("prisma/seed");
  });

  it("never prints the connection string", () => {
    expect(script).toContain("redactedFingerprint");
    expect(script).not.toMatch(/console\.log\((?:databaseUrl|.*process\.env\.DATABASE_URL)/);
  });

  it("verifies its own result and fails when the catalogue is still wrong", () => {
    expect(script).toContain("planMatchesCanonical");
    expect(script).toContain("verification failed");
    expect(script).toContain("process.exitCode = 1");
  });

  it("is wired as an npm script for operators", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts["reconcile:plans"]).toBe("tsx scripts/reconcile-plans.ts");
  });
});

describe("the catalogue stays database-driven in the UI", () => {
  it("the landing page renders the shared catalogue instead of its own plan list", () => {
    const landing = readFileSync(path.join(root, "app/page.tsx"), "utf8");
    expect(landing).toContain('prisma.planConfig.findMany({ where: { isActive: true }');
    expect(landing).toContain("FALLBACK_PLANS");
    // Regression guard: the page used to hardcode only Annual + Monthly.
    expect(landing).not.toContain('key: "ANNUAL"');
    expect(landing).not.toContain('key: "MONTHLY"');
  });

  it("onboarding and subscription pages list every active plan from the database", () => {
    const onboarding = readFileSync(path.join(root, "app/onboarding/page.tsx"), "utf8");
    const subscription = readFileSync(path.join(root, "app/dashboard/subscription/page.tsx"), "utf8");
    expect(onboarding).toContain("prisma.planConfig.findMany({ where: { isActive: true }");
    expect(subscription).toContain("prisma.planConfig.findMany({ where: { isActive: true }");
    for (const source of [onboarding, subscription]) expect(source).not.toMatch(/key:\s*"(ANNUAL|MONTHLY)"/);
  });

  it("checkout derives the charge from the stored PlanConfig row, never the browser", () => {
    const checkout = readFileSync(path.join(root, "app/api/checkout/route.ts"), "utf8");
    expect(checkout).toContain("prisma.planConfig.findUnique({ where: { id: planId } })");
    expect(checkout).toContain("toKobo(plan.priceKES)");
    expect(checkout).not.toContain("body.amount");
    expect(checkout).not.toContain("body.priceKES");
  });

  it("keeps the seed's canonical rows aligned with the shared catalogue", () => {
    const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");
    for (const plan of CANONICAL_PLANS) {
      expect(seed).toContain(`key: "${plan.key}"`);
      expect(seed).toContain(`priceKES: ${plan.priceKES}`);
      expect(seed).toContain(`durationDays: ${plan.durationDays}`);
    }
    expect(seed).toContain("isActive: true");
  });
});
