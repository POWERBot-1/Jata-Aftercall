import { describe, expect, it } from "vitest";
import {
  calculateEvidenceGatedMrr,
  type RecurringPaymentEvidence,
  type RecurringSubscriptionEvidence,
} from "@/lib/payments/recurring-revenue";

const asOf = new Date("2026-11-21T12:00:00.000Z");

function subscription(overrides: Partial<RecurringSubscriptionEvidence> = {}): RecurringSubscriptionEvidence {
  return {
    product: "BUSINESS_POS",
    businessId: "business-1",
    planId: "plan-1",
    planKey: "BUSINESS_POS",
    status: "ACTIVE",
    startAt: new Date("2026-11-01T00:00:00.000Z"),
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    recurringAmountKES: 499,
    recurringDiscountKES: 0,
    recurringCurrency: "KES",
    recurringIntervalDays: 30,
    recurringPriceEffectiveAt: new Date("2026-11-01T00:00:00.000Z"),
    paymentId: "payment-1",
    paymentReference: "JATA-REF-1",
    ...overrides,
  };
}

function payment(overrides: Partial<RecurringPaymentEvidence> = {}): RecurringPaymentEvidence {
  return {
    id: "payment-1",
    businessId: "business-1",
    planId: "plan-1",
    reference: "JATA-REF-1",
    purpose: "SUBSCRIPTION",
    status: "PAID",
    environment: "LIVE",
    amount: 49_900,
    currency: "KES",
    providerSettledAt: new Date("2026-11-02T00:00:00.000Z"),
    providerSettlementReference: "JATA-REF-1",
    reconciliationStatus: "MATCHED",
    ...overrides,
  };
}

describe("calculateEvidenceGatedMrr", () => {
  it("includes only an exact LIVE, settled, matched 30-day subscription payment", () => {
    const result = calculateEvidenceGatedMrr([subscription()], [payment()], asOf);
    expect(result.eligibleSubscriptions).toBe(1);
    expect(result.mrrMinor).toBe(49_900);
    expect(result.arrMinor).toBe(598_800);
    expect(result.exclusions).toEqual([]);
    expect(result.currency).toBe("KES");
  });

  it("normalizes a 365-day subscription over twelve months without rounding", () => {
    const sub = subscription({
      recurringAmountKES: 12_000,
      recurringIntervalDays: 365,
    });
    const pay = payment({ amount: 1_200_000 });
    const result = calculateEvidenceGatedMrr([sub], [pay], asOf);
    expect(result.eligibleSubscriptions).toBe(1);
    expect(result.mrrMinor).toBe(100_000);
    expect(result.arrMinor).toBe(1_200_000);
  });

  it("excludes legacy subscriptions without an exact payment link", () => {
    const result = calculateEvidenceGatedMrr(
      [subscription({ paymentId: null, paymentReference: null })],
      [payment()],
      asOf,
    );
    expect(result.eligibleSubscriptions).toBe(0);
    expect(result.exclusions[0].reason).toBe("PAYMENT_LINK_MISSING");
  });

  it.each([
    ["TEST", "MATCHED", "PAID", "PAYMENT_NOT_ELIGIBLE"],
    ["LIVE", "UNRECONCILED", "PAID", "PAYMENT_NOT_ELIGIBLE"],
    ["LIVE", "MATCHED", "PENDING", "PAYMENT_NOT_ELIGIBLE"],
    ["UNKNOWN", "MATCHED", "PAID", "PAYMENT_NOT_ELIGIBLE"],
  ])("excludes non-eligible payment evidence", (environment, reconciliationStatus, status, reason) => {
    const result = calculateEvidenceGatedMrr(
      [subscription()],
      [payment({ environment, reconciliationStatus, status })],
      asOf,
    );
    expect(result.eligibleSubscriptions).toBe(0);
    expect(result.exclusions[0].reason).toBe(reason);
  });

  it("rejects identity, amount and currency mismatches independently", () => {
    const cases: Array<[Partial<RecurringPaymentEvidence>, string]> = [
      [{ businessId: "other-business" }, "PAYMENT_IDENTITY_MISMATCH"],
      [{ reference: "OTHER-REF" }, "PAYMENT_IDENTITY_MISMATCH"],
      [{ amount: 49_899 }, "PAYMENT_AMOUNT_MISMATCH"],
      [{ currency: "USD" }, "PAYMENT_CURRENCY_MISMATCH"],
    ];
    for (const [override, reason] of cases) {
      const result = calculateEvidenceGatedMrr([subscription()], [payment(override)], asOf);
      expect(result.eligibleSubscriptions).toBe(0);
      expect(result.exclusions[0].reason).toBe(reason);
    }
  });

  it("excludes expired, not-yet-effective, unsupported-term and incomplete snapshots", () => {
    const cases: Array<[Partial<RecurringSubscriptionEvidence>, string]> = [
      [{ expiresAt: new Date("2026-11-21T11:59:59.000Z") }, "OUTSIDE_EFFECTIVE_PERIOD"],
      [{ startAt: new Date("2026-11-22T00:00:00.000Z") }, "OUTSIDE_EFFECTIVE_PERIOD"],
      [{ recurringIntervalDays: 90 }, "UNSUPPORTED_INTERVAL"],
      [{ recurringDiscountKES: null }, "SNAPSHOT_INCOMPLETE"],
      [{ status: "CANCELLED" }, "NOT_ACTIVE"],
    ];
    for (const [override, reason] of cases) {
      const result = calculateEvidenceGatedMrr([subscription(override)], [payment()], asOf);
      expect(result.eligibleSubscriptions).toBe(0);
      expect(result.exclusions[0].reason).toBe(reason);
    }
  });

  it("refuses ambiguous duplicate payment identities", () => {
    expect(() => calculateEvidenceGatedMrr(
      [subscription()],
      [payment(), payment({ amount: 50_000 })],
      asOf,
    )).toThrow("MRR_PAYMENT_IDENTITY_AMBIGUOUS");
  });

  it("does not silently combine currencies or infer FX", () => {
    const result = calculateEvidenceGatedMrr(
      [subscription({ recurringCurrency: "USD" })],
      [payment({ currency: "USD" })],
      asOf,
    );
    expect(result.eligibleSubscriptions).toBe(0);
    expect(result.exclusions[0].reason).toBe("UNSUPPORTED_CURRENCY");
  });
});
