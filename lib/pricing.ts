import prisma from "./db";

// Pricing is DB-driven (§16, §32, §39) — never scattered hardcodes.
// This helper centralizes plan retrieval so payable amount is always server-derived.

export type Plan = {
  id: string;
  key: string;
  name: string;
  priceKES: number;
  durationDays: number;
  isActive: boolean;
};

export async function getActivePlans(): Promise<Plan[]> {
  return prisma.planConfig.findMany({
    where: { isActive: true },
    orderBy: { priceKES: "asc" },
  });
}

/**
 * Plans that may never be selected, priced or sold from a public or customer-facing list
 * (POS spec §67).
 *
 * The Business POS is the owner's operating system — PUBLIC means "customer interaction",
 * PRIVATE means "business operating system". A customer browsing a business page, a referral
 * redirect or a call instruction must never be shown an operating-system price list, so the
 * POS plan is never part of a payable plan list: onboarding, the AFTERCALL subscription screen
 * and checkout all resolve their choices through `publiclyListedPlans()`.
 *
 * The one presentation exception is the marketing grids (homepage, public pricing, products and
 * the subscription page's full-catalogue section), which show the owner-only products as
 * clearly-labelled cards that link to their own product pages or authenticated workspaces
 * (2026-10-29 owner order; see `homepagePlanCards`). Showing those cards grants nothing: each
 * product still switches on only from PlanConfig and confirmed payment inside its own workspace.
 *
 * JATA BOS PRO (`ERP_PRO`, formerly "POS / ERP - PRO") is private for the same reason: its
 * purchase and entitlement live only in the authenticated `/dashboard/erp` workspace, and only
 * when the deployment has switched the product on (`ERP_PRO_ENABLED`). Its public marketing card
 * (`ERP_PRO_FALLBACK_CARD` slot in `homepagePlanCards`, the `/products/erp-pro` detail page) is
 * presentation only — it is never a payable choice on onboarding, the AFTERCALL subscription
 * screen or any checkout selection, and it is never routed through the ordinary business-page
 * checkout.
 */
export const PRIVATE_PLAN_KEYS = [
  "BUSINESS_POS",
  "JATA_AUTOPILOT",
  "JATA_AUTOPILOT_PRO",
  "JATA_AUTOPILOT_ENTERPRISE",
  // JATA BOS PRO (internal key ERP_PRO) is an authenticated, feature-flagged product too. It has
  // its own workspace and its own purchase flow, so it must never appear in onboarding or the
  // AFTERCALL subscription payable list merely because an operator (or the seed) has created its
  // PlanConfig row.
  "ERP_PRO",
];

export function isPubliclyListedPlan(key: string): boolean {
  return !PRIVATE_PLAN_KEYS.includes(key);
}

/** Filters a plan list down to what a public/customer-facing surface may show (§67). */
export function publiclyListedPlans<T extends Record<string, any>>(plans: T[]): T[] {
  return plans.filter((plan) => isPubliclyListedPlan(plan.key));
}

/**
 * Marketing order only; never changes stored IDs, prices, durations or checkout selection.
 *
 * Owner-mandated homepage sequence (2026-10-29, mobile-first): JATA Monthly → JATA Annual →
 * AI Business Front Desk → Website Studio (INTERACTIVE_BUSINESS) → Business POS → JATA BOS PRO
 * (`ERP_PRO`) → JATA Autopilot. The owner-only products keep their stored plan keys and their own
 * CTAs; only the presentation rank moves. This exact sequence is the mobile reading order too:
 * the pricing grid is a single column on phones, so DOM order is visual order.
 */
export const HOMEPAGE_PLAN_ORDER = ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS", "BUSINESS_POS", "ERP_PRO", "JATA_AUTOPILOT"] as const;

/**
 * The owner-only POS plan the homepage advertises sixth (last card), without ever making it a
 * payable choice. A literal rather than an import: `lib/pos/entitlement.ts` imports this module,
 * so importing its `POS_PLAN_KEY` here would be a cycle. Both name the same stored key, and
 * `assertBusinessPosPricing`/`assertPosPlanPricing` still guard the price itself.
 */
