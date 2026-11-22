import { describe, expect, it } from "vitest";
import {
  summarizeProductEntitlementLifecycle,
  type ProductLifecycleEvidence,
} from "@/lib/admin/product-entitlement-reconciliation";

const row = (overrides: Partial<ProductLifecycleEvidence> = {}): ProductLifecycleEvidence => ({
  product: "BUSINESS_POS",
  businessId: "biz-1",
  subscriptionId: "sub-1",
  subscriptionStatus: "ACTIVE",
  subscriptionExpiresAt: null,
  subscriptionGraceUntil: null,
  subscriptionCancelledAt: null,
  paymentId: "pay-1",
  paymentStatus: "PAID",
  paymentPlanId: "plan-1",
  paymentReference: "ref-1",
  subscriptionPaymentReference: "ref-1",
  paymentPurpose: "SUBSCRIPTION",
  paymentEnvironment: "LIVE",
  paymentReconciliationStatus: "MATCHED",
  providerSettledAt: new Date("2026-11-01T10:00:00.000Z"),
  providerSettlementReference: "ref-1",
  settledRefundMinor: null,
  settledChargebackMinor: null,
  subscriptionPlanId: "plan-1",
  paymentBusinessId: "biz-1",
  paymentUserId: "user-1",
  subscriptionUserId: "user-1",
  entitlementId: "ent-1",
  entitlementStatus: "ACTIVE",
  entitlementExpiresAt: null,
  asOf: new Date("2026-11-22T00:00:00.000Z"),
  teamFreeAccess: false,
  ...overrides,
});

