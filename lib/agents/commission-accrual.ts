import { randomUUID } from "node:crypto";
import { isProviderTransactionId } from "@/lib/paymentVerification";

const COMMISSION_BASIS_POINTS = 4_000;
const MINIMUM_MONTHLY_PLAN_SALES = 10;
const POLICY_VERSION = "JATA-COMMISSION-2026-11-07-v1";

function nairobiMonthBounds(instant: Date): { start: Date; end: Date; key: string } {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new Error("COMMISSION_DATE_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit",
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("COMMISSION_DATE_INVALID");
  // Nairobi is UTC+03:00 and does not observe daylight saving time.
  const start = new Date(Date.UTC(year, month - 1, 1) - 3 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month, 1) - 3 * 60 * 60 * 1000);
  return { start, end, key: `${year}-${String(month).padStart(2, "0")}` };
}

/**
 * Called inside the same database transaction that records a provider-verified PAID subscription.
 * It creates an immutable 40% accrual for each consented, first-touch referral sale. It never sends
 * money. A unique sourceEventId makes webhook/verify retries idempotent.
 */
export async function recordCommissionAccrualForPaidPlan(tx: any, paymentId: string): Promise<{
  recorded: boolean; agentApplicationId: string | null; commissionMinor: bigint; monthlyPlanSales: number; payoutEligible: boolean;
}> {
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "PAID" || payment.purpose !== "SUBSCRIPTION" ||
      !payment.businessId || !payment.planId || payment.currency !== "KES" ||
      !Number.isSafeInteger(payment.amount) || payment.amount <= 0 ||
      !isProviderTransactionId(payment.paystackId)) {
    return { recorded: false, agentApplicationId: null, commissionMinor: BigInt(0), monthlyPlanSales: 0, payoutEligible: false };
  }

  const referral = await tx.referral.findFirst({
    where: { referredUserId: payment.userId, status: "CONVERTED", convertedAt: { not: null } },
    select: { referrerUserId: true, referredUserId: true, convertedAt: true },
  });
  if (!referral?.referrerUserId || !referral.referredUserId) {
    return { recorded: false, agentApplicationId: null, commissionMinor: BigInt(0), monthlyPlanSales: 0, payoutEligible: false };
  }

  const agent = await tx.agentApplication.findUnique({
    where: { userId: referral.referrerUserId },
    select: { id: true, agentStatus: true, phoneVerifiedAt: true },
  });
  if (!agent || agent.agentStatus !== "ACTIVE" || !agent.phoneVerifiedAt) {
    return { recorded: false, agentApplicationId: agent?.id ?? null, commissionMinor: BigInt(0), monthlyPlanSales: 0, payoutEligible: false };
  }

  const plan = await tx.planConfig.findUnique({ where: { id: payment.planId }, select: { id: true, priceKES: true, key: true } });
  if (!plan || !Number.isSafeInteger(plan.priceKES) || payment.amount !== plan.priceKES * 100) {
    throw new Error("COMMISSION_PLAN_AMOUNT_MISMATCH");
  }

  const paidAt = payment.updatedAt instanceof Date ? payment.updatedAt : new Date(payment.updatedAt);
  const month = nairobiMonthBounds(paidAt);
  const referrals = await tx.referral.findMany({
    where: { referrerUserId: referral.referrerUserId, status: "CONVERTED", referredUserId: { not: null } },
    select: { referredUserId: true },
  });
  const referredUserIds = [...new Set(referrals.map((row: { referredUserId: string | null }) => row.referredUserId).filter((id: string | null): id is string => Boolean(id)))];
  if (!referredUserIds.includes(payment.userId)) throw new Error("COMMISSION_ATTRIBUTION_CHANGED");

  const monthlyPlanSales = await tx.payment.count({
    where: {
      userId: { in: referredUserIds },
      status: "PAID",
      purpose: "SUBSCRIPTION",
      planId: { not: null },
      businessId: { not: null },
      updatedAt: { gte: month.start, lt: month.end },
    },
  });
  const grossMinor = BigInt(payment.amount);
  const commissionMinor = (grossMinor * BigInt(COMMISSION_BASIS_POINTS) + BigInt(5_000)) / BigInt(10_000);
  if (commissionMinor <= BigInt(0)) throw new Error("COMMISSION_AMOUNT_INVALID");

  const sourceEventId = `subscription-sale:${payment.id}`;
  const result = await tx.agentCommissionLedgerEntry.createMany({
    data: [{
      id: randomUUID(),
      paymentId: payment.id,
      agentApplicationId: agent.id,
      entryType: "ACCRUAL",
      currency: "KES",
      amountMinor: commissionMinor,
      sourceEventId,
      originalEntryId: null,
      policyVersion: POLICY_VERSION,
      policySnapshot: {
        policyVersion: POLICY_VERSION,
        basisPoints: COMMISSION_BASIS_POINTS,
        basis: "GROSS_VERIFIED_PLAN_CHARGE",
        currency: "KES",
        qualifyingMonthlyPlanSales: monthlyPlanSales,
        minimumMonthlyPlanSales: MINIMUM_MONTHLY_PLAN_SALES,
        payoutEligibleAtEvaluation: monthlyPlanSales >= MINIMUM_MONTHLY_PLAN_SALES,
        nairobiMonth: month.key,
        planId: plan.id,
        planKey: plan.key,
      },
    }],
    skipDuplicates: true,
  });
  if (result.count === 1) {
    await tx.auditEvent.create({
      data: {
        actorId: payment.userId,
        action: "AGENT_COMMISSION_ACCRUED",
        targetType: "AGENT_COMMISSION_LEDGER",
        targetId: sourceEventId,
        metadata: JSON.stringify({
          paymentId: payment.id,
          agentApplicationId: agent.id,
          commissionMinor: commissionMinor.toString(),
          monthlyPlanSales,
          payoutEligible: monthlyPlanSales >= MINIMUM_MONTHLY_PLAN_SALES,
          policyVersion: POLICY_VERSION,
        }),
      },
    });
  }
  return {
    recorded: result.count === 1,
    agentApplicationId: agent.id,
    commissionMinor,
    monthlyPlanSales,
    payoutEligible: monthlyPlanSales >= MINIMUM_MONTHLY_PLAN_SALES,
  };
}
