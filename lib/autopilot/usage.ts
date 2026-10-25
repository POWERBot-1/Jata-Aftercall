/**
 * JATA Autopilot — Usage Metering, Tier Allowances & Spend Circuit Breaker (§12)
 *
 * Separates variable AI/messaging costs from fixed SaaS billing so no runaway
 * loop, abusive upload, or noisy trigger can bankrupt a tenant or platform margin.
 */

import prisma from "@/lib/db";
import type { AutopilotTier, AutopilotUsageCapability } from "./types";

export interface AutopilotQuotaAllowances {
  LLM_REASONING: number;
  VISION_EXTRACT: number;
  VOICE_STT: number;
  VOICE_TTS: number;
  OUTBOUND_MSG: number;
  WORKFLOW_STEP: number;
  monthlyIncludedSpendCapMinorKES: number;
}

export const QUOTA_BY_AUTOPILOT_TIER: Record<AutopilotTier | "PREVIEW", AutopilotQuotaAllowances> = {
  PREVIEW: {
    LLM_REASONING: 15,
    VISION_EXTRACT: 3,
    VOICE_STT: 3,
    VOICE_TTS: 0,
    OUTBOUND_MSG: 0,
    WORKFLOW_STEP: 5,
    monthlyIncludedSpendCapMinorKES: 5_000, // KES 50 preview ceiling
  },
  STANDARD: {
    LLM_REASONING: 300,
    VISION_EXTRACT: 40,
    VOICE_STT: 60,
    VOICE_TTS: 30,
    OUTBOUND_MSG: 250,
    WORKFLOW_STEP: 500,
    monthlyIncludedSpendCapMinorKES: 65_000, // KES 650 (~26% COGS ceiling on KES 2,499)
  },
  PRO: {
    LLM_REASONING: 1_200,
    VISION_EXTRACT: 160,
    VOICE_STT: 240,
    VOICE_TTS: 120,
    OUTBOUND_MSG: 1_000,
    WORKFLOW_STEP: 2_500,
    monthlyIncludedSpendCapMinorKES: 200_000, // KES 2,000 (~28.5% COGS ceiling on KES 6,999)
  },
  ENTERPRISE: {
    LLM_REASONING: 5_000,
    VISION_EXTRACT: 700,
    VOICE_STT: 1_000,
    VOICE_TTS: 500,
    OUTBOUND_MSG: 5_000,
    WORKFLOW_STEP: 10_000,
    monthlyIncludedSpendCapMinorKES: 650_000, // KES 6,500 (~32.5% COGS ceiling on KES 19,999)
  },
};

/** Conservative unit-cost estimates in minor KES (cents: 100 minor = KES 1.00). */
export const ESTIMATED_MINOR_KES_PER_CALL: Record<AutopilotUsageCapability, number> = {
  LLM_REASONING: 80, // KES 0.80
  VISION_EXTRACT: 250, // KES 2.50
  VOICE_STT: 150, // KES 1.50
  VOICE_TTS: 200, // KES 2.00
  OUTBOUND_MSG: 120, // KES 1.20
  WORKFLOW_STEP: 10, // KES 0.10
};

export function currentPeriodAndDayKeys(now: Date = new Date()): {
  periodKey: string;
  dayKey: string;
} {
  // Anchor period/day keys to East Africa Time (UTC+3) so daily caps reset at Nairobi midnight.
  const nairobiMs = now.getTime() + 3 * 3_600_000;
  const iso = new Date(nairobiMs).toISOString();
  return {
    periodKey: iso.slice(0, 7),
    dayKey: iso.slice(0, 10),
  };
}

export interface UsageBudgetSummary {
  periodKey: string;
  dayKey: string;
  tierKey: AutopilotTier | "PREVIEW";
  dailySpendMinorKES: number;
  dailySpendCapMinorKES: number;
  monthlySpendMinorKES: number;
  monthlySpendCapMinorKES: number;
  capabilityUsedThisMonth: Record<AutopilotUsageCapability, number>;
  capabilityLimits: AutopilotQuotaAllowances;
}

export async function getAutopilotUsageSummary(params: {
  businessId: string;
  tierKey: AutopilotTier | "PREVIEW";
  dailySpendCapMinorKES?: number;
  now?: Date;
}): Promise<UsageBudgetSummary> {
  const { periodKey, dayKey } = currentPeriodAndDayKeys(params.now);
  const limits = QUOTA_BY_AUTOPILOT_TIER[params.tierKey];
  const dailySpendCapMinorKES = params.dailySpendCapMinorKES ?? 25_000;

  const used: Record<AutopilotUsageCapability, number> = {
    LLM_REASONING: 0,
    VISION_EXTRACT: 0,
    VOICE_STT: 0,
    VOICE_TTS: 0,
    OUTBOUND_MSG: 0,
    WORKFLOW_STEP: 0,
  };
  let monthlySpendMinorKES = 0;
  let dailySpendMinorKES = 0;

  try {
    const rows = await prisma.autopilotUsageLedger.findMany({
      where: { businessId: params.businessId, periodKey },
    });
    for (const row of rows) {
      const cap = row.capability as AutopilotUsageCapability;
      if (cap in used) used[cap] += 1;
      monthlySpendMinorKES += Number(row.estimatedCostMinorKES || 0);
      if (row.dayKey === dayKey) {
        dailySpendMinorKES += Number(row.estimatedCostMinorKES || 0);
      }
    }
  } catch {
    // Offline fallback returns 0 usage without inventing data.
  }

  return {
    periodKey,
    dayKey,
    tierKey: params.tierKey,
    dailySpendMinorKES,
    dailySpendCapMinorKES,
    monthlySpendMinorKES,
    monthlySpendCapMinorKES: limits.monthlyIncludedSpendCapMinorKES,
    capabilityUsedThisMonth: used,
    capabilityLimits: limits,
  };
}

