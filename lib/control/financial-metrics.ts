export type RecurringSubscriptionMetricSource = {
  status: string;
  businessId: string;
  planId: string;
  paymentId: string | null;
  paymentReference: string | null;
  recurringAmountKES: number | null;
  recurringDiscountKES: number | null;
  recurringCurrency: string | null;
  recurringIntervalDays: number | null;
  recurringPriceEffectiveAt: Date | string | null;
  payment: {
    id: string;
    businessId: string | null;
    planId: string | null;
    reference: string;
    status: string;
    environment: string;
    currency: string;
    paystackId: string | null;
    providerSettledAt: Date | string | null;
    providerSettlementReference: string | null;
    settledRefundMinor: unknown;
    settledChargebackMinor: unknown;
    reconciliationStatus: string;
    reconciledAt: Date | string | null;
  } | null;
};

export type RecurringRevenueMetrics = {
  state: "VERIFIED" | "UNAVAILABLE";
  currency: "KES";
  activeSubscriptionCount: number;
  includedSubscriptionCount: number;
  excludedTestSubscriptionCount: number;
  incompleteSubscriptionCount: number;
  /** Exact MRR = numerator / denominator. No undocumented rounding is applied. */
  mrrNumeratorKES: string | null;
  mrrDenominator: 12;
  /** Exact ARR = MRR × 12, represented as an integer KES string. */
  arrKES: string | null;
  note?: string;
};

function isExplicitZero(value: unknown): boolean {
  return value !== null && value !== undefined && String(value) === "0";
}

function hasSettlementAndLinkageEvidence(row: RecurringSubscriptionMetricSource): boolean {
  const payment = row.payment;
  if (!payment || payment.status !== "PAID" || payment.environment !== "LIVE" || payment.currency !== "KES") return false;
  if (!row.paymentId || payment.id !== row.paymentId) return false;
  if (!row.paymentReference || payment.reference !== row.paymentReference) return false;
  if (payment.businessId !== row.businessId || payment.planId !== row.planId) return false;
  if (payment.providerSettlementReference !== payment.reference) return false;
  if (payment.reconciliationStatus !== "RECONCILED") return false;
  const reconciledAt = payment.reconciledAt instanceof Date ? payment.reconciledAt : new Date(payment.reconciledAt ?? "");
  if (!Number.isFinite(reconciledAt.getTime())) return false;
  if (typeof payment.paystackId !== "string" || !payment.paystackId.trim()) return false;
  if (!isExplicitZero(payment.settledRefundMinor) || !isExplicitZero(payment.settledChargebackMinor)) return false;
  const settledAt = payment.providerSettledAt instanceof Date ? payment.providerSettledAt : new Date(payment.providerSettledAt ?? "");
  return Number.isFinite(settledAt.getTime());
}

/**
 * Calculate platform management run-rate across the six persisted product subscription models only from immutable subscription-price snapshots
 * linked by payment id/reference, business and plan to a verified live provider
 * settlement. Any settled refund/chargeback, unknown environment, broken linkage,
 * missing snapshot or unsupported interval makes the aggregate unavailable.
 *
 * Owner-approved normalization: 30-day recurring price as-is; 365-day annual
 * recurring price divided by 12. The integer numerator / 12 representation avoids
 * introducing an undocumented rounding rule.
 */
export function calculateRecurringRevenueMetrics(
  subscriptions: readonly RecurringSubscriptionMetricSource[],
): RecurringRevenueMetrics {
  const active = subscriptions.filter((row) => row.status === "ACTIVE");
  let included = 0;
  let excludedTest = 0;
  let incomplete = 0;
  let numerator = 0;
  const seenPaymentIds = new Set<string>();

  for (const row of active) {
    if (row.payment?.environment === "TEST") {
      excludedTest += 1;
      continue;
    }
    if (!row.paymentId || seenPaymentIds.has(row.paymentId)) {
      incomplete += 1;
      continue;
    }
    seenPaymentIds.add(row.paymentId);
    if (!hasSettlementAndLinkageEvidence(row)) {
      incomplete += 1;
      continue;
    }

    const amount = row.recurringAmountKES;
    const discount = row.recurringDiscountKES;
    const interval = row.recurringIntervalDays;
    if (
      !Number.isSafeInteger(amount) || amount === null || amount <= 0 ||
      !Number.isSafeInteger(discount) || discount === null || discount < 0 || discount > amount ||
      row.recurringCurrency !== "KES" ||
      !Number.isFinite((row.recurringPriceEffectiveAt instanceof Date ? row.recurringPriceEffectiveAt : new Date(row.recurringPriceEffectiveAt ?? "")).getTime()) ||
      (interval !== 30 && interval !== 365)
    ) {
      incomplete += 1;
      continue;
    }

    const netRecurringKES = amount - discount;
    const addition = interval === 365 ? netRecurringKES : netRecurringKES * 12;
    const nextNumerator = numerator + addition;
    if (!Number.isSafeInteger(nextNumerator)) {
      incomplete += 1;
      continue;
    }
    numerator = nextNumerator;
    included += 1;
  }

  if (incomplete > 0) {
    return {
      state: "UNAVAILABLE",
      currency: "KES",
      activeSubscriptionCount: active.length,
      includedSubscriptionCount: included,
      excludedTestSubscriptionCount: excludedTest,
      incompleteSubscriptionCount: incomplete,
      mrrNumeratorKES: null,
      mrrDenominator: 12,
      arrKES: null,
      note: "At least one active subscription lacks verified live settlement, matching immutable payment linkage, a complete recurring-price snapshot including its effective timestamp, or explicit zero-refund/chargeback values and a completed reconciliation timestamp. The aggregate is withheld rather than understated.",
    };
  }

  return {
    state: "VERIFIED",
    currency: "KES",
    activeSubscriptionCount: active.length,
    includedSubscriptionCount: included,
    excludedTestSubscriptionCount: excludedTest,
    incompleteSubscriptionCount: 0,
    mrrNumeratorKES: String(numerator),
    mrrDenominator: 12,
    arrKES: String(numerator),
    note: "MRR is the exact monthly-normalized recurring consideration (30-day price as-is; 365-day annual price divided by 12). ARR is MRR × 12. Payment, subscription, business, plan and provider identifiers were reconciled in the read model. This is a management run-rate, not cash received or statutory revenue.",
  };
}
