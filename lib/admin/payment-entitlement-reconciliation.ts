/**
 * Pure inventory classifier for payment-to-entitlement lifecycle integrity.
 * Read-only: no entitlement repair, payment mutation, or inferred activation.
 */
export type PaymentLifecycleEvidence = {
  id: string;
  businessId: string | null;
  reference: string;
  status: string;
  purpose: string;
  amountMinor: number;
  currency: string;
};
export type EntitlementLifecycleEvidence = {
  id: string;
  product: string;
  businessId: string;
  paymentId: string | null;
  paymentReference: string | null;
  status: string;
};
export type PaymentEntitlementException =
  | "PAID_PAYMENT_WITHOUT_ENTITLEMENT"
  | "ENTITLEMENT_PAYMENT_NOT_FOUND"
  | "ENTITLEMENT_PAYMENT_NOT_PAID"
  | "ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH"
  | "DUPLICATE_ENTITLEMENT_FOR_PAYMENT";
export type PaymentEntitlementFinding = {
  exception: PaymentEntitlementException;
  paymentId?: string;
  entitlementId?: string;
  product?: string;
};
export type PaymentEntitlementReport = {
  paymentsReviewed: number;
  entitlementsReviewed: number;
  findings: PaymentEntitlementFinding[];
  counts: Record<PaymentEntitlementException, number>;
  scope: "LIFECYCLE_INVENTORY_ONLY";
};

const activeStatuses = new Set(["ACTIVE", "LIVE"]);
const paidStatuses = new Set(["PAID"]);
const emptyCounts = (): PaymentEntitlementReport["counts"] => ({
  PAID_PAYMENT_WITHOUT_ENTITLEMENT: 0,
  ENTITLEMENT_PAYMENT_NOT_FOUND: 0,
  ENTITLEMENT_PAYMENT_NOT_PAID: 0,
  ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH: 0,
  DUPLICATE_ENTITLEMENT_FOR_PAYMENT: 0,
});

export function summarizePaymentEntitlementLifecycle(
  payments: PaymentLifecycleEvidence[],
  entitlements: EntitlementLifecycleEvidence[],
): PaymentEntitlementReport {
  const paymentById = new Map<string, PaymentLifecycleEvidence>();
  for (const payment of payments) {
    if (!payment.id || paymentById.has(payment.id)) throw new Error("PAYMENT_LIFECYCLE_PAYMENT_ID_AMBIGUOUS");
    paymentById.set(payment.id, payment);
  }
  const findings: PaymentEntitlementFinding[] = [];
  const counts = emptyCounts();
  const push = (finding: PaymentEntitlementFinding) => {
    findings.push(finding);
    counts[finding.exception] += 1;
  };
  const entitlementByPaymentProduct = new Map<string, EntitlementLifecycleEvidence[]>();
  const linkedPaymentIds = new Set<string>();

  for (const entitlement of entitlements) {
    const paymentId = entitlement.paymentId;
    if (!paymentId) {
      if (activeStatuses.has(entitlement.status)) push({ exception: "ENTITLEMENT_PAYMENT_NOT_FOUND", entitlementId: entitlement.id, product: entitlement.product });
      continue;
    }
    const payment = paymentById.get(paymentId);
    if (!payment) {
      push({ exception: "ENTITLEMENT_PAYMENT_NOT_FOUND", entitlementId: entitlement.id, product: entitlement.product, paymentId });
      continue;
    }
    if (payment.businessId !== entitlement.businessId || (entitlement.paymentReference && payment.reference !== entitlement.paymentReference)) {
      push({ exception: "ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH", entitlementId: entitlement.id, product: entitlement.product, paymentId });
      continue;
    }
    const key = paymentId + ":" + entitlement.product;
    const rows = entitlementByPaymentProduct.get(key) ?? [];
    rows.push(entitlement);
    entitlementByPaymentProduct.set(key, rows);
    linkedPaymentIds.add(paymentId);
    if (activeStatuses.has(entitlement.status) && !paidStatuses.has(payment.status)) {
      push({ exception: "ENTITLEMENT_PAYMENT_NOT_PAID", entitlementId: entitlement.id, product: entitlement.product, paymentId });
    }
  }
  for (const rows of entitlementByPaymentProduct.values()) {
    if (rows.length > 1) {
      for (const extra of rows.slice(1)) push({ exception: "DUPLICATE_ENTITLEMENT_FOR_PAYMENT", entitlementId: extra.id, product: extra.product, paymentId: extra.paymentId ?? undefined });
    }
  }
  for (const payment of payments) {
    if (payment.status === "PAID" && payment.purpose === "SUBSCRIPTION" && !linkedPaymentIds.has(payment.id)) {
      push({ exception: "PAID_PAYMENT_WITHOUT_ENTITLEMENT", paymentId: payment.id });
    }
  }
  return {
    paymentsReviewed: payments.length,
    entitlementsReviewed: entitlements.length,
    findings,
    counts,
    scope: "LIFECYCLE_INVENTORY_ONLY",
  };
}
