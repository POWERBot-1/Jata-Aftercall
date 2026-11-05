/**
 * AI Front Desk 2.0 — four-tier catalogue, entitlement family and migration-safety pins (§41).
 *
 * What this suite establishes:
 *   • The authoritative family is exactly four keys at 499 / 999 / 1,999 / 3,999, each 30 days.
 *   • The Starter tier reuses the legacy `AI_BUSINESS_FRONT_DESK` key, so no existing customer
 *     row (Subscription / AIPackageEntitlement / Payment) can be invalidated by the extension.
 *   • Marketing order keeps the owner's seven-card sequence untouched and slots the three new
 *     tiers immediately after the Starter card.
 *   • Every customer-facing copy map carries an entry for all four tiers (no blank cards).
 *   • Checkout asserts the approved price server-side for any tier and refuses non-tier keys.
 *   • The entitlement engine grants exactly the family, denies every other plan key, reflects
 *     the tier's price in status output, and `syncAIPackageEntitlement` never force-writes the
 *   Starter key onto a higher-tier customer.
 *   • The seed provisions all four rows with the approved prices.
 *
 * Nothing here writes production data; the production catalogue change is a separate,
 * approval-gated script (`scripts/commercial/01_extend_front_desk_catalogue.sql`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_FRONT_DESK_STARTER_KEY,
  FRONT_DESK_TIER_KEYS,
  FRONT_DESK_TIER_PRICING,
  assertFrontDeskTierPricing,
  frontDeskTierPricing,
  isFrontDeskTierKey,
} from "@/lib/frontDeskTiers";
import {
  FALLBACK_PLANS,
  HOMEPAGE_PLAN_ORDER,
  PRIVATE_PLAN_KEYS,
  orderHomepagePlans,
} from "@/lib/pricing";
import { deriveAIEntitlement } from "@/lib/ai-entitlement";
import { PLAN_BADGES, PLAN_ICONS, PLAN_INCLUDES } from "@/lib/landing";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const APPROVED_PRICES: Record<string, number> = {
  AI_BUSINESS_FRONT_DESK: 499,
  AI_FRONT_DESK_STANDARD: 999,
  AI_FRONT_DESK_PRO: 1999,
  AI_FRONT_DESK_VOICE: 3999,
};

const daysFromNow = (days: number) => new Date(Date.now() + days * 86400000);

describe("four-tier catalogue (§41.1)", () => {
  it("defines exactly the four approved keys, cheapest first", () => {
    expect([...FRONT_DESK_TIER_KEYS]).toEqual([
      "AI_BUSINESS_FRONT_DESK",
      "AI_FRONT_DESK_STANDARD",
      "AI_FRONT_DESK_PRO",
      "AI_FRONT_DESK_VOICE",
    ]);
    const prices = FRONT_DESK_TIER_KEYS.map((key) => FRONT_DESK_TIER_PRICING[key].priceKES);
    expect(prices).toEqual([499, 999, 1999, 3999]);
    for (const key of FRONT_DESK_TIER_KEYS) {
      expect(FRONT_DESK_TIER_PRICING[key].durationDays, key).toBe(30);
    }
  });

  it("reuses the legacy key for Starter — existing customer rows need no mutation (Option A)", () => {
    expect(AI_FRONT_DESK_STARTER_KEY).toBe("AI_BUSINESS_FRONT_DESK");
    expect(FRONT_DESK_TIER_PRICING[AI_FRONT_DESK_STARTER_KEY].priceKES).toBe(499);
    // The legacy key must NOT be renamed anywhere identifier-shaped: only display copy changes.
    expect(FALLBACK_PLANS.find((p) => p.key === "AI_BUSINESS_FRONT_DESK")).toMatchObject({
      priceKES: 499,
      durationDays: 30,
      isActive: true,
    });
  });

  it("keeps Starter in FALLBACK_PLANS and the three newer tiers strictly DB-authoritative", () => {
    // Starter keeps its legacy fallback row (existing behaviour, existing customers).
    const starter = FALLBACK_PLANS.find((p) => p.key === "AI_BUSINESS_FRONT_DESK");
    expect(starter).toMatchObject({ priceKES: 499, durationDays: 30, isActive: true });
    // The three newer tiers are advertised and sold only when their stored row exists —
    // never from a marketing fallback (§41.5). Their approved prices are asserted from
    // FRONT_DESK_TIER_PRICING instead.
    for (const key of ["AI_FRONT_DESK_STANDARD", "AI_FRONT_DESK_PRO", "AI_FRONT_DESK_VOICE"]) {
      expect(FALLBACK_PLANS.some((p) => p.key === key), key).toBe(false);
      expect(FRONT_DESK_TIER_PRICING[key as keyof typeof FRONT_DESK_TIER_PRICING].priceKES).toBe(APPROVED_PRICES[key]);
    }
    // All four keys remain publicly listable — none may ever become a private plan.
    for (const key of FRONT_DESK_TIER_KEYS) {
      expect(PRIVATE_PLAN_KEYS, key).not.toContain(key);
    }
  });

  it("accepts only family keys", () => {
    for (const key of FRONT_DESK_TIER_KEYS) expect(isFrontDeskTierKey(key), key).toBe(true);
    for (const key of ["MONTHLY", "ANNUAL", "INTERACTIVE_BUSINESS", "BUSINESS_POS", "ERP_PRO", "JATA_AUTOPILOT", "", null, undefined, 42]) {
      expect(isFrontDeskTierKey(key), String(key)).toBe(false);
    }
    expect(frontDeskTierPricing("AI_FRONT_DESK_PRO")?.priceKES).toBe(1999);
    expect(frontDeskTierPricing("MONTHLY")).toBeNull();
  });

  it("asserts the approved price for every tier and fails closed otherwise", () => {
    for (const key of FRONT_DESK_TIER_KEYS) {
      const ok = assertFrontDeskTierPricing({ key, priceKES: APPROVED_PRICES[key], durationDays: 30 });
      expect(ok.ok, key).toBe(true);
      const wrongPrice = assertFrontDeskTierPricing({ key, priceKES: 1, durationDays: 30 });
      expect(wrongPrice.ok, key).toBe(false);
      const wrongDuration = assertFrontDeskTierPricing({ key, priceKES: APPROVED_PRICES[key], durationDays: 365 });
      expect(wrongDuration.ok, key).toBe(false);
    }
    expect(assertFrontDeskTierPricing({ key: "MONTHLY", priceKES: 149, durationDays: 30 }).ok).toBe(false);
  });
});

describe("marketing order (§41.5 consistency)", () => {
  it("keeps the owner's seven-card HOMEPAGE_PLAN_ORDER byte-identical", () => {
    expect([...HOMEPAGE_PLAN_ORDER]).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
      "ERP_PRO",
      "JATA_AUTOPILOT",
    ]);
  });

  it("slots Standard/Pro/Voice immediately after Starter and before Website Studio", () => {
    const input = [
      { key: "JATA_AUTOPILOT" },
      { key: "INTERACTIVE_BUSINESS" },
      { key: "AI_FRONT_DESK_VOICE" },
      { key: "AI_FRONT_DESK_STANDARD" },
      { key: "ANNUAL" },
      { key: "AI_FRONT_DESK_PRO" },
      { key: "AI_BUSINESS_FRONT_DESK" },
      { key: "MONTHLY" },
    ];
    expect(orderHomepagePlans(input).map((p) => p.key)).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "AI_FRONT_DESK_STANDARD",
      "AI_FRONT_DESK_PRO",
      "AI_FRONT_DESK_VOICE",
      "INTERACTIVE_BUSINESS",
      "JATA_AUTOPILOT",
    ]);
  });

  it("every tier has customer-facing copy (scope, kind, description, includes, badge, icon)", () => {
    const pricing = read("app/pricing/page.tsx");
    const products = read("app/products/page.tsx");
    const subscription = read("app/dashboard/subscription/page.tsx");
    for (const key of FRONT_DESK_TIER_KEYS) {
      expect(PLAN_INCLUDES[key], key).toBeDefined();
      expect(PLAN_INCLUDES[key].length, key).toBeGreaterThan(0);
      expect(PLAN_BADGES[key], key).toBeTruthy();
      expect(PLAN_ICONS[key], key).toBe("bot");
      expect(pricing, key).toContain(`${key}:`);
      expect(products, key).toContain(`${key}:`);
      expect(subscription, key).toContain(`${key}:`);
    }
    // The products index drops any card without PRODUCT_DETAIL — the tiers must all have one.
    expect(products).toContain("AI_FRONT_DESK_STANDARD: {");
    expect(products).toContain("AI_FRONT_DESK_PRO: {");
    expect(products).toContain("AI_FRONT_DESK_VOICE: {");
  });
});

describe("checkout & settlement (§41.5, §41.6)", () => {
  const checkout = read("app/api/checkout/route.ts");
  const paystack = read("lib/paystack.ts");

  it("checkout validates the tier price server-side through the shared guard", () => {
    expect(checkout).toContain("isFrontDeskTierKey(plan.key)");
    expect(checkout).toContain("assertFrontDeskTierPricing(plan)");
    expect(checkout).toContain("PLAN_PRICING_INVALID");
    // Amount still comes only from the stored plan row — never from the browser.
    expect(checkout).toContain("toKobo(plan.priceKES)");
  });

  it("settlement activates the entitlement for any tier, stamped with the purchased key", () => {
    expect(paystack).toContain("isFrontDeskTierKey(plan.key)");
    expect(paystack).toContain("packageKey: plan.key");
    // No hardcoded Starter key remains in the entitlement write path.
    expect(paystack).not.toContain('packageKey: "AI_BUSINESS_FRONT_DESK"');
  });
});

describe("entitlement engine (§41.4)", () => {
  const future = daysFromNow(20);

  it("grants ACTIVE entitlement for a paid Standard-tier subscription at the tier price", () => {
    const result = deriveAIEntitlement({
      subscription: { status: "ACTIVE", plan: { key: "AI_FRONT_DESK_STANDARD" }, expiresAt: future },
      planKey: "AI_FRONT_DESK_STANDARD",
    });
    expect(result.entitled).toBe(true);
    expect(result.active).toBe(true);
    expect(result.status).toBe("ACTIVE");
    expect(result.packageKey).toBe("AI_FRONT_DESK_STANDARD");
    expect(result.priceKES).toBe(999);
    expect(result.billingCycleDays).toBe(30);
  });

  it("grants Pro and Voice tiers at their own prices, and Starter at 499", () => {
    for (const [key, price] of Object.entries(APPROVED_PRICES)) {
      const result = deriveAIEntitlement({
        subscription: { status: "ACTIVE", plan: { key }, expiresAt: future },
        planKey: key,
      });
      expect(result.entitled, key).toBe(true);
      expect(result.packageKey, key).toBe(key);
      expect(result.priceKES, key).toBe(price);
    }
  });

  it("denies every non-Front-Desk plan key (plan-substitution bypass stays closed)", () => {
    for (const key of ["MONTHLY", "ANNUAL", "INTERACTIVE_BUSINESS", "BUSINESS_POS", "JATA_AUTOPILOT"]) {
      const result = deriveAIEntitlement({
        subscription: { status: "ACTIVE", plan: { key }, expiresAt: future },
        planKey: key,
      });
      expect(result.entitled, key).toBe(false);
      expect(result.status, key).toBe("NONE");
    }
  });

  it("denies an expired tier window and keeps historical access", () => {
    const result = deriveAIEntitlement({
      subscription: { status: "ACTIVE", plan: { key: "AI_FRONT_DESK_PRO" }, expiresAt: daysFromNow(-1) },
      planKey: "AI_FRONT_DESK_PRO",
    });
    expect(result.entitled).toBe(false);
    expect(result.status).toBe("EXPIRED");
    expect(result.historicalAccessAllowed).toBe(true);
    expect(result.packageKey).toBe("AI_FRONT_DESK_PRO");
  });

  it("an ACTIVE entitlement row alone grants its own tier (no subscription row yet)", () => {
    const result = deriveAIEntitlement({
      entitlement: { status: "ACTIVE", packageKey: "AI_FRONT_DESK_VOICE", expiresAt: future },
      planKey: "AI_FRONT_DESK_VOICE",
    });
    expect(result.entitled).toBe(true);
    expect(result.packageKey).toBe("AI_FRONT_DESK_VOICE");
    expect(result.priceKES).toBe(3999);
  });
});

describe("seed bootstrap (prisma/seed.ts)", () => {
  const seed = read("prisma/seed.ts");

  it("provisions all four tiers with the approved prices", () => {
    for (const [key, price] of Object.entries(APPROVED_PRICES)) {
      expect(seed, key).toContain(`key: "${key}"`);
    }
    expect(seed).toContain('key: "AI_FRONT_DESK_STANDARD", name: "Front Desk Standard — KES 999/month", priceKES: 999, durationDays: 30');
    expect(seed).toContain('key: "AI_FRONT_DESK_PRO", name: "Front Desk Pro — KES 1,999/month", priceKES: 1999, durationDays: 30');
    expect(seed).toContain('key: "AI_FRONT_DESK_VOICE", name: "Front Desk Voice — KES 3,999/month", priceKES: 3999, durationDays: 30');
    expect(seed).toContain('key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30');
  });
});
