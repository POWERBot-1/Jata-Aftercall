/**
 * Product entitlement integrity classifier.
 * Normalized evidence only: no writes, access grants, revocations, or payment-state inference.
 */
export type ProductKey =
  | "WEBSITE_STUDIO"
  | "AI_FRONT_DESK"
  | "BUSINESS_POS"
  | "AUTOPILOT"
  | "MJENGO_OS"
  | "ERP_PRO";

export type ProductLifecycleEvidence = {
  product: ProductKey;
  businessId: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  paymentPlanId: string | null;
  paymentReference: string | null;
  subscriptionPaymentReference: string | null;
  paymentPurpose: string | null;
  paymentEnvironment: string | null;
  paymentReconciliationStatus: string | null;
  providerSettledAt: Date | null;
  providerSettlementReference: string | null;
  settledRefundMinor: bigint | null;
  settledChargebackMinor: bigint | null;
  subscriptionPlanId: string | null;
  paymentBusinessId: string | null;
  paymentUserId: string | null;
  subscriptionUserId: string | null;
  entitlementId: string | null;
  entitlementStatus: string | null;
};

export type ProductEntitlementException =
  | "ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT"
  | "ACTIVE_SUBSCRIPTION_WITH_INACTIVE_ENTITLEMENT"
  | "ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION"
  | "ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION"
  | "ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT"
  | "LINKED_PAYMENT_RECORD_NOT_FOUND"
  | "PAYMENT_TENANT_OR_OWNER_MISMATCH"
  | "PAYMENT_PROVENANCE_MISMATCH"
  | "PAYMENT_SETTLEMENT_UNVERIFIED"
  | "DUPLICATE_PRODUCT_LIFECYCLE";

export type ProductEntitlementFinding = {
  exception: ProductEntitlementException;
  product: ProductKey;
  businessId: string;
  subscriptionId?: string;
  entitlementId?: string;
  paymentId?: string;
};

export type ProductEntitlementReport = {
  productsReviewed: number;
  businessProductPairsReviewed: number;
  findings: ProductEntitlementFinding[];
  counts: Record<ProductEntitlementException, number>;
  scope: "READ_ONLY_PRODUCT_ENTITLEMENT_INVENTORY";
  excludedProducts: string[];
};

const activeSubscription = (status: string | null) =>
  status === "ACTIVE" || status === "EXPIRING" || status === "PAST_DUE";
const activeEntitlement = (status: string | null) =>
  status === "ACTIVE" || status === "LIVE" || status === "GRACE" || status === "PAST_DUE";

export function summarizeProductEntitlementLifecycle(
  evidence: ProductLifecycleEvidence[],
  excludedProducts: string[] = ["BUSINESS_PAGE", "LEGACY_ERP"],
): ProductEntitlementReport {
  const counts: ProductEntitlementReport["counts"] = {
    ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT: 0,
    ACTIVE_SUBSCRIPTION_WITH_INACTIVE_ENTITLEMENT: 0,
    ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION: 0,
    ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION: 0,
    ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT: 0,
    LINKED_PAYMENT_RECORD_NOT_FOUND: 0,
    PAYMENT_TENANT_OR_OWNER_MISMATCH: 0,
    PAYMENT_PROVENANCE_MISMATCH: 0,
    PAYMENT_SETTLEMENT_UNVERIFIED: 0,
    DUPLICATE_PRODUCT_LIFECYCLE: 0,
  };
  const findings: ProductEntitlementFinding[] = [];
  const grouped = new Map<string, ProductLifecycleEvidence[]>();
  const push = (finding: ProductEntitlementFinding) => {
    findings.push(finding);
    counts[finding.exception] += 1;
  };

  for (const row of evidence) {
    if (!row.businessId) throw new Error("PRODUCT_ENTITLEMENT_BUSINESS_ID_REQUIRED");
    const key = row.product + ":" + row.businessId;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  for (const rows of grouped.values()) {
    const row = rows[0];
    if (rows.length > 1) {
      push({ exception: "DUPLICATE_PRODUCT_LIFECYCLE", product: row.product, businessId: row.businessId });
      continue;
    }

    const subscriptionIsActive = activeSubscription(row.subscriptionStatus);
    const entitlementIsActive = activeEntitlement(row.entitlementStatus);

    if (subscriptionIsActive && !row.entitlementId) {
      push({
        exception: "ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
      });
    } else if (subscriptionIsActive && row.entitlementId && !entitlementIsActive) {
      push({
        exception: "ACTIVE_SUBSCRIPTION_WITH_INACTIVE_ENTITLEMENT",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        entitlementId: row.entitlementId,
      });
    }

    if (entitlementIsActive && !row.subscriptionId) {
      push({
        exception: "ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION",
        product: row.product,
        businessId: row.businessId,
        entitlementId: row.entitlementId ?? undefined,
      });
    } else if (entitlementIsActive && !subscriptionIsActive) {
      push({
        exception: "ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        entitlementId: row.entitlementId ?? undefined,
      });
    }

    if (row.paymentId && row.paymentStatus === null) {
      push({
        exception: "LINKED_PAYMENT_RECORD_NOT_FOUND",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        paymentId: row.paymentId,
      });
    }

    if (subscriptionIsActive && (!row.paymentId || row.paymentStatus !== "PAID")) {
      push({
        exception: "ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        paymentId: row.paymentId ?? undefined,
      });
    }

    const hasVerifiedSettlement = Boolean(
      row.paymentStatus === "PAID" &&
      row.paymentEnvironment === "LIVE" &&
      row.paymentReconciliationStatus === "MATCHED" &&
      row.providerSettledAt instanceof Date &&
      !Number.isNaN(row.providerSettledAt.getTime()) &&
      Boolean(row.paymentReference) &&
      row.providerSettlementReference === row.paymentReference &&
      (row.settledRefundMinor === null || row.settledRefundMinor <= BigInt(0)) &&
      (row.settledChargebackMinor === null || row.settledChargebackMinor <= BigInt(0))
    );

    if (row.paymentId && row.paymentStatus !== null && !hasVerifiedSettlement) {
      push({
        exception: "PAYMENT_SETTLEMENT_UNVERIFIED",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        paymentId: row.paymentId,
      });
    }

    if (row.paymentId && row.paymentStatus !== null && (
      !row.subscriptionPlanId ||
      !row.paymentPlanId ||
      row.paymentPlanId !== row.subscriptionPlanId ||
      row.paymentPurpose !== "SUBSCRIPTION" ||
      (row.subscriptionPaymentReference !== null && row.paymentReference !== row.subscriptionPaymentReference)
    )) {
      push({
        exception: "PAYMENT_PROVENANCE_MISMATCH",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        paymentId: row.paymentId,
      });
    }

    if (row.paymentId && (
      // Null identity fields are unverified evidence, not a successful match.
      row.paymentBusinessId !== row.businessId ||
      row.paymentUserId !== row.subscriptionUserId
    )) {
      push({
        exception: "PAYMENT_TENANT_OR_OWNER_MISMATCH",
        product: row.product,
        businessId: row.businessId,
        subscriptionId: row.subscriptionId ?? undefined,
        paymentId: row.paymentId,
      });
    }
  }

  return {
    productsReviewed: new Set(evidence.map((row) => row.product)).size,
    businessProductPairsReviewed: grouped.size,
    findings,
    counts,
    scope: "READ_ONLY_PRODUCT_ENTITLEMENT_INVENTORY",
    excludedProducts: [...excludedProducts],
  };
}