describe("product entitlement reconciliation", () => {
  it("accepts a consistent paid active lifecycle", () => {
    expect(summarizeProductEntitlementLifecycle([row()]).findings).toEqual([]);
  });

  it("honours the exact subscription expiry boundary and explicit grace end", () => {
    const expiresAt = new Date("2026-11-20T00:00:00.000Z");
    const graceUntil = new Date("2026-11-23T00:00:00.000Z");
    const withinGrace = row({
      subscriptionStatus: "PAST_DUE",
      subscriptionExpiresAt: expiresAt,
      subscriptionGraceUntil: graceUntil,
      asOf: graceUntil,
    });
    expect(summarizeProductEntitlementLifecycle([withinGrace]).counts.ACTIVE_SUBSCRIPTION_PAST_VALIDITY).toBe(0);

    const afterGrace = row({
      subscriptionStatus: "PAST_DUE",
      subscriptionExpiresAt: expiresAt,
      subscriptionGraceUntil: graceUntil,
      asOf: new Date("2026-11-23T00:00:00.001Z"),
    });
    expect(summarizeProductEntitlementLifecycle([afterGrace]).counts.ACTIVE_SUBSCRIPTION_PAST_VALIDITY).toBe(1);
  });

  it("detects expired active entitlement and cancelled subscription state", () => {
    const expiredEntitlement = row({
      entitlementExpiresAt: new Date("2026-11-21T23:59:59.000Z"),
      asOf: new Date("2026-11-22T00:00:00.000Z"),
    });
    expect(summarizeProductEntitlementLifecycle([expiredEntitlement]).counts.ACTIVE_ENTITLEMENT_PAST_EXPIRY).toBe(1);

    const cancelled = row({ subscriptionStatus: "CANCELLED" });
    expect(summarizeProductEntitlementLifecycle([cancelled]).counts.ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION).toBe(1);
  });

  it("applies Autopilot's documented fallback grace and paid-through cancellation", () => {
    const expiry = new Date("2026-11-20T00:00:00.000Z");
    const inFallbackGrace = row({
      product: "AUTOPILOT",
      subscriptionExpiresAt: expiry,
      subscriptionGraceUntil: null,
      asOf: new Date("2026-11-22T00:00:00.000Z"),
    });
    expect(summarizeProductEntitlementLifecycle([inFallbackGrace]).counts.ACTIVE_SUBSCRIPTION_PAST_VALIDITY).toBe(0);
    expect(summarizeProductEntitlementLifecycle([inFallbackGrace]).counts.ACTIVE_ENTITLEMENT_PAST_EXPIRY).toBe(0);

    const cancelledButPaidThrough = row({
      product: "AUTOPILOT",
      subscriptionStatus: "CANCELLED",
      subscriptionExpiresAt: new Date("2026-11-24T00:00:00.000Z"),
      asOf: new Date("2026-11-22T00:00:00.000Z"),
    });
    expect(summarizeProductEntitlementLifecycle([cancelledButPaidThrough]).findings).toEqual([]);
  });

  it("treats ERP PRO's exact grace-until instant as expired", () => {
    const graceUntil = new Date("2026-11-23T00:00:00.000Z");
    const atBoundary = row({
      product: "ERP_PRO",
      subscriptionExpiresAt: new Date("2026-11-20T00:00:00.000Z"),
      subscriptionGraceUntil: graceUntil,
      entitlementExpiresAt: new Date("2026-11-20T00:00:00.000Z"),
      asOf: graceUntil,
    });
    const report = summarizeProductEntitlementLifecycle([atBoundary]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_PAST_VALIDITY).toBe(1);
    expect(report.counts.ACTIVE_ENTITLEMENT_PAST_EXPIRY).toBe(1);
  });

  it("does not treat a persisted cancellation timestamp alone as access revocation", () => {
    const paidThrough = row({
      subscriptionCancelledAt: new Date("2026-11-21T00:00:00.000Z"),
      subscriptionExpiresAt: new Date("2026-11-24T00:00:00.000Z"),
      asOf: new Date("2026-11-22T00:00:00.000Z"),
    });
    expect(summarizeProductEntitlementLifecycle([paidThrough]).findings).toEqual([]);
  });

  it("detects active subscription without entitlement", () => {
    const report = summarizeProductEntitlementLifecycle([row({ entitlementId: null, entitlementStatus: null })]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT).toBe(1);
  });

  it("does not misclassify verified team-free access as an orphaned subscription", () => {
    const teamFree = row({
      subscriptionId: null,
      subscriptionStatus: null,
      paymentId: null,
      entitlementStatus: "ACTIVE",
      teamFreeAccess: true,
    });
    expect(summarizeProductEntitlementLifecycle([teamFree]).findings).toEqual([]);
  });

  it("detects active entitlement without a subscription", () => {
    const report = summarizeProductEntitlementLifecycle([row({ subscriptionId: null, subscriptionStatus: null, paymentId: null })]);
    expect(report.counts.ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION).toBe(1);
  });

  it("detects active subscription paired with an inactive entitlement", () => {
    const report = summarizeProductEntitlementLifecycle([row({ entitlementStatus: "NONE" })]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITH_INACTIVE_ENTITLEMENT).toBe(1);
  });

  it("detects active entitlement paired with an inactive subscription", () => {
    const report = summarizeProductEntitlementLifecycle([row({ subscriptionStatus: "EXPIRED" })]);
    expect(report.counts.ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION).toBe(1);
  });

  it("detects active subscription without paid payment evidence", () => {
    const report = summarizeProductEntitlementLifecycle([row({ paymentStatus: "PENDING" })]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT).toBe(1);
  });

  it("detects dangling payment references separately from unpaid payments", () => {
    const report = summarizeProductEntitlementLifecycle([row({ paymentStatus: null })]);
    expect(report.counts.LINKED_PAYMENT_RECORD_NOT_FOUND).toBe(1);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT).toBe(1);
  });

  it("detects payment tenant and owner mismatch", () => {
    const report = summarizeProductEntitlementLifecycle([row({ paymentBusinessId: "biz-other" })]);
    expect(report.counts.PAYMENT_TENANT_OR_OWNER_MISMATCH).toBe(1);
  });

  it("rejects PAID payments without live provider reconciliation", () => {
    const cases = [
      row({ paymentEnvironment: "UNKNOWN" }),
      row({ paymentEnvironment: "TEST" }),
      row({ paymentReconciliationStatus: "UNRECONCILED" }),
      row({ providerSettledAt: null }),
      row({ providerSettlementReference: "provider-other-ref" }),
      row({ settledRefundMinor: BigInt(1) }),
      row({ settledChargebackMinor: BigInt(1) }),
    ];
    for (const evidence of cases) {
      const report = summarizeProductEntitlementLifecycle([evidence]);
      expect(report.counts.PAYMENT_SETTLEMENT_UNVERIFIED).toBe(1);
    }
  });

  it("detects a linked paid payment from a different product plan", () => {
    const report = summarizeProductEntitlementLifecycle([row({ paymentPlanId: "other-plan" })]);
    expect(report.counts.PAYMENT_PROVENANCE_MISMATCH).toBe(1);
  });

  it("detects payment purpose and reference mismatches", () => {
    const report = summarizeProductEntitlementLifecycle([
      row({ paymentPurpose: "ORDER" }),
      row({ businessId: "biz-2", paymentReference: "other-ref" }),
    ]);
    expect(report.counts.PAYMENT_PROVENANCE_MISMATCH).toBe(2);
  });

  it("fails closed when payment tenant or owner identity is missing", () => {
    const report = summarizeProductEntitlementLifecycle([
      row({ paymentBusinessId: null }),
      row({ businessId: "biz-2", paymentUserId: null }),
    ]);
    expect(report.counts.PAYMENT_TENANT_OR_OWNER_MISMATCH).toBe(2);
  });

  it("rejects duplicate product/business lifecycle rows", () => {
    const report = summarizeProductEntitlementLifecycle([row(), row()]);
    expect(report.counts.DUPLICATE_PRODUCT_LIFECYCLE).toBe(1);
  });

  it("reports products not yet covered rather than implying complete coverage", () => {
    const report = summarizeProductEntitlementLifecycle([row()], ["BUSINESS_PAGE"]);
    expect(report.excludedProducts).toContain("BUSINESS_PAGE");
  });
});
