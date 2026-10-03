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
 * Plans that may never be advertised on a public or customer-facing surface (POS spec §67).
 *
 * The Business POS is the owner's operating system — PUBLIC means "customer interaction",
 * PRIVATE means "business operating system". A customer browsing a business page, a referral
 * redirect or a call instruction must never be shown an operating-system price list, so the
 * POS plan is sold only from inside the authenticated POS workspace.
 */
export const PRIVATE_PLAN_KEYS = ["BUSINESS_POS"];

export function isPubliclyListedPlan(key: string): boolean {
  return !PRIVATE_PLAN_KEYS.includes(key);
}

/** Filters a plan list down to what a public/customer-facing surface may show (§67). */
export function publiclyListedPlans<T extends Record<string, any>>(plans: T[]): T[] {
  return plans.filter((plan) => isPubliclyListedPlan(plan.key));
}

export async function getPlanByKey(key: string): Promise<Plan | null> {
  return (await prisma.planConfig?.findUnique?.({ where: { key } })) ?? null;
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
  { key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  // Private plan: never listed publicly (§67) — see PRIVATE_PLAN_KEYS.
  { key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
];
