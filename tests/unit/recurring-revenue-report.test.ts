import { describe, expect, it, vi } from "vitest";
import { readEvidenceGatedMrr } from "@/lib/admin/recurring-revenue-report";

const asOf = new Date("2026-11-21T12:00:00.000Z");
const sub = {
  businessId: "biz-1",
  planId: "plan-1",
  plan: { key: "MONTHLY" },
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

function client(sharedSubscriptionRows: any[] = [sub], paymentRows: any[] = [pay]) {
  const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  return {
    subscription: { findMany: vi.fn().mockResolvedValue(sharedSubscriptionRows) },
    posSubscription: empty(),
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
    expect(db.subscription.findMany).toHaveBeenCalledWith({
      select: expect.objectContaining({ plan: { select: { key: true } } }),
    });
    expect(db.posSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.autopilotSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.mjengoSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.erpSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(db.erpProSubscription.findMany).toHaveBeenCalledTimes(1);
  });

  it("includes each dedicated subscription family only through its own exact payment link", async () => {
    const products = [
      ["posSubscription", "BUSINESS_POS"],
      ["autopilotSubscription", "AUTOPILOT"],
      ["mjengoSubscription", "MJENGO_OS"],
      ["erpSubscription", "ERP_LEGACY"],
      ["erpProSubscription", "ERP_PRO"],
    ] as const;
    const paymentRows = products.map((_, index) => ({
      ...pay,
      id: `pay-${index + 1}`,
      businessId: `biz-${index + 1}`,
      planId: `plan-${index + 1}`,
      reference: `JATA-${index + 1}`,
      providerSettlementReference: `JATA-${index + 1}`,
    }));
    const db: any = client([], paymentRows);
    products.forEach(([model, planKey], index) => {
      db[model].findMany.mockResolvedValue([{
        ...sub,
        businessId: `biz-${index + 1}`,
        planId: `plan-${index + 1}`,
        planKey,
        paymentId: `pay-${index + 1}`,
        paymentReference: `JATA-${index + 1}`,
      }]);
    });

    const result = await readEvidenceGatedMrr(db, asOf);
    expect(result.eligibleSubscriptions).toBe(5);
    expect(result.mrrMinor).toBe(5 * 14900);
  });

  it("includes only authoritative Business Page keys from the shared Subscription model", async () => {
    const db = client([
      sub,
      { ...sub, businessId: "front-desk", planId: "front-desk-plan", plan: { key: "AI_BUSINESS_FRONT_DESK" } },
      { ...sub, businessId: "website-studio", planId: "website-plan", plan: { key: "INTERACTIVE_BUSINESS" } },
      { ...sub, businessId: "unknown-plan", planId: "unknown-plan", plan: null },
    ]);
    const result = await readEvidenceGatedMrr(db, asOf);
    expect(result.eligibleSubscriptions).toBe(1);
    expect(result.mrrMinor).toBe(14900);
    expect(result.exclusions.filter((row) => row.reason === "PRODUCT_NOT_INCLUDED")).toHaveLength(3);
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
