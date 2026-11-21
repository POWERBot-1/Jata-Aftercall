import { describe, expect, it } from "vitest";
import {
  summarizeSubscriptionPaymentLifecycle,
  type SubscriptionPaymentEvidence,
} from "@/lib/admin/subscription-payment-reconciliation";

const row = (overrides: Partial<SubscriptionPaymentEvidence> = {}): SubscriptionPaymentEvidence => ({
  subscriptionId: "sub-1",
  businessId: "biz-1",
  userId: "user-1",
  planId: "plan-1",
  status: "ACTIVE",
  paymentId: "pay-1",
  paymentReference: "ref-1",
  payment: {
    id: "pay-1",
    reference: "ref-1",
    businessId: "biz-1",
    userId: "user-1",
    planId: "plan-1",
    purpose: "SUBSCRIPTION",
    status: "PAID",
    environment: "LIVE",
    reconciliationStatus: "MATCHED",
    providerSettledAt: new Date("2026-11-22T10:00:00.000Z"),
    providerSettlementReference: "ref-1",
    currency: "KES",
    settledRefundMinor: BigInt(0),
    settledChargebackMinor: BigInt(0),
  },
  ...overrides,
});

describe("subscription/payment reconciliation inventory", () => {
  it("accepts an active subscription with exact paid-payment provenance", () => {
    const report = summarizeSubscriptionPaymentLifecycle([row()]);
    expect(report.subscriptionsReviewed).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("flags active subscriptions without a payment and dangling payment references", () => {
    const report = summarizeSubscriptionPaymentLifecycle([
      row({ paymentId: null, paymentReference: null, payment: null }),
      row({ subscriptionId: "sub-2", paymentId: "missing", payment: null }),
    ]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITHOUT_PAYMENT).toBe(1);
    expect(report.counts.SUBSCRIPTION_PAYMENT_NOT_FOUND).toBe(1);
  });

  it("flags active subscriptions linked to a payment that is not paid", () => {
    const report = summarizeSubscriptionPaymentLifecycle([
      row({ payment: { ...row().payment!, status: "PENDING" } }),
    ]);
    expect(report.findings[0].exception).toBe("ACTIVE_SUBSCRIPTION_WITH_UNPAID_PAYMENT");
  });

  it("flags tenant, owner, plan, purpose and reference mismatches", () => {
    const report = summarizeSubscriptionPaymentLifecycle([
      row({ payment: { ...row().payment!, businessId: "other-business" } }),
    ]);
    expect(report.findings[0].exception).toBe("SUBSCRIPTION_PAYMENT_IDENTITY_MISMATCH");
  });

  it("does not flag a pending subscription merely because its payment is pending", () => {
    const report = summarizeSubscriptionPaymentLifecycle([
      row({ status: "PENDING", payment: { ...row().payment!, status: "PENDING" } }),
    ]);
    expect(report.findings).toEqual([]);
  });


  it("does not treat a PAID label as verified settlement when environment or reconciliation evidence is missing", () => {
    const report = summarizeSubscriptionPaymentLifecycle([
      row({ payment: { ...row().payment!, environment: "UNKNOWN" } }),
      row({ subscriptionId: "sub-test", payment: { ...row().payment!, environment: "TEST" } }),
      row({ subscriptionId: "sub-unmatched", payment: { ...row().payment!, reconciliationStatus: "UNRECONCILED" } }),
      row({ subscriptionId: "sub-no-settlement", payment: { ...row().payment!, providerSettledAt: null } }),
    ]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITH_UNVERIFIED_PAYMENT).toBe(4);
  });

  it("flags active subscriptions whose linked payment has settled refunds or chargebacks", () => {
    const report = summarizeSubscriptionPaymentLifecycle([
      row({ payment: { ...row().payment!, settledRefundMinor: BigInt(10) } }),
      row({ subscriptionId: "sub-chargeback", payment: { ...row().payment!, settledChargebackMinor: BigInt(5) } }),
    ]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITH_REFUND_OR_CHARGEBACK).toBe(2);
  });

  it("rejects duplicate subscription identities rather than silently deduplicating", () => {
    expect(() => summarizeSubscriptionPaymentLifecycle([row(), row()])).toThrow(
      "SUBSCRIPTION_PAYMENT_SUBSCRIPTION_ID_AMBIGUOUS",
    );
  });
});
