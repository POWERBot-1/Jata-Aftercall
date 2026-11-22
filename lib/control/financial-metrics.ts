export type RecurringSubscriptionMetricSource = {
  status: string;
  recurringAmountKES: number | null;
  recurringDiscountKES: number | null;
  recurringCurrency: string | null;
  recurringIntervalDays: number | null;
  payment: {
    status: string;
    environment: string;
    reconciliationStatus: string;
    providerSettledAt: Date | string | null;
    providerSettlementReference: string | null;
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

function hasSettlementEvidence(payment: RecurringSubscriptionMetricSource["payment"]): boolean {
  if (!payment || payment.status !== "PAID" || payment.environment !== "LIVE" || payment.reconciliationStatus !== "RECONCILED") return false;
  if (typeof payment.providerSettlementReference !== "string" || !payment.providerSettlementReference.trim()) return false;
  const settledAt = payment.providerSettledAt instanceof Date ? payment.providerSettledAt : new Date(payment.providerSettledAt ?? "");
  return Number.isFinite(settledAt.getTime());
}

/**
 * Calculate management run-rate only from immutable subscription-price snapshots
 * linked to a reconciled, live, settled payment. The owner-approved convention is
 * monthly consideration as-is for 30-day plans and annual consideration / 12 for
 * 365-day plans. Unknown intervals, currencies, missing snapshots and unreconciled
 * active rows make the aggregate unavailable rather than silently understating it.
 */
export function calculateRecurringRevenueMetrics(
  subscriptions: readonly RecurringSubscriptionMetricSource[],
): RecurringRevenueMetrics {
  const active = subscriptions.filter((row) => row.status === "ACTIVE");
  let included = 0;
  let excludedTest = 0;
  let incomplete = 0;
  let numerator = 0n;

  for (const row of active) {
    const payment = row.payment;
    if (payment?.environment === "TEST") {
      excludedTest += 1;
      continue;
    }
    if (!hasSettlementEvidence(payment)) {
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
      (interval !== 30 && interval !== 365)
    ) {
      incomplete += 1;
      continue;
    }

    const netRecurringKES = BigInt(amount - discount);
    numerator += interval === 365 ? netRecurringKES : netRecurringKES * 12n;
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
      note: "At least one active subscription lacks verified live settlement or a complete immutable recurring-price snapshot. The aggregate is withheld to avoid understating run-rate.",
    };
  }

  return {
    state: "VERIFIED",
    currency: "KES",
    activeSubscriptionCount: active.length,
    includedSubscriptionCount: included,
    excludedTestSubscriptionCount: excludedTest,
    incompleteSubscriptionCount: 0,
    mrrNumeratorKES: numerator.toString(),
    mrrDenominator: 12,
    arrKES: numerator.toString(),
    note: "MRR is the exact monthly-normalized recurring consideration (30-day price as-is; 365-day annual price divided by 12). ARR is MRR × 12. This is a management run-rate, not cash received or statutory revenue.",
  };
}
