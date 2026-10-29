/**
 * Production catalogue visibility — the verified 2026-10-29 rows.
 *
 * The production `PlanConfig` query returned eight active rows. The public/payable list must be
 * exactly the four page products; the advertising grid must carry those four plus the Business
 * POS, JATA BOS PRO (ERP_PRO) and the standard Autopilot — the seven customer offers, exactly
 * once each. Pro, Enterprise, POS, ERP and Autopilot are private workspace products and must
 * never appear in onboarding or the AFTERCALL subscription payable list.
 *
 * Regression guard for ERP: before this change `ERP_PRO` was absent from `PRIVATE_PLAN_KEYS`, so
 * creating its plan row (the documented production repair) would have inserted POS / ERP - PRO
 * into the public plan picker on `/onboarding` and `/dashboard/subscription`. The row does not
 * exist yet, which is why the leak was latent rather than visible.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERP_PRO_FALLBACK_CARD,
  FALLBACK_PLANS,
  HOMEPAGE_PLAN_ORDER,
  homepagePlanCards,
  PRIVATE_PLAN_KEYS,
  planDisplayName,
  publiclyListedPlans,
} from "@/lib/pricing";

const root = path.resolve(__dirname, "../..");

/** The eight rows the owner's production query returned, all active. */
const PRODUCTION_ROWS = [
  { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  { key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30, isActive: true },
  { key: "JATA_AUTOPILOT_PRO", name: "JATA Autopilot Pro — KES 6,999/month", priceKES: 6999, durationDays: 30, isActive: true },
  { key: "JATA_AUTOPILOT_ENTERPRISE", name: "JATA Autopilot Enterprise — KES 19,999/month", priceKES: 19999, durationDays: 30, isActive: true },
];

/** The proposed ERP/Oro row. Not in production yet. */
const ERP_ROW = { key: "ERP_PRO", name: "POS / ERP - PRO", priceKES: 3000, durationDays: 30, isActive: true };

describe("public plan catalogue with the verified production rows", () => {
  it("offers exactly the four page products to public/payable surfaces", () => {
    expect(publiclyListedPlans(PRODUCTION_ROWS).map((plan) => plan.key)).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
    ]);
  });

  it("advertises seven cards in the owner order, including POS, BOS PRO and standard Autopilot", () => {
    const cards = homepagePlanCards(PRODUCTION_ROWS);
    expect(cards.map((card) => card.key)).toEqual([...HOMEPAGE_PLAN_ORDER]);
    // The BOS PRO slot carries the documented KES 3,000 / 30 days fallback here because the
    // production inventory has no ERP_PRO row yet; every other card is the stored value.
    expect(cards.map((card) => card.priceKES)).toEqual([149, 999, 499, 999, 499, 3000, 2499]);
    expect(cards.map((card) => card.durationDays)).toEqual([30, 365, 30, 30, 30, 30, 30]);
  });

  it("keeps Pro and Enterprise off every public card while leaving them private", () => {
    expect(homepagePlanCards(PRODUCTION_ROWS).map((card) => card.key)).not.toContain("JATA_AUTOPILOT_PRO");
    expect(homepagePlanCards(PRODUCTION_ROWS).map((card) => card.key)).not.toContain("JATA_AUTOPILOT_ENTERPRISE");
    expect(PRIVATE_PLAN_KEYS).toEqual(expect.arrayContaining(["JATA_AUTOPILOT_PRO", "JATA_AUTOPILOT_ENTERPRISE"]));
  });

  it("brands INTERACTIVE_BUSINESS as Website Studio regardless of the stored name", () => {
    expect(planDisplayName(PRODUCTION_ROWS[3])).toBe("Website Studio — KES 999/month");
  });
});

describe("ERP (JATA BOS PRO) visibility", () => {
  it("is private, so creating its row cannot add it to onboarding or the payable subscription list", () => {
    expect(PRIVATE_PLAN_KEYS).toContain("ERP_PRO");
    expect(publiclyListedPlans([...PRODUCTION_ROWS, ERP_ROW])).toHaveLength(4);
    expect(publiclyListedPlans([ERP_ROW])).toEqual([]);
  });

  it("appears exactly once on the advertising grid as a marketing card, with the stored price preferred", () => {
    // Publicly listed (payable) surfaces still never see it…
    expect(publiclyListedPlans([...PRODUCTION_ROWS, ERP_ROW]).map((plan) => plan.key)).not.toContain("ERP_PRO");
    // …but the marketing grid shows it exactly once, in its fixed slot, priced from the stored row.
    const cards = homepagePlanCards([...PRODUCTION_ROWS, ERP_ROW]);
    expect(cards.map((card) => card.key)).toEqual([...HOMEPAGE_PLAN_ORDER]);
    const erpCards = cards.filter((card) => card.key === "ERP_PRO");
    expect(erpCards).toHaveLength(1);
    expect(erpCards[0]).toMatchObject({ priceKES: 3000, durationDays: 30 });
    // A stored row with an operator-edited price is shown as stored — never silently overwritten.
    const repriced = homepagePlanCards([...PRODUCTION_ROWS, { ...ERP_ROW, priceKES: 2500 }]);
    expect(repriced.find((card) => card.key === "ERP_PRO")).toMatchObject({ priceKES: 2500 });
  });

  it("has no canonical FALLBACK_PLANS row, so a missing PlanConfig row cannot be faked into checkout", () => {
    // The documented KES 3,000 / 30 days fallback lives only in the marketing constant
    // (`ERP_PRO_FALLBACK_CARD`), which feeds `homepagePlanCards()` and nothing money-adjacent.
    expect(FALLBACK_PLANS.some((plan) => plan.key === "ERP_PRO")).toBe(false);
    expect(ERP_PRO_FALLBACK_CARD).toMatchObject({ key: "ERP_PRO", priceKES: 3000, durationDays: 30 });
  });
});

describe("catalogue bootstrap (prisma/seed.ts)", () => {
  const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");

  it("provisions every canonical product plan, including JATA BOS PRO (ERP_PRO)", () => {
    for (const key of [...PRODUCTION_ROWS.map((plan) => plan.key), "ERP_PRO"]) {
      expect(seed, key).toContain(`key: "${key}"`);
    }
    expect(seed).toContain('key: "ERP_PRO", name: "JATA BOS PRO — Business Operating System Pro", priceKES: 3000, durationDays: 30');
  });

  it("keeps the seed upsert reactivating rows rather than leaving them inactive", () => {
    const upsertLine = seed.split("\n").find((line) => line.includes("planConfig.upsert")) || "";
    expect(upsertLine).toContain("isActive: true");
  });
});