export const HOMEPAGE_POS_PLAN_KEY = "BUSINESS_POS";

/**
 * The standard JATA Autopilot package the homepage advertises seventh (last card), without ever
 * making it a payable choice. A literal rather than an import for the same cycle reason as the POS
 * key above: it names the same stored key as `AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT` in
 * `lib/autopilot/entitlement.ts`, and `assertAutopilotPlanPricing` still guards the price itself
 * (KES 2,499 / 30 days) at checkout. Only the standard package is advertised here; the Pro and
 * Enterprise tiers stay inside the authenticated Autopilot flow and are never homepage cards.
 */
export const HOMEPAGE_AUTOPILOT_PLAN_KEY = "JATA_AUTOPILOT";

/**
 * JATA BOS PRO (internal key `ERP_PRO`) — the sixth homepage card. A literal for the same cycle
 * reason as the keys above: `lib/erp/access.ts` imports this module, so importing
 * `ERP_PLAN_KEY` from `lib/erp/entitlement.ts` here would be a cycle. Both name the same stored
 * key, and `assertErpPlanPricing` still guards the price itself (KES 3,000 / 30 days) in the
 * product's own purchase flow. The card is presentation only: `ERP_PRO` stays in
 * `PRIVATE_PLAN_KEYS`, so it is never a payable choice on onboarding, the AFTERCALL subscription
 * screen or checkout selection, and it is never routed through the ordinary business-page
 * checkout. Its public detail page is `/products/erp-pro`.
 */
export const HOMEPAGE_ERP_PRO_PLAN_KEY = "ERP_PRO";

export function orderHomepagePlans<T extends { key: string }>(plans: readonly T[]): T[] {
  const rank = (key: string) => {
    const index = (HOMEPAGE_PLAN_ORDER as readonly string[]).indexOf(key);
    return index < 0 ? HOMEPAGE_PLAN_ORDER.length : index;
  };
  return [...plans].sort((a, b) => rank(a.key) - rank(b.key));
}

/** Exactly the fields a homepage plan card renders. Nothing here is payable data. */
export type HomepagePlanCard = { key: string; name: string; priceKES: number; durationDays: number };

/**
 * The documented fallback for the JATA BOS PRO marketing card, used only when the stored
 * `PlanConfig` row is genuinely unavailable or inactive under the existing catalogue rules (the
 * marketing pages read `where: { isActive: true }`, so an inactive row reads as unavailable).
 * KES 3,000 / 30 days is the canonical commercial term (`ERP_PLAN_PRICE_KES` in
 * `lib/erp/entitlement.ts`, guarded by `assertErpPlanPricing` at purchase time). A valid stored
 * row always wins over this constant — the fallback is never allowed to overwrite a stored price.
 *
 * Deliberately outside `FALLBACK_PLANS`: that list feeds `getPlanConfig()`, and a missing
 * `ERP_PRO` row must stay missing for every money-adjacent resolver. This constant feeds the
 * marketing grid only.
 */
export const ERP_PRO_FALLBACK_CARD: HomepagePlanCard = {
  key: "ERP_PRO",
  name: "JATA BOS PRO",
  priceKES: 3000,
  durationDays: 30,
};

/**
 * The seven offers the homepage advertises, in marketing order.
 *
 * The four page plans come from `publiclyListedPlans()` as before; the three owner-only products
 * (Business POS fifth, JATA BOS PRO sixth, JATA Autopilot standard seventh) are appended as
 * presentation cards so a customer can discover the complete catalogue in one grid. This is
 * presentation only:
 *
 *   • POS, BOS PRO (`ERP_PRO`) and Autopilot stay in `PRIVATE_PLAN_KEYS`, so they are still
 *     absent from onboarding, the AFTERCALL subscription payable list and every checkout
 *     selection — the cards link to `/products/erp-pro`, `/dashboard/pos` and
 *     `/dashboard/autopilot`, never to `/register` or checkout. The Autopilot Pro/Enterprise
 *     tiers are never appended: only the standard package is advertised. BOS PRO appears exactly
 *     once, and showing it never grants workspace access.
 *   • Each owner-only card's price and duration are the stored `PlanConfig` row when it can be
 *     read, and only otherwise the canonical fallback rows (POS KES 499 / 30 days; BOS PRO
 *     KES 3,000 / 30 days via `ERP_PRO_FALLBACK_CARD`; Autopilot standard KES 2,499 / 30 days,
 *     guarded by `assertAutopilotPlanPricing`) — never a number written into the page, and never
 *     a hardcoded price silently replacing a valid stored one.
 *   • If a plan row is missing entirely the canonical row still fills its slot, so the grid is
 *     never left with a hole and never invents a different price.
 */
