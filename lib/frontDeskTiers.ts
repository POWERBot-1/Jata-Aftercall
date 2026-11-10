/**
 * AI Front Desk 2.0 — the four-tier package family (§41.1).
 *
 * Pure constants and guards with no database or framework imports, so the catalogue, the
 * checkout route, the entitlement engine and the settlement path all resolve the same
 * authoritative key→price map without import cycles.
 *
 * Migration rule (Option A, `docs/commercial/03_LEGACY_MAPPING_AND_IMPACT.md`): the legacy
 * `AI_BUSINESS_FRONT_DESK` key IS the Starter tier. Existing `Subscription.planId`,
 * `AIPackageEntitlement.packageKey` and `Payment.planId` values therefore remain valid without
 * any customer-row mutation — the catalogue is extended, never rewritten.
 *
 * Every price here is the approved target price (KES 499 / 999 / 1,999 / 3,999, each 30 days).
 * These constants are assertions and display fallbacks only: the amount charged always comes
 * from the stored `PlanConfig` row (see `assertFrontDeskTierPricing` and the checkout route).
 */

export const AI_FRONT_DESK_STARTER_KEY = "AI_BUSINESS_FRONT_DESK";
export const AI_FRONT_DESK_STANDARD_KEY = "AI_FRONT_DESK_STANDARD";
export const AI_FRONT_DESK_PRO_KEY = "AI_FRONT_DESK_PRO";
export const AI_FRONT_DESK_VOICE_KEY = "AI_FRONT_DESK_VOICE";

/** Every key that grants the AI Front Desk entitlement family, cheapest first. */
export const FRONT_DESK_TIER_KEYS = [
  AI_FRONT_DESK_STARTER_KEY,
  AI_FRONT_DESK_STANDARD_KEY,
  AI_FRONT_DESK_PRO_KEY,
  AI_FRONT_DESK_VOICE_KEY,
] as const;

export type FrontDeskTierKey = (typeof FRONT_DESK_TIER_KEYS)[number];

export type FrontDeskTierPricing = {
  key: FrontDeskTierKey;
  /** Canonical customer-facing package name (§41.1). */
  name: string;
  priceKES: number;
  durationDays: number;
};

/** Authoritative approved prices for the four-tier catalogue. */
export const FRONT_DESK_TIER_PRICING: Record<FrontDeskTierKey, FrontDeskTierPricing> = {
  [AI_FRONT_DESK_STARTER_KEY]: {
    key: AI_FRONT_DESK_STARTER_KEY,
    name: "Front Desk Starter — KES 499/month",
    priceKES: 499,
    durationDays: 30,
  },
  [AI_FRONT_DESK_STANDARD_KEY]: {
    key: AI_FRONT_DESK_STANDARD_KEY,
    name: "Front Desk Standard — KES 999/month",
    priceKES: 999,
    durationDays: 30,
  },
  [AI_FRONT_DESK_PRO_KEY]: {
    key: AI_FRONT_DESK_PRO_KEY,
    name: "Front Desk Pro — KES 1,999/month",
    priceKES: 1999,
    durationDays: 30,
  },
  [AI_FRONT_DESK_VOICE_KEY]: {
    key: AI_FRONT_DESK_VOICE_KEY,
    name: "Front Desk Voice — KES 3,999/month",
    priceKES: 3999,
    durationDays: 30,
  },
};

/** Type guard: is this stored key one of the four Front Desk tiers? */
export function isFrontDeskTierKey(key: unknown): key is FrontDeskTierKey {
  return typeof key === "string" && (FRONT_DESK_TIER_KEYS as readonly string[]).includes(key);
}

/** Pricing for a tier key, or null when the key is not in the family. */
export function frontDeskTierPricing(key: unknown): FrontDeskTierPricing | null {
  return isFrontDeskTierKey(key) ? FRONT_DESK_TIER_PRICING[key] : null;
}

/** The entitlement family's shared billing period (all four tiers are 30 days). */
export const FRONT_DESK_TIER_DURATION_DAYS = 30;

/**
 * Server-side pricing invariant for any Front Desk tier, mirroring `assertAIFrontDeskPricing`.
 * A stored row whose key is in the family must carry exactly the approved price and period,
 * or checkout fails closed with `PLAN_PRICING_INVALID`. Returns a result object (never throws)
 * so route code can map it onto its own error contract.
 */
export function assertFrontDeskTierPricing(plan: {
  key: string;
  priceKES?: number;
  priceKes?: number;
  durationDays: number;
}): { ok: boolean; error?: string } {
  const expected = frontDeskTierPricing(plan.key);
  if (!expected) return { ok: false, error: `Expected a Front Desk tier key (got ${plan.key})` };
  const resolvedPrice = Number(plan.priceKES ?? plan.priceKes ?? 0);
  if (resolvedPrice !== expected.priceKES || plan.durationDays !== expected.durationDays) {
    return {
      ok: false,
      error: `${expected.name} must resolve to KES ${expected.priceKES} / ${expected.durationDays} days (got ${resolvedPrice}/${plan.durationDays})`,
    };
  }
  return { ok: true };
}
