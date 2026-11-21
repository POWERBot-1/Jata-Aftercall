/**
 * Evidence-gated recurring revenue projection.
 *
 * This module is deliberately a pure calculation boundary. Callers must supply the
 * subscription snapshot and its exact Payment row; it does not query or mutate a DB.
 * Missing provenance is an exclusion, never a zero-valued or inferred payment.
 *
 * Amount snapshots are whole KES. Payment.amount is minor units (kobo).
 * MRR is returned in minor units as a number; annual subscriptions are normalized
 * over 12 months. No FX conversion is performed.
 */

export type RecurringSubscriptionEvidence = {
  product: string;
  businessId: string;
  planId: string;
  planKey: string;
  status: string;
  startAt: Date | null;
  expiresAt: Date | null;
  recurringAmountKES: number | null;
  recurringDiscountKES: number | null;
  recurringCurrency: string | null;
  recurringIntervalDays: number | null;
  recurringPriceEffectiveAt: Date | null;
  paymentId: string | null;
  paymentReference: string | null;
};

export type RecurringPaymentEvidence = {
  id: string;
  businessId: string | null;
  planId: string | null;
  reference: string;
  purpose: string;
  status: string;
  environment: string;
  amount: number;
  currency: string;
  providerSettledAt: Date | null;
  providerSettlementReference: string | null;
  reconciliationStatus: string;
};

export type RecurringRevenueExclusion = {
  product: string;
  businessId: string;
  reason:
    | "NOT_ACTIVE"
    | "OUTSIDE_EFFECTIVE_PERIOD"
    | "SNAPSHOT_INCOMPLETE"
    | "INVALID_SNAPSHOT"
    | "UNSUPPORTED_INTERVAL"
    | "PAYMENT_LINK_MISSING"
    | "PAYMENT_NOT_FOUND"
    | "PAYMENT_IDENTITY_MISMATCH"
    | "PAYMENT_NOT_ELIGIBLE"
    | "PAYMENT_AMOUNT_MISMATCH"
    | "PAYMENT_CURRENCY_MISMATCH"
    | "UNSUPPORTED_CURRENCY";
};

export type RecurringRevenueResult = {
  asOf: string;
  currency: "KES";
  eligibleSubscriptions: number;
  /** Exact MRR represented in minor units. May contain fractional kobo for annual plans. */
  mrrMinor: number;
  /** ARR is MRR × 12, in minor units. */
  arrMinor: number;
  exclusions: RecurringRevenueExclusion[];
};

const DAY_MS = 86_400_000;
const safeNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function validDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Calculate MRR only from an active subscription, a complete commercial snapshot,
 * and its exact LIVE, provider-settled, MATCHED Payment row.
 *
 * Only 30-day and 365-day terms are normalized. Every other term is excluded until
 * a reviewed normalization policy exists.
 */
export function calculateEvidenceGatedMrr(
  subscriptions: RecurringSubscriptionEvidence[],
  payments: RecurringPaymentEvidence[],
  asOf: Date,
): RecurringRevenueResult {
  if (!validDate(asOf)) throw new Error("MRR_AS_OF_DATE_INVALID");

  const paymentsById = new Map<string, RecurringPaymentEvidence>();
  for (const payment of payments) {
    if (!payment.id || paymentsById.has(payment.id)) {
      throw new Error("MRR_PAYMENT_IDENTITY_AMBIGUOUS");
    }
    paymentsById.set(payment.id, payment);
  }

  const exclusions: RecurringRevenueExclusion[] = [];
  let mrrMinor = 0;
  let eligibleSubscriptions = 0;

  const exclude = (subscription: RecurringSubscriptionEvidence, reason: RecurringRevenueExclusion["reason"]) => {
    exclusions.push({ product: subscription.product, businessId: subscription.businessId, reason });
  };

  for (const subscription of subscriptions) {
    if (subscription.status !== "ACTIVE") {
      exclude(subscription, "NOT_ACTIVE");
      continue;
    }

    if (!validDate(subscription.startAt) || !validDate(subscription.expiresAt) ||
        !validDate(subscription.recurringPriceEffectiveAt) ||
        subscription.startAt.getTime() > asOf.getTime() ||
        subscription.expiresAt.getTime() <= asOf.getTime() ||
        subscription.recurringPriceEffectiveAt.getTime() > asOf.getTime()) {
      exclude(subscription, "OUTSIDE_EFFECTIVE_PERIOD");
      continue;
    }

    const amount = subscription.recurringAmountKES;
    const discount = subscription.recurringDiscountKES;
    const currency = subscription.recurringCurrency?.trim().toUpperCase();
    const interval = subscription.recurringIntervalDays;
    if (amount === null || discount === null || !currency || interval === null) {
      exclude(subscription, "SNAPSHOT_INCOMPLETE");
      continue;
    }
    if (!safeNonNegativeInt(amount) || !safeNonNegativeInt(discount) ||
        discount > amount || !/^[A-Z]{3}$/.test(currency)) {
      exclude(subscription, "INVALID_SNAPSHOT");
      continue;
    }
    if (currency !== "KES") {
      exclude(subscription, "UNSUPPORTED_CURRENCY");
      continue;
    }
    if (interval !== 30 && interval !== 365) {
      exclude(subscription, "UNSUPPORTED_INTERVAL");
      continue;
    }
    if (!subscription.paymentId || !subscription.paymentReference) {
      exclude(subscription, "PAYMENT_LINK_MISSING");
      continue;
    }

    const payment = paymentsById.get(subscription.paymentId);
    if (!payment) {
      exclude(subscription, "PAYMENT_NOT_FOUND");
      continue;
    }
    if (payment.businessId !== subscription.businessId ||
        payment.planId !== subscription.planId ||
        payment.reference !== subscription.paymentReference ||
        payment.providerSettlementReference !== subscription.paymentReference ||
        payment.purpose !== "SUBSCRIPTION") {
      exclude(subscription, "PAYMENT_IDENTITY_MISMATCH");
      continue;
    }
    if (payment.status !== "PAID" || payment.environment !== "LIVE" ||
        payment.reconciliationStatus !== "MATCHED" || !validDate(payment.providerSettledAt) ||
        payment.providerSettledAt.getTime() > asOf.getTime()) {
      exclude(subscription, "PAYMENT_NOT_ELIGIBLE");
      continue;
    }
    if (payment.currency.trim().toUpperCase() !== currency) {
      exclude(subscription, "PAYMENT_CURRENCY_MISMATCH");
      continue;
    }

    const considerationMinor = (amount - discount) * 100;
    if (!Number.isSafeInteger(considerationMinor) || payment.amount !== considerationMinor) {
      exclude(subscription, "PAYMENT_AMOUNT_MISMATCH");
      continue;
    }

    // A 30-day plan contributes its full monthly amount; a 365-day plan contributes
    // one twelfth. Do not round annual MRR to whole kobo during aggregation.
    mrrMinor += considerationMinor * (interval === 30 ? 1 : 1 / 12);
    if (!Number.isFinite(mrrMinor) || !Number.isSafeInteger(Math.round(mrrMinor * 12))) {
      throw new Error("MRR_TOTAL_OUT_OF_RANGE");
    }
    eligibleSubscriptions += 1;
  }

  return {
    asOf: asOf.toISOString(),
    currency: "KES",
    eligibleSubscriptions,
    mrrMinor,
    arrMinor: mrrMinor * 12,
    exclusions,
  };
}
