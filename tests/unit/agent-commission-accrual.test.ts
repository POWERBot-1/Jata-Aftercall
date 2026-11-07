import { describe, expect, it, vi } from "vitest";
import { recordCommissionAccrualForPaidPlan, recordCommissionReversalForFullRefund, getAgentMonthlyCommissionEligibility } from "@/lib/agents/commission-accrual";

function makeTx(overrides: Record<string, unknown> = {}) {
  const payment = {
    id: "payment-1", userId: "customer-1", businessId: "business-1", planId: "plan-1",
    status: "PAID", purpose: "SUBSCRIPTION", currency: "KES", amount: 100_000,
    paystackId: "123456789", updatedAt: new Date("2026-11-07T10:00:00.000Z"),
  };
  const tx: any = {
    payment: { findUnique: vi.fn(async () => payment), count: vi.fn(async () => 10) },
    referral: {
      findFirst: vi.fn(async () => ({ referrerUserId: "agent-user-1", referredUserId: "customer-1", convertedAt: new Date("2026-01-01Z") })),
      findMany: vi.fn(async () => [{ referredUserId: "customer-1" }, { referredUserId: "customer-2" }]),
    },
    agentApplication: { findUnique: vi.fn(async () => ({ id: "agent-application-1", agentStatus: "ACTIVE", phoneVerifiedAt: new Date("2026-01-01Z") })) },
    planConfig: { findUnique: vi.fn(async () => ({ id: "plan-1", priceKES: 1000, key: "BUSINESS_PAGE" })) },
    agentCommissionLedgerEntry: { createMany: vi.fn(async () => ({ count: 1 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
  };
  Object.assign(tx, overrides);
  return tx;
}

describe("transactional commission accrual", () => {
  it("records 40 percent of a verified subscription plan sale and qualifies at ten monthly sales", async () => {
    const tx = makeTx();
    const result = await recordCommissionAccrualForPaidPlan(tx, "payment-1");
    expect(result).toMatchObject({ recorded: true, agentApplicationId: "agent-application-1", commissionMinor: BigInt(40_000), monthlyPlanSales: 10, payoutEligible: true });
    expect(tx.agentCommissionLedgerEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({
        paymentId: "payment-1", entryType: "ACCRUAL", amountMinor: BigInt(40_000),
        sourceEventId: "subscription-sale:payment-1",
        policySnapshot: expect.objectContaining({ basisPoints: 4000, minimumMonthlyPlanSales: 10, payoutEligibleAtEvaluation: true }),
      })],
    }));
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("does not record payout eligibility below ten qualifying plan sales", async () => {
    const tx = makeTx();
    tx.payment.count.mockResolvedValue(9);
    const result = await recordCommissionAccrualForPaidPlan(tx, "payment-1");
    expect(result).toMatchObject({ recorded: true, monthlyPlanSales: 9, payoutEligible: false });
  });

  it("does not accrue for unpaid, non-subscription, missing-provider or invalid-amount records", async () => {
    for (const payment of [
      { status: "PENDING" }, { purpose: "ORDER" }, { paystackId: null }, { amount: 0 },
    ]) {
      const tx = makeTx({ payment: { findUnique: vi.fn(async () => ({ ...{
        id: "payment-1", userId: "customer-1", businessId: "business-1", planId: "plan-1", status: "PAID",
        purpose: "SUBSCRIPTION", currency: "KES", amount: 100_000, paystackId: "123456789",
        updatedAt: new Date("2026-11-07T10:00:00.000Z"),
      }, ...payment })) } });
      const result = await recordCommissionAccrualForPaidPlan(tx, "payment-1");
      expect(result.recorded).toBe(false);
      expect(tx.agentCommissionLedgerEntry.createMany).not.toHaveBeenCalled();
    }
  });

  it("does not accrue for missing referral or inactive/unverified agents", async () => {
    const noReferral = makeTx({ referral: { findFirst: vi.fn(async () => null) } });
    expect((await recordCommissionAccrualForPaidPlan(noReferral, "payment-1")).recorded).toBe(false);
    const inactive = makeTx({ agentApplication: { findUnique: vi.fn(async () => ({ id: "agent-application-1", agentStatus: "SUSPENDED", phoneVerifiedAt: new Date() })) } });
    expect((await recordCommissionAccrualForPaidPlan(inactive, "payment-1")).recorded).toBe(false);
  });

  it("uses the verified charged amount rather than a mutable current catalogue price", async () => {
    const tx = makeTx({ planConfig: { findUnique: vi.fn(async () => ({ id: "plan-1", key: "BUSINESS_PAGE" })) } });
    const result = await recordCommissionAccrualForPaidPlan(tx, "payment-1");
    expect(result).toMatchObject({ recorded: true, commissionMinor: BigInt(40_000) });
  });

  it("uses idempotent createMany semantics when the payment event is replayed", async () => {
    const tx = makeTx();
    tx.agentCommissionLedgerEntry.createMany.mockResolvedValue({ count: 0 });
    const result = await recordCommissionAccrualForPaidPlan(tx, "payment-1");
    expect(result.recorded).toBe(false);
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("commission full-refund reversal", () => {
  it("appends one negative immutable reversal linked to the original accrual", async () => {
    const accrual = { id: "accrual-1", agentApplicationId: "agent-application-1", currency: "KES", amountMinor: BigInt(40_000), policyVersion: "v1", policySnapshot: { basisPoints: 4000 } };
    const tx: any = {
      payment: { findUnique: vi.fn(async () => ({ id: "payment-1", status: "REFUNDED", userId: "customer-1" })) },
      agentCommissionLedgerEntry: {
        findFirst: vi.fn(async () => accrual),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      auditEvent: { create: vi.fn(async () => ({})) },
    };
    await expect(recordCommissionReversalForFullRefund(tx, "payment-1")).resolves.toBe(true);
    expect(tx.agentCommissionLedgerEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({
        paymentId: "payment-1", entryType: "REVERSAL", amountMinor: BigInt(-40_000),
        agentApplicationId: "agent-application-1", originalEntryId: "accrual-1",
        sourceEventId: "subscription-refund:payment-1",
      })],
    }));
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("does not reverse an unrefunded payment or create a duplicate reversal", async () => {
    const tx: any = {
      payment: { findUnique: vi.fn(async () => ({ id: "payment-1", status: "PAID", userId: "customer-1" })) },
      agentCommissionLedgerEntry: { findFirst: vi.fn(), createMany: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    await expect(recordCommissionReversalForFullRefund(tx, "payment-1")).resolves.toBe(false);
    expect(tx.agentCommissionLedgerEntry.createMany).not.toHaveBeenCalled();
  });
});

describe("monthly commission payout eligibility reconciliation", () => {
  it("recomputes qualifying sales and net accrued liability after reversals", async () => {
    const tx: any = {
      agentApplication: { findUnique: vi.fn(async () => ({ id: "agent-1", userId: "agent-user-1", agentStatus: "ACTIVE", phoneVerifiedAt: new Date("2026-01-01Z") })) },
      referral: { findMany: vi.fn(async () => [{ referredUserId: "customer-1" }]) },
      payment: { count: vi.fn(async () => 10) },
      agentCommissionLedgerEntry: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "accrual-1", amountMinor: BigInt(40_000) }])
          .mockResolvedValueOnce([{ amountMinor: BigInt(-10_000) }]),
      },
    };
    const result = await getAgentMonthlyCommissionEligibility(tx, "agent-1", new Date("2026-11-07T10:00:00Z"));
    expect(result).toMatchObject({
      eligible: true, month: "2026-11", qualifyingPlanSales: 10, minimumMonthlyPlanSales: 10,
      accruedMinor: BigInt(40_000), reversedMinor: BigInt(10_000), payableMinor: BigInt(30_000),
    });
  });

  it("keeps payout ineligible below the monthly threshold even when an accrual exists", async () => {
    const tx: any = {
      agentApplication: { findUnique: vi.fn(async () => ({ id: "agent-1", userId: "agent-user-1", agentStatus: "ACTIVE", phoneVerifiedAt: new Date() })) },
      referral: { findMany: vi.fn(async () => [{ referredUserId: "customer-1" }]) },
      payment: { count: vi.fn(async () => 9) },
      agentCommissionLedgerEntry: { findMany: vi.fn(async () => [{ id: "accrual-1", amountMinor: BigInt(40_000) }]) },
    };
    const result = await getAgentMonthlyCommissionEligibility(tx, "agent-1", new Date("2026-11-07T10:00:00Z"));
    expect(result).toMatchObject({ eligible: false, qualifyingPlanSales: 9, payableMinor: BigInt(40_000) });
  });
});
