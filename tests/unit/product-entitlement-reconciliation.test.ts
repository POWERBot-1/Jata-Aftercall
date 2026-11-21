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

  it("detects active entitlement paired with an inactive subscription", () => {
    const report = summarizeProductEntitlementLifecycle([row({ subscriptionStatus: "EXPIRED" })]);
    expect(report.counts.ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION).toBe(1);
  });

  it("detects active subscription without paid payment evidence", () => {
    const report = summarizeProductEntitlementLifecycle([row({ paymentStatus: "PENDING" })]);
    expect(report.counts.ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT).toBe(1);
  });

  it("detects payment tenant and owner mismatch", () => {
    const report = summarizeProductEntitlementLifecycle([row({ paymentBusinessId: "biz-other" })]);
    expect(report.counts.PAYMENT_TENANT_OR_OWNER_MISMATCH).toBe(1);
  });

  it("rejects duplicate product/business lifecycle rows", () => {
    const report = summarizeProductEntitlementLifecycle([row(), row()]);
    expect(report.counts.DUPLICATE_PRODUCT_LIFECYCLE).toBe(1);
  });

  it("reports products not yet covered rather than implying complete coverage", () => {
    const report = summarizeProductEntitlementLifecycle([row()], ["WEBSITE_STUDIO"]);
    expect(report.excludedProducts).toContain("WEBSITE_STUDIO");
  });
});
