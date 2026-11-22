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
  ...overrides,
});

describe("product entitlement reconciliation", () => {
  it("accepts a consistent paid active lifecycle", () => {
    expect(summarizeProductEntitlementLifecycle([row()]).findings).toEqual([]);
  });

  it("detects active subscription without entitlement", () => {
    const report = summarizeProductEntitlementLifecycle([row({ entitlementId: null, entitlementStatus: null })]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT).toBe(1);
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
