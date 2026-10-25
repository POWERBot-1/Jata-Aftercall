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
 * The one presentation exception is the homepage pricing grid, which shows the POS as a fifth,
 * clearly-labelled owner-only card that links into the authenticated `/dashboard/pos` flow (see
 * `homepagePlanCards`). Showing that card grants nothing: the POS still switches on only from
 * PlanConfig and confirmed payment inside the workspace.
 */
export const PRIVATE_PLAN_KEYS = ["BUSINESS_POS"];

export function isPubliclyListedPlan(key: string): boolean {
  return !PRIVATE_PLAN_KEYS.includes(key);
}

/** Filters a plan list down to what a public/customer-facing surface may show (§67). */
export function publiclyListedPlans<T extends Record<string, any>>(plans: T[]): T[] {
  return plans.filter((plan) => isPubliclyListedPlan(plan.key));
}

/** Marketing order only; never changes stored IDs, prices, durations or checkout selection. */
export const HOMEPAGE_PLAN_ORDER = ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS", "BUSINESS_POS"] as const;

/**
 * The owner-only plan the homepage advertises last, without ever making it a payable choice.
 * A literal rather than an import: `lib/pos/entitlement.ts` imports this module, so importing its
 * `POS_PLAN_KEY` here would be a cycle. Both name the same stored key, and
 * `assertBusinessPosPricing`/`assertPosPlanPricing` still guard the price itself.
 */
export const HOMEPAGE_POS_PLAN_KEY = "BUSINESS_POS";

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
 * The five plans the homepage advertises, in marketing order.
 *
 * The four page plans come from `publiclyListedPlans()` as before; the owner-only Business POS is
 * appended as the fifth card so an owner can see the whole product range in one grid instead of a
 * separate promotional block below it (owner request, 2026-10-25). This is presentation only:
 *
 *   • POS stays in `PRIVATE_PLAN_KEYS`, so it is still absent from onboarding, the AFTERCALL
 *     subscription screen and every payable list — the card links to `/dashboard/pos`, not to
 *     `/register` or checkout.
 *   • Its price and duration are the stored `PlanConfig` row when it can be read, and the
 *     canonical `FALLBACK_PLANS` row (KES 499 / 30 days) when the database is unavailable —
 *     never a number written into the page.
 *   • If the plan row is missing entirely the canonical row still fills the fifth slot, so the
 *     grid is never left with a hole and never invents a different price.
 */
export function homepagePlanCards(plans: readonly HomepagePlanCard[]): HomepagePlanCard[] {
  const listed = publiclyListedPlans([...plans]);
  const storedPos = plans.find((plan) => plan.key === HOMEPAGE_POS_PLAN_KEY);
  const pos = storedPos ?? FALLBACK_PLANS.find((plan) => plan.key === HOMEPAGE_POS_PLAN_KEY);
  const cards: HomepagePlanCard[] = [...listed];
  if (pos && !cards.some((card) => card.key === HOMEPAGE_POS_PLAN_KEY)) cards.push(pos);
  return orderHomepagePlans(cards);
}

/**
 * The name a customer-facing surface shows for a plan.
 *
 * The stored `PlanConfig.name` is operator-editable text. If it was ever written through a
 * client with the wrong encoding it holds U+FFFD ("�") — which is what the public
 * homepage was observed rendering for the AI Business Front Desk and Interactive Business cards.
 * A known plan then shows its canonical name instead of a corrupted or blank one; any other
 * stored name is shown exactly as the operator wrote it, except the Website Studio product
 * whose stable INTERACTIVE_BUSINESS key always uses the requested customer-facing brand.
 */
export function planDisplayName(plan: { key: string; name?: string | null }): string {
  if (plan.key === "INTERACTIVE_BUSINESS") {
    return FALLBACK_PLANS.find((fallback) => fallback.key === plan.key)!.name;
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

export const FALLBACK_PLANS: Omit<Plan, "id">[] = [
  { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { key: "INTERACTIVE_BUSINESS", name: "Website Studio — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  // Private plan: never listed publicly (§67) — see PRIVATE_PLAN_KEYS.
  { key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
];