export function homepagePlanCards(plans: readonly HomepagePlanCard[]): HomepagePlanCard[] {
  const listed = publiclyListedPlans([...plans]);
  const storedPos = plans.find((plan) => plan.key === HOMEPAGE_POS_PLAN_KEY);
  const pos = storedPos ?? FALLBACK_PLANS.find((plan) => plan.key === HOMEPAGE_POS_PLAN_KEY);
  const storedAutopilot = plans.find((plan) => plan.key === HOMEPAGE_AUTOPILOT_PLAN_KEY);
  const autopilot = storedAutopilot ?? FALLBACK_PLANS.find((plan) => plan.key === HOMEPAGE_AUTOPILOT_PLAN_KEY);
  const storedErpPro = plans.find((plan) => plan.key === HOMEPAGE_ERP_PRO_PLAN_KEY);
  const erpPro = storedErpPro ?? ERP_PRO_FALLBACK_CARD;
  const cards: HomepagePlanCard[] = [...listed];
  if (pos && !cards.some((card) => card.key === HOMEPAGE_POS_PLAN_KEY)) cards.push(pos);
  if (erpPro && !cards.some((card) => card.key === HOMEPAGE_ERP_PRO_PLAN_KEY)) cards.push(erpPro);
  if (autopilot && !cards.some((card) => card.key === HOMEPAGE_AUTOPILOT_PLAN_KEY)) cards.push(autopilot);
  return orderHomepagePlans(cards);
}

/**
 * The name a customer-facing surface shows for a plan.
 *
 * The stored `PlanConfig.name` is operator-editable text. If it was ever written through a
 * client with the wrong encoding it holds U+FFFD ("�") — which is what the public
 * homepage was observed rendering for the AI Business Front Desk and Interactive Business cards.
 * A known plan then shows its canonical name instead of a corrupted or blank one; any other
 * stored name is shown exactly as the operator wrote it, except two stable product brands:
 * the Website Studio product (`INTERACTIVE_BUSINESS`) and JATA BOS PRO (`ERP_PRO`, formerly
 * "POS / ERP - PRO") always use their requested customer-facing names. Renaming BOS PRO happens
 * here at the display layer only — the internal plan ID `ERP_PRO` and every stored price stay
 * unchanged, and no stored row is migrated.
 */
export function planDisplayName(plan: { key: string; name?: string | null }): string {
  if (plan.key === "INTERACTIVE_BUSINESS") {
    return FALLBACK_PLANS.find((fallback) => fallback.key === plan.key)!.name;
  }
  if (plan.key === "ERP_PRO") {
    // The customer-facing product is JATA BOS PRO (subtitle: Business Operating System Pro);
    // the legacy stored name "POS / ERP - PRO" must never reach a customer-facing surface.
    return ERP_PRO_FALLBACK_CARD.name;
  }
  const stored = typeof plan.name === "string" ? plan.name.trim() : "";
  if (stored && !stored.includes("\uFFFD")) return stored;
  const canonical = FALLBACK_PLANS.find((fallback) => fallback.key === plan.key)?.name;
  if (canonical) return canonical;
  return stored.replace(/\uFFFD/g, "-") || plan.key;
}

export async function getPlanByKey(key: string): Promise<Plan | null> {
  // A database error reads as "no stored plan", so callers use the canonical fallback (as getPlanConfig does)
  // instead of failing the pricing lookup.
  const plan = await prisma.planConfig?.findUnique?.({ where: { key } }).catch(() => null);
  return plan ?? null;
}