export async function evaluateAutopilotBudget(params: {
  businessId: string;
  tierKey: AutopilotTier | "PREVIEW";
  capability: AutopilotUsageCapability;
  dailySpendCapMinorKES?: number;
  estimatedCallCostMinorKES?: number;
  now?: Date;
}): Promise<{ allowed: true; summary: UsageBudgetSummary } | { allowed: false; code: string; reason: string; summary: UsageBudgetSummary }> {
  const summary = await getAutopilotUsageSummary({
    businessId: params.businessId,
    tierKey: params.tierKey,
    dailySpendCapMinorKES: params.dailySpendCapMinorKES,
    now: params.now,
  });

  const callCost =
    params.estimatedCallCostMinorKES ?? ESTIMATED_MINOR_KES_PER_CALL[params.capability];
  const capAllowance = summary.capabilityLimits[params.capability];
  const capUsed = summary.capabilityUsedThisMonth[params.capability];

  if (capUsed >= capAllowance) {
    return {
      allowed: false,
      code: "MONTHLY_CAPABILITY_QUOTA_REACHED",
      reason: `Monthly ${params.capability} allowance (${capUsed}/${capAllowance}) reached for ${params.tierKey}. Deterministic diagnostics remain available without extra AI charges.`,
      summary,
    };
  }
  if (summary.dailySpendMinorKES + callCost > summary.dailySpendCapMinorKES) {
    return {
      allowed: false,
      code: "DAILY_SPEND_CAP_REACHED",
      reason: `Tenant daily AI spend cap (KES ${(summary.dailySpendCapMinorKES / 100).toFixed(2)}) reached for ${summary.dayKey}. Increase the daily cap or wait until tomorrow (EAT).`,
      summary,
    };
  }
  if (summary.monthlySpendMinorKES + callCost > summary.monthlySpendCapMinorKES) {
    return {
      allowed: false,
      code: "MONTHLY_SPEND_CAP_REACHED",
      reason: `Monthly included AI budget ceiling (KES ${(summary.monthlySpendCapMinorKES / 100).toFixed(2)}) reached for ${summary.periodKey}. Upgrade tier to expand monthly capacity.`,
      summary,
    };
  }
  return { allowed: true, summary };
}

const tenantBudgetMutex = new Map<string, Promise<void>>();

async function withTenantBudgetLock<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tenantBudgetMutex.get(businessId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next, () => next);
  tenantBudgetMutex.set(businessId, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tenantBudgetMutex.get(businessId) === chained) {
      tenantBudgetMutex.delete(businessId);
    }
  }
}

export async function reserveAutopilotBudget(params: {
  businessId: string;
  tierKey: AutopilotTier | "PREVIEW";
  capability: AutopilotUsageCapability;
  provider: string;
  idempotencyKey: string;
  dailySpendCapMinorKES?: number;
  estimatedCallCostMinorKES?: number;
  unitsIn?: number;
  unitsOut?: number;
  now?: Date;
}): Promise<
  | { allowed: true; alreadyRecorded: boolean; summary: UsageBudgetSummary }
  | { allowed: false; code: string; reason: string; summary: UsageBudgetSummary }
