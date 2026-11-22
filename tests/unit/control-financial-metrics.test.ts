import { describe, expect, it } from "vitest";
import { calculateRecurringRevenueMetrics, type RecurringSubscriptionMetricSource } from "@/lib/control/financial-metrics";

function subscription(overrides: Partial<RecurringSubscriptionMetricSource> = {}): RecurringSubscriptionMetricSource {
  return {
    status: "ACTIVE",
    recurringAmountKES: 1200,
    recurringDiscountKES: 0,
    recurringCurrency: "KES",
    recurringIntervalDays: 30,
    payment: {
      status: "PAID",
      environment: "LIVE",
      reconciliationStatus: "RECONCILED",
      providerSettledAt: "2026-11-01T10:00:00.000Z",
      providerSettlementReference: "provider-settlement-1",
    },
    ...overrides,
  };
}

describe("calculateRecurringRevenueMetrics", () => {
  it("normalizes 30-day and annual subscriptions exactly without rounding", () => {
    const result = calculateRecurringRevenueMetrics([
      subscription({ recurringAmountKES: 1200, recurringDiscountKES: 200, recurringIntervalDays: 30 }),
      subscription({ recurringAmountKES: 12000, recurringDiscountKES: 0, recurringIntervalDays: 365 }),
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
      subscription({ payment: { status: "PAID", environment: "TEST", reconciliationStatus: "RECONCILED", providerSettledAt: "2026-11-01T10:00:00.000Z", providerSettlementReference: "test-reference" } }),
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
    ["unknown environment", subscription({ payment: { status: "PAID", environment: "UNKNOWN", reconciliationStatus: "RECONCILED", providerSettledAt: "2026-11-01T10:00:00.000Z", providerSettlementReference: "ref" } })],
    ["unreconciled payment", subscription({ payment: { status: "PAID", environment: "LIVE", reconciliationStatus: "UNRECONCILED", providerSettledAt: "2026-11-01T10:00:00.000Z", providerSettlementReference: "ref" } })],
    ["missing provider settlement reference", subscription({ payment: { status: "PAID", environment: "LIVE", reconciliationStatus: "RECONCILED", providerSettledAt: "2026-11-01T10:00:00.000Z", providerSettlementReference: null } })],
    ["invalid settlement timestamp", subscription({ payment: { status: "PAID", environment: "LIVE", reconciliationStatus: "RECONCILED", providerSettledAt: "not-a-date", providerSettlementReference: "ref" } })],
    ["non-paid active subscription", subscription({ payment: { status: "PENDING", environment: "LIVE", reconciliationStatus: "RECONCILED", providerSettledAt: "2026-11-01T10:00:00.000Z", providerSettlementReference: "ref" } })],
    ["missing immutable price snapshot", subscription({ recurringAmountKES: null })],
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
