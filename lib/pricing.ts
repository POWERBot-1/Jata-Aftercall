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

export async function getPlanByKey(key: string): Promise<Plan | null> {
  return prisma.planConfig.findUnique({ where: { key } });
}

export async function getPlanById(id: string): Promise<Plan | null> {
  return prisma.planConfig.findUnique({ where: { id } });
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

export const FALLBACK_PLANS: Omit<Plan, "id">[] = [
  { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
];