export async function getPlanConfig(
  key: string,
): Promise<(Plan & { priceKes: number; label: string }) | null> {
  const fromDb = await prisma.planConfig?.findUnique?.({ where: { key } }).catch(() => null);
  const base =
    fromDb ||
    FALLBACK_PLANS.find((p) => p.key === key) ||
    null;
  if (!base) return null;
  const priceKES = Number((base as any).priceKES ?? (base as any).priceKes ?? 0);
  const name = String((base as any).name ?? (base as any).label ?? key);
  return {
    id: String((base as any).id || key),
    key: base.key,
    name,
    label: name,
    priceKES,
    priceKes: priceKES,
    durationDays: Number(base.durationDays || 30),
    isActive: base.isActive !== false,
  };
}

export async function getPlanById(id: string): Promise<Plan | null> {
  return (await prisma.planConfig?.findUnique?.({ where: { id } })) ?? null;
}

// Fallback constants used only if DB has not been seeded yet (e.g. during tests without DB)
/**
 * AI Business Front Desk package (§49) — authoritative server-derived price.
 * The amount must never come from the client; checkout must resolve from this config.
 */
export async function getAIBusinessFrontDeskPlan(): Promise<Plan | null> {
  return getPlanByKey("AI_BUSINESS_FRONT_DESK");
}

export function assertAIFrontDeskPricing(plan: Plan | null): asserts plan is Plan {
  if (!plan || plan.priceKES !== 499 || plan.durationDays !== 30) {
    throw new Error(`AI Business Front Desk pricing must resolve to KES 499 / 30 days (got ${plan?.priceKES ?? "null"}/${plan?.durationDays ?? "null"})`);
  }
}

/**
 * Interactive Business package (§59) — authoritative server-derived price.
 * Checkout resolves the amount from this plan config, never from the browser (§26).
 */
export async function getInteractiveBusinessPlan(): Promise<Plan | null> {
  return getPlanByKey("INTERACTIVE_BUSINESS");
}

export function assertInteractiveBusinessPricing(plan: Plan | null): asserts plan is Plan {
  if (!plan || plan.priceKES !== 999 || plan.durationDays !== 30) {
    throw new Error(`Interactive Business pricing must resolve to KES 999 / 30 days (got ${plan?.priceKES ?? "null"}/${plan?.durationDays ?? "null"})`);
  }
}

/**
 * JATA AFTERCALL — Business POS (POS spec §4, §45): KES 499/month, tied to the business.
 * The amount is always resolved from PlanConfig on the server; the browser never supplies it.
 */
export async function getBusinessPosPlan(): Promise<Plan | null> {
  return getPlanByKey("BUSINESS_POS");
}

export function assertBusinessPosPricing(plan: Plan | null): asserts plan is Plan {
  if (!plan || plan.priceKES !== 499 || plan.durationDays !== 30) {
    throw new Error(`Business POS pricing must resolve to KES 499 / 30 days (got ${plan?.priceKES ?? "null"}/${plan?.durationDays ?? "null"})`);
  }
}

export async function getJataAutopilotPlan(
  key: "JATA_AUTOPILOT" | "JATA_AUTOPILOT_PRO" | "JATA_AUTOPILOT_ENTERPRISE" = "JATA_AUTOPILOT",
): Promise<Plan | null> {
  return getPlanByKey(key);
}

export const FALLBACK_PLANS: Omit<Plan, "id">[] = [
  { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { key: "INTERACTIVE_BUSINESS", name: "Website Studio — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  // Private plans: never listed publicly (§67) — see PRIVATE_PLAN_KEYS.
  { key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30, isActive: true },
  { key: "JATA_AUTOPILOT_PRO", name: "JATA Autopilot Pro — KES 6,999/month", priceKES: 6999, durationDays: 30, isActive: true },
  { key: "JATA_AUTOPILOT_ENTERPRISE", name: "JATA Autopilot Enterprise — KES 19,999/month", priceKES: 19999, durationDays: 30, isActive: true },
];