> {
  return withTenantBudgetLock(params.businessId, async () => {
    const runCheckAndInsert = async (dbClient: any) => {
      if (typeof dbClient.$executeRaw === "function") {
        try {
          await dbClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`autopilot_budget:${params.businessId}`}))`;
        } catch {
          // Non-Postgres or mock client; in-process per-tenant mutex still serializes concurrent callers.
        }
      }

      const existing = await dbClient.autopilotUsageLedger.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      const { periodKey, dayKey } = currentPeriodAndDayKeys(params.now);
      const limits = QUOTA_BY_AUTOPILOT_TIER[params.tierKey];
      const dailySpendCapMinorKES = params.dailySpendCapMinorKES ?? 25_000;
      const rows = await dbClient.autopilotUsageLedger.findMany({
        where: { businessId: params.businessId, periodKey },
      });

      const used: Record<AutopilotUsageCapability, number> = {
        LLM_REASONING: 0,
        VISION_EXTRACT: 0,
        VOICE_STT: 0,
        VOICE_TTS: 0,
        OUTBOUND_MSG: 0,
        WORKFLOW_STEP: 0,
      };
      let monthlySpendMinorKES = 0;
      let dailySpendMinorKES = 0;
      for (const row of rows) {
        const cap = row.capability as AutopilotUsageCapability;
        if (cap in used) used[cap] += 1;
        monthlySpendMinorKES += Number(row.estimatedCostMinorKES || 0);
        if (row.dayKey === dayKey) {
          dailySpendMinorKES += Number(row.estimatedCostMinorKES || 0);
        }
      }

      const summary: UsageBudgetSummary = {
        periodKey,
        dayKey,
        tierKey: params.tierKey,
        dailySpendMinorKES,
        dailySpendCapMinorKES,
        monthlySpendMinorKES,
        monthlySpendCapMinorKES: limits.monthlyIncludedSpendCapMinorKES,
        capabilityUsedThisMonth: used,
        capabilityLimits: limits,
      };

      if (existing) {
        return { allowed: true as const, alreadyRecorded: true, summary };
      }

      const callCost =
        params.estimatedCallCostMinorKES ?? ESTIMATED_MINOR_KES_PER_CALL[params.capability];
      const capAllowance = summary.capabilityLimits[params.capability];
      const capUsed = summary.capabilityUsedThisMonth[params.capability];

      if (capUsed >= capAllowance) {
        return {
          allowed: false as const,
          code: "MONTHLY_CAPABILITY_QUOTA_REACHED",
          reason: `Monthly ${params.capability} allowance (${capUsed}/${capAllowance}) reached for ${params.tierKey}. Deterministic diagnostics remain available without extra AI charges.`,
          summary,
        };
      }
      if (summary.dailySpendMinorKES + callCost > summary.dailySpendCapMinorKES) {
        return {
          allowed: false as const,
          code: "DAILY_SPEND_CAP_REACHED",
          reason: `Tenant daily AI spend cap (KES ${(summary.dailySpendCapMinorKES / 100).toFixed(2)}) reached for ${summary.dayKey}. Increase the daily cap or wait until tomorrow (EAT).`,
          summary,
        };
      }
      if (summary.monthlySpendMinorKES + callCost > summary.monthlySpendCapMinorKES) {
        return {
          allowed: false as const,
          code: "MONTHLY_SPEND_CAP_REACHED",
          reason: `Monthly included AI budget ceiling (KES ${(summary.monthlySpendCapMinorKES / 100).toFixed(2)}) reached for ${summary.periodKey}. Upgrade tier to expand monthly capacity.`,
          summary,
        };
      }

      try {
        await dbClient.autopilotUsageLedger.create({
          data: {
            businessId: params.businessId,
            periodKey,
            dayKey,
            capability: params.capability,
            provider: params.provider,
            unitsIn: params.unitsIn ?? 0,
            unitsOut: params.unitsOut ?? 0,
            estimatedCostMinorKES: callCost,
            idempotencyKey: params.idempotencyKey,
          },
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          return { allowed: true as const, alreadyRecorded: true, summary };
        }
        throw err;
      }

      return {
        allowed: true as const,
        alreadyRecorded: false,
        summary: {
          ...summary,
          dailySpendMinorKES: summary.dailySpendMinorKES + callCost,
          monthlySpendMinorKES: summary.monthlySpendMinorKES + callCost,
          capabilityUsedThisMonth: {
            ...summary.capabilityUsedThisMonth,
            [params.capability]: capUsed + 1,
          },
        },
      };
    };

    try {
      if (typeof (prisma as any).$transaction === "function") {
        return await (prisma as any).$transaction((tx: any) => runCheckAndInsert(tx));
      }
      return await runCheckAndInsert(prisma);
    } catch {
      const fallback = await evaluateAutopilotBudget(params);
      if (fallback.allowed === false) return fallback;
      return { allowed: true, alreadyRecorded: false, summary: fallback.summary };
    }
  });
}

export async function releaseAutopilotBudgetReservation(idempotencyKey: string): Promise<void> {
  try {
    if (typeof (prisma.autopilotUsageLedger as any).deleteMany === "function") {
      await prisma.autopilotUsageLedger.deleteMany({ where: { idempotencyKey } });
    }
  } catch {
    // Non-fatal best-effort release when downstream step aborts prior to provider invocation.
  }
}

export async function recordAutopilotUsage(params: {
  businessId: string;
  capability: AutopilotUsageCapability;
  provider: string;
  unitsIn?: number;
  unitsOut?: number;
  estimatedCostMinorKES?: number;
  idempotencyKey: string;
  now?: Date;
}): Promise<void> {
  const { periodKey, dayKey } = currentPeriodAndDayKeys(params.now);
  const cost =
    params.estimatedCostMinorKES ?? ESTIMATED_MINOR_KES_PER_CALL[params.capability];
  try {
    const existing = await prisma.autopilotUsageLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return;
    await prisma.autopilotUsageLedger.create({
      data: {
        businessId: params.businessId,
        periodKey,
        dayKey,
        capability: params.capability,
        provider: params.provider,
        unitsIn: params.unitsIn ?? 0,
        unitsOut: params.unitsOut ?? 0,
        estimatedCostMinorKES: cost,
        idempotencyKey: params.idempotencyKey,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") return;
    // Non-fatal in offline preview mode where DB writes are unavailable.
  }
}
