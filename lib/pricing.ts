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
export const FALLBACK_PLANS: Omit<Plan, "id">[] = [
  { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
];
