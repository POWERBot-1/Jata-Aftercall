import { describe, expect, it } from "vitest";
import { summarizePaymentEntitlementLifecycle, type PaymentLifecycleEvidence, type EntitlementLifecycleEvidence } from "@/lib/admin/payment-entitlement-reconciliation";

const payment = (overrides: Partial<PaymentLifecycleEvidence> = {}) => ({
  id: "pay-1", businessId: "biz-1", reference: "ref-1", status: "PAID", purpose: "SUBSCRIPTION", amountMinor: 14900, currency: "KES", ...overrides,
});
const entitlement = (overrides: Partial<EntitlementLifecycleEvidence> = {}) => ({
  id: "ent-1", product: "PAGE", businessId: "biz-1", paymentId: "pay-1", paymentReference: "ref-1", status: "ACTIVE", ...overrides,
});

describe("payment-entitlement lifecycle inventory", () => {
  it("reports paid subscription payment without entitlement", () => {
    const result = summarizePaymentEntitlementLifecycle([payment()], []);
    expect(result.counts.PAID_PAYMENT_WITHOUT_ENTITLEMENT).toBe(1);
    expect(result.findings[0]).toEqual({ exception: "PAID_PAYMENT_WITHOUT_ENTITLEMENT", paymentId: "pay-1" });
    expect(result.scope).toBe("LIFECYCLE_INVENTORY_ONLY");
  });
  it("does not flag linked paid entitlement", () => {
    const result = summarizePaymentEntitlementLifecycle([payment()], [entitlement()]);
    expect(result.findings).toEqual([]);
  });
  it("reports entitlement linked to nonexistent payment", () => {
    const result = summarizePaymentEntitlementLifecycle([], [entitlement({ paymentId: "missing" })]);
    expect(result.counts.ENTITLEMENT_PAYMENT_NOT_FOUND).toBe(1);
  });
  it("reports active entitlement backed by failed/refunded payment", () => {
    const result = summarizePaymentEntitlementLifecycle([payment({ status: "REFUNDED" })], [entitlement()]);
    expect(result.counts.ENTITLEMENT_PAYMENT_NOT_PAID).toBe(1);
  });
  it("reports tenant/reference identity mismatch and does not treat it as valid linkage", () => {
    const result = summarizePaymentEntitlementLifecycle([payment()], [entitlement({ businessId: "other", paymentReference: "wrong" })]);
    expect(result.counts.ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH).toBe(1);
    expect(result.counts.PAID_PAYMENT_WITHOUT_ENTITLEMENT).toBe(1);
  });
  it("reports extra duplicate entitlement rows deterministically", () => {
    const result = summarizePaymentEntitlementLifecycle([payment()], [entitlement(), entitlement({ id: "ent-2" })]);
    expect(result.counts.DUPLICATE_ENTITLEMENT_FOR_PAYMENT).toBe(1);
  });
  it("rejects ambiguous duplicate payment IDs instead of silently choosing", () => {
    expect(() => summarizePaymentEntitlementLifecycle([payment(), payment()], [])).toThrow("PAYMENT_LIFECYCLE_PAYMENT_ID_AMBIGUOUS");
  });
  it("does not report orphaned pending payments as paid-payment exceptions", () => {
    const result = summarizePaymentEntitlementLifecycle([payment({ status: "PENDING" })], []);
    expect(result.counts.PAID_PAYMENT_WITHOUT_ENTITLEMENT).toBe(0);
  });
});
