import { describe, expect, it, vi } from "vitest";
import { readEvidenceGatedMrr } from "@/lib/admin/recurring-revenue-report";

const asOf = new Date("2026-11-21T12:00:00.000Z");
const sub = {
  businessId: "biz-1",
  planId: "plan-1",
  planKey: "BUSINESS_PAGE",
  status: "ACTIVE",
  startAt: new Date("2026-11-01T00:00:00.000Z"),
  expiresAt: new Date("2026-12-01T00:00:00.000Z"),
  recurringAmountKES: 149,
  recurringDiscountKES: 0,
  recurringCurrency: "KES",
  recurringIntervalDays: 30,
  recurringPriceEffectiveAt: new Date("2026-11-01T00:00:00.000Z"),
  paymentId: "pay-1",
  paymentReference: "JATA-1",
};
const pay = {
  id: "pay-1",
  businessId: "biz-1",
  planId: "plan-1",
  reference: "JATA-1",
  purpose: "SUBSCRIPTION",
  status: "PAID",
  environment: "LIVE",
  amount: 14900,
  currency: "KES",
  providerSettledAt: new Date("2026-11-02T00:00:00.000Z"),
  providerSettlementReference: "JATA-1",
  reconciliationStatus: "MATCHED",
};

function client(baseSubscriptionRows: any[] = [sub], paymentRows: any[] = [pay]) {
  const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  return {
    subscription: empty(),
    posSubscription: { findMany: vi.fn().mockResolvedValue(baseSubscriptionRows) },
    autopilotSubscription: empty(),
    mjengoSubscription: empty(),
    erpSubscription: empty(),
    erpProSubscription: empty(),
    payment: { findMany: vi.fn().mockResolvedValue(paymentRows) },
  };
}

describe("readEvidenceGatedMrr", () => {
  it("loads all supported subscription families and joins only exact payment IDs", async () => {
    const db = client();
    const result = await readEvidenceGatedMrr(db, asOf);
    expect(result.eligibleSubscriptions).toBe(1);
    expect(result.mrrMinor).toBe(14900);
    expect(db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["pay-1"] } },
    }));
    expect(db.posSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.autopilotSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.mjengoSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.erpSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.erpProSubscription.findMany).toHaveBeenCalledTimes(1);
  });

  it("does not query payments or infer links for legacy subscriptions", async () => {
    const db = client([{ ...sub, paymentId: null, paymentReference: null }], []);
    const result = await readEvidenceGatedMrr(db, asOf);
    expect(db.payment.findMany).not.toHaveBeenCalled();
    expect(result.eligibleSubscriptions).toBe(0);
    expect(result.exclusions[0].reason).toBe("PAYMENT_LINK_MISSING");
  });

  it("excludes a locally PAID but unreconciled payment", async () => {
    const db = client([sub], [{ ...pay, reconciliationStatus: "UNRECONCILED" }]);
    const result = await readEvidenceGatedMrr(db, asOf);
    expect(result.eligibleSubscriptions).toBe(0);
    expect(result.exclusions[0].reason).toBe("PAYMENT_NOT_ELIGIBLE");
  });

  it("fails closed when a subscription source is unavailable", async () => {
    const db: any = client();
    delete db.erpProSubscription;
    await expect(readEvidenceGatedMrr(db, asOf)).rejects.toThrow("MRR_SUBSCRIPTION_SOURCE_UNAVAILABLE:erpProSubscription");
  });

  it("returns no inferred MRR when there are no subscription records", async () => {
    const db = client([], []);
    const result = await readEvidenceGatedMrr(db, asOf);
    expect(result.eligibleSubscriptions).toBe(0);
    expect(result.mrrMinor).toBe(0);
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
});
