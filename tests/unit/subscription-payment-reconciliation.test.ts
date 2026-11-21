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

  it("rejects duplicate subscription identities rather than silently deduplicating", () => {
    expect(() => summarizeSubscriptionPaymentLifecycle([row(), row()])).toThrow(
      "SUBSCRIPTION_PAYMENT_SUBSCRIPTION_ID_AMBIGUOUS",
    );
  });
});
