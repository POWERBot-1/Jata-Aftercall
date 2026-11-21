/**
 * Product entitlement integrity classifier.
 * Normalized evidence only: no writes, access grants, revocations, or payment-state inference.
 */
export type ProductKey =
  | "BUSINESS_PAGE"
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
  paymentBusinessId: string | null;
  paymentUserId: string | null;
  subscriptionUserId: string | null;
  entitlementId: string | null;
  entitlementStatus: string | null;
};

export type ProductEntitlementException =
  | "ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT"
  | "ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION"
  | "ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION"
  | "ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT"
  | "PAYMENT_TENANT_OR_OWNER_MISMATCH"
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

const activeSubscription = (s: string | null) => s === "ACTIVE" || s === "EXPIRING";
const activeEntitlement = (s: string | null) => s === "ACTIVE" || s === "LIVE" || s === "GRACE";

export function summarizeProductEntitlementLifecycle(
  evidence: ProductLifecycleEvidence[],
  excludedProducts: string[] = ["WEBSITE_STUDIO"],
): ProductEntitlementReport {
  const counts: ProductEntitlementReport["counts"] = {
    ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT: 0,
    ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION: 0,
    ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION: 0,
    ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT: 0,
    PAYMENT_TENANT_OR_OWNER_MISMATCH: 0,
    DUPLICATE_PRODUCT_LIFECYCLE: 0,
  };
  const findings: ProductEntitlementFinding[] = [];
  const grouped = new Map<string, ProductLifecycleEvidence[]>();
  const push = (f: ProductEntitlementFinding) => {
    findings.push(f);
    counts[f.exception] += 1;
  };

  for (const row of evidence) {
    if (!row.businessId) throw new Error("PRODUCT_ENTITLEMENT_BUSINESS_ID_REQUIRED");
    const key = row.product + ":" + row.businessId;
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }

  for (const rows of grouped.values()) {
    const row = rows[0];
    if (rows.length > 1) {
      push({ exception: "DUPLICATE_PRODUCT_LIFECYCLE", product: row.product, businessId: row.businessId });
      continue;
    }

    const subActive = activeSubscription(row.subscriptionStatus);
    const entitlementActive = activeEntitlement(row.entitlementStatus);

    if (subActive && !row.entitlementId) {
      push({ exception: "ACTIVE_SUBSCRIPTION_WITHOUT_ENTITLEMENT", product: row.product, businessId: row.businessId, subscriptionId: row.subscriptionId ?? undefined });
    }
    if (entitlementActive && !row.subscriptionId) {
      push({ exception: "ACTIVE_ENTITLEMENT_WITHOUT_SUBSCRIPTION", product: row.product, businessId: row.businessId, entitlementId: row.entitlementId ?? undefined });
    } else if (entitlementActive && !subActive) {
      push({ exception: "ACTIVE_ENTITLEMENT_WITH_INACTIVE_SUBSCRIPTION", product: row.product, businessId: row.businessId, subscriptionId: row.subscriptionId ?? undefined, entitlementId: row.entitlementId ?? undefined });
    }

    if (subActive && row.paymentId && row.paymentStatus !== "PAID") {
      push({ exception: "ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT", product: row.product, businessId: row.businessId, subscriptionId: row.subscriptionId ?? undefined, paymentId: row.paymentId });
    }
    if (subActive && !row.paymentId) {
      push({ exception: "ACTIVE_SUBSCRIPTION_WITHOUT_PAID_PAYMENT", product: row.product, businessId: row.businessId, subscriptionId: row.subscriptionId ?? undefined });
    }
    if (row.paymentId && (
      (row.paymentBusinessId !== null && row.paymentBusinessId !== row.businessId) ||
      (row.paymentUserId !== null && row.subscriptionUserId !== null && row.paymentUserId !== row.subscriptionUserId)
    )) {
      push({ exception: "PAYMENT_TENANT_OR_OWNER_MISMATCH", product: row.product, businessId: row.businessId, subscriptionId: row.subscriptionId ?? undefined, paymentId: row.paymentId });
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
