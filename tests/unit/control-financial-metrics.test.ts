import { describe, expect, it } from "vitest";
import { calculateRecurringRevenueMetrics, type RecurringSubscriptionMetricSource } from "@/lib/control/financial-metrics";

type PaymentMetric = NonNullable<RecurringSubscriptionMetricSource["payment"]>;

function payment(overrides: Partial<PaymentMetric> = {}): PaymentMetric {
  return {
    id: "payment-a",
    businessId: "business-a",
    planId: "plan-a",
    reference: "JATA-REF-A",
    status: "PAID",
    environment: "LIVE",
    currency: "KES",
    paystackId: "provider-transaction-a",
    providerSettledAt: "2026-11-01T10:00:00.000Z",
    providerSettlementReference: "JATA-REF-A",
    settledRefundMinor: null,
    settledChargebackMinor: null,
    ...overrides,
  };
}

function subscription(overrides: Partial<RecurringSubscriptionMetricSource> = {}): RecurringSubscriptionMetricSource {
  return {
    status: "ACTIVE",
    businessId: "business-a",
    planId: "plan-a",
    paymentId: "payment-a",
    paymentReference: "JATA-REF-A",
    recurringAmountKES: 1200,
    recurringDiscountKES: 0,
    recurringCurrency: "KES",
    recurringIntervalDays: 30,
    recurringPriceEffectiveAt: "2026-11-01T10:00:00.000Z",
    payment: payment(),
    ...overrides,
  };
}

describe("calculateRecurringRevenueMetrics", () => {
  it("normalizes 30-day and annual subscriptions exactly without rounding", () => {
    const result = calculateRecurringRevenueMetrics([
      subscription({ recurringAmountKES: 1200, recurringDiscountKES: 200, recurringIntervalDays: 30 }),
      subscription({
        businessId: "business-b", planId: "plan-b", paymentId: "payment-b", paymentReference: "JATA-REF-B",
        recurringAmountKES: 12000, recurringDiscountKES: 0, recurringIntervalDays: 365,
        payment: payment({ id: "payment-b", businessId: "business-b", planId: "plan-b", reference: "JATA-REF-B", providerSettlementReference: "JATA-REF-B", paystackId: "provider-transaction-b" }),
      }),
    ]);

    expect(result).toMatchObject({
      state: "VERIFIED",
      activeSubscriptionCount: 2,
      includedSubscriptionCount: 2,
      excludedTestSubscriptionCount: 0,
      incompleteSubscriptionCount: 0,
      mrrNumeratorKES: "24000",
      mrrDenominator: 12,
      arrKES: "24000",
    });
  });

  it("excludes test subscriptions from run-rate", () => {
    const result = calculateRecurringRevenueMetrics([
      subscription(),
      subscription({ payment: payment({ environment: "TEST" }) }),
    ]);

    expect(result).toMatchObject({
      state: "VERIFIED",
      activeSubscriptionCount: 2,
      includedSubscriptionCount: 1,
      excludedTestSubscriptionCount: 1,
      mrrNumeratorKES: "14400",
      arrKES: "14400",
    });
  });

  it("returns exact zero when there are no active subscriptions", () => {
    expect(calculateRecurringRevenueMetrics([subscription({ status: "CANCELLED" })])).toMatchObject({
      state: "VERIFIED",
      activeSubscriptionCount: 0,
      mrrNumeratorKES: "0",
      arrKES: "0",
    });
  });

  it.each([
    ["missing payment", subscription({ payment: null })],
    ["unknown environment", subscription({ payment: payment({ environment: "UNKNOWN" }) })],
    ["non-paid active subscription", subscription({ payment: payment({ status: "PENDING" }) })],
    ["missing provider transaction id", subscription({ payment: payment({ paystackId: null }) })],
    ["missing provider settlement reference", subscription({ payment: payment({ providerSettlementReference: null }) })],
    ["invalid settlement timestamp", subscription({ payment: payment({ providerSettledAt: "not-a-date" }) })],
    ["mismatched payment id", subscription({ paymentId: "another-payment" })],
    ["mismatched payment business", subscription({ payment: payment({ businessId: "another-business" }) })],
    ["mismatched payment plan", subscription({ payment: payment({ planId: "another-plan" }) })],
    ["mismatched payment reference", subscription({ paymentReference: "another-reference" })],
    ["settled refund present", subscription({ payment: payment({ settledRefundMinor: "100" }) })],
    ["settled chargeback present", subscription({ payment: payment({ settledChargebackMinor: "1" }) })],
    ["missing immutable price snapshot", subscription({ recurringAmountKES: null })],
    ["missing price effective timestamp", subscription({ recurringPriceEffectiveAt: null })],
    ["missing discount snapshot", subscription({ recurringDiscountKES: null })],
    ["unsupported currency", subscription({ recurringCurrency: "USD" })],
    ["unsupported interval", subscription({ recurringIntervalDays: 90 })],
    ["discount exceeds price", subscription({ recurringAmountKES: 100, recurringDiscountKES: 101 })],
  ])("withholds the entire aggregate for %s", (_label, row) => {
    const result = calculateRecurringRevenueMetrics([row]);
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.mrrNumeratorKES).toBeNull();
    expect(result.arrKES).toBeNull();
    expect(result.incompleteSubscriptionCount).toBe(1);
  });

  it("does not leak subscription or payment identifiers into aggregate output", () => {
    const result = calculateRecurringRevenueMetrics([subscription()]);
    expect(JSON.stringify(result)).not.toMatch(/businessId|paymentId|providerSettlementReference|customerEmail/i);
  });
});
