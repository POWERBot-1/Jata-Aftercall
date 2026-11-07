import { describe, expect, it } from "vitest";
import { evaluateCommission, type CommissionPolicySnapshot, type CommissionPaymentSnapshot, type CommissionAttributionSnapshot } from "@/lib/agents/commission-calculation";

// Test fixtures for the owner-authorized 40% commission and 10-sale monthly threshold.
const policy: CommissionPolicySnapshot = { id: "policy-test", version: "v1", approval: "APPROVED", effectiveFrom: new Date("2026-01-01Z"), effectiveUntil: null, currency: "KES", eligiblePlanIds: ["plan-1"], eligibleEvents: ["NEW_SALE", "RENEWAL", "UPGRADE"], basis: "GROSS", rule: { kind: "PERCENTAGE", basisPoints: 4000, rounding: "HALF_UP" } };
const payment: CommissionPaymentSnapshot = { id: "payment-1", reference: "sandbox-reference", status: "PAID", purpose: "SUBSCRIPTION", paystackId: "sandbox-transaction", currency: "KES", amountMinor: 10000, businessId: "business-1", customerId: "customer-1", planId: "plan-1", verifiedAt: new Date("2026-02-01Z"), event: "NEW_SALE" };
const attribution: CommissionAttributionSnapshot = { agentId: "agent-1", agentUserId: "agent-user-1", agentStatus: "ACTIVE", businessId: "business-1", customerId: "customer-1", validFrom: new Date("2026-01-01Z"), validUntil: null };
const evaluate = (overrides: Partial<Parameters<typeof evaluateCommission>[0]> = {}) => evaluateCommission({ policy, payment, attribution, eligibleMinor: 10000, monthlyQualifyingSales: 1, ...overrides });

describe("commission policy evaluation (hypothetical fixtures only)", () => {
  it("calculates an attributed plan sale without requiring the agent to recruit other agents", () => {
    expect(evaluate()).toMatchObject({ eligible: true, commissionMinor: 4000, paymentId: "payment-1", policyVersion: "v1", agentId: "agent-1" });
  });
  it("accrues 40 percent on each verified sale but only marks payout eligible after ten sales in the month", () => {
    expect(evaluate({ monthlyQualifyingSales: 9 })).toMatchObject({ eligible: true, commissionMinor: 4000, payoutEligible: false, monthlyQualifyingSales: 9, minimumMonthlySales: 10 });
    expect(evaluate({ monthlyQualifyingSales: 10 })).toMatchObject({ eligible: true, commissionMinor: 4000, payoutEligible: true, monthlyQualifyingSales: 10, minimumMonthlySales: 10 });
    expect(evaluate({ monthlyQualifyingSales: 11 })).toMatchObject({ eligible: true, payoutEligible: true });
  });
  it("rejects an invalid monthly qualifying-sales count", () => {
    expect(evaluate({ monthlyQualifyingSales: 0 })).toMatchObject({ eligible: false, reason: "PAYMENT_INVALID" });
    expect(evaluate({ monthlyQualifyingSales: 1.5 })).toMatchObject({ eligible: false, reason: "PAYMENT_INVALID" });
  });
  it("blocks absent, draft, revoked and out-of-period policies", () => {
    expect(evaluate({ policy: null })).toMatchObject({ reason: "POLICY_NOT_APPROVED" });
    expect(evaluate({ policy: { ...policy, approval: "DRAFT" } })).toMatchObject({ reason: "POLICY_NOT_APPROVED" });
    expect(evaluate({ policy: { ...policy, approval: "REVOKED" } })).toMatchObject({ reason: "POLICY_NOT_APPROVED" });
    expect(evaluate({ policy: { ...policy, effectiveUntil: payment.verifiedAt } })).toMatchObject({ reason: "POLICY_NOT_EFFECTIVE" });
  });
  it("does not credit unverified, refunded or non-subscription events but includes each paid plan transaction", () => {
    for (const override of [{ status: "PENDING" }, { status: "REFUNDED" }, { paystackId: null }, { purpose: "ORDER" }]) {
      expect(evaluate({ payment: { ...payment, ...override } })).toMatchObject({ reason: "PAYMENT_NOT_VERIFIED" });
    }
    expect(evaluate({ payment: { ...payment, event: "RENEWAL" } })).toMatchObject({ eligible: true, commissionMinor: 4000 });
    expect(evaluate({ payment: { ...payment, event: "UPGRADE" } })).toMatchObject({ eligible: true, commissionMinor: 4000 });
  });
  it("blocks self-referral, suspended agents, mismatched customers, and expired attribution", () => {
    for (const override of [{ agentUserId: payment.customerId }, { agentStatus: "SUSPENDED" }, { businessId: "other" }, { customerId: "other" }, { validUntil: payment.verifiedAt }]) {
      expect(evaluate({ attribution: { ...attribution, ...override } })).toMatchObject({ reason: "ATTRIBUTION_NOT_ELIGIBLE" });
    }
  });
  it("uses exact integer arithmetic and the explicitly specified rounding mode", () => {
    const small = { ...payment, amountMinor: 1 };
    const rule = { kind: "PERCENTAGE" as const, basisPoints: 5000, rounding: "HALF_UP" as const };
    expect(evaluate({ policy: { ...policy, rule }, payment: small, eligibleMinor: 1 })).toMatchObject({ commissionMinor: 1 });
    expect(evaluate({ policy: { ...policy, rule: { ...rule, rounding: "DOWN" } }, payment: small, eligibleMinor: 1 })).toMatchObject({ reason: "ZERO_COMMISSION" });
    expect(evaluate({ policy: { ...policy, rule: { kind: "FIXED", minorUnits: 123 } } })).toMatchObject({ commissionMinor: 123 });
  });
  it("rejects incorrect bases, non-integer values and unsafe overflow", () => {
    expect(evaluate({ eligibleMinor: 10001 })).toMatchObject({ reason: "BASIS_INVALID" });
    expect(evaluate({ eligibleMinor: 9999 })).toMatchObject({ reason: "BASIS_INVALID" });
    expect(evaluate({ eligibleMinor: 1.1 })).toMatchObject({ reason: "PAYMENT_INVALID" });
    expect(evaluate({ policy: { ...policy, rule: { kind: "PERCENTAGE", basisPoints: Number.MAX_SAFE_INTEGER, rounding: "DOWN" } }, payment: { ...payment, amountMinor: 10001 }, eligibleMinor: 10001 })).toMatchObject({ reason: "AMOUNT_OVERFLOW" });
  });
});
