import {
  calculateEvidenceGatedMrr,
  type RecurringPaymentEvidence,
  type RecurringSubscriptionEvidence,
  type RecurringRevenueResult,
} from "@/lib/payments/recurring-revenue";

const SUBSCRIPTION_SOURCES = [
  // The shared Subscription model also serves AI Front Desk tiers. Until a canonical,
  // audited plan-key allowlist separates Business Page from Front Desk, omit it entirely.
  ["posSubscription", "BUSINESS_POS"],
  ["autopilotSubscription", "AUTOPILOT"],
  ["mjengoSubscription", "MJENGO_OS"],
  ["erpSubscription", "ERP_LEGACY"],
  ["erpProSubscription", "ERP_PRO"],
] as const;

const SUBSCRIPTION_SELECT = {
  businessId: true,
  planId: true,
  planKey: true,
  status: true,
  startAt: true,
  expiresAt: true,
  recurringAmountKES: true,
  recurringDiscountKES: true,
  recurringCurrency: true,
  recurringIntervalDays: true,
  recurringPriceEffectiveAt: true,
  paymentId: true,
  paymentReference: true,
};

const PAYMENT_SELECT = {
  id: true,
  businessId: true,
  planId: true,
  reference: true,
  purpose: true,
  status: true,
  environment: true,
  amount: true,
  currency: true,
  providerSettledAt: true,
  providerSettlementReference: true,
  reconciliationStatus: true,
};

/**
 * Read-only admin projection. Every subscription family is loaded independently and
 * joined to its exact Payment ID; no historical link is inferred. The pure calculator
 * remains the sole eligibility policy. Any database/model failure rejects the whole
 * report so the admin surface can render Unavailable rather than a partial total.
 */
export async function readEvidenceGatedMrr(
  client: Record<string, any>,
  asOf: Date = new Date(),
): Promise<RecurringRevenueResult> {
  const sourceRows = await Promise.all(SUBSCRIPTION_SOURCES.map(async ([model, product]) => {
    const delegate = client[model];
    if (!delegate || typeof delegate.findMany !== "function") {
      throw new Error("MRR_SUBSCRIPTION_SOURCE_UNAVAILABLE:" + model);
    }
    const rows = await delegate.findMany({ select: SUBSCRIPTION_SELECT });
    return rows.map((row: any): RecurringSubscriptionEvidence => ({
      product,
      businessId: row.businessId,
      planId: row.planId,
      planKey: row.planKey ?? product,
      status: row.status,
      startAt: row.startAt,
      expiresAt: row.expiresAt,
      recurringAmountKES: row.recurringAmountKES,
      recurringDiscountKES: row.recurringDiscountKES,
      recurringCurrency: row.recurringCurrency,
      recurringIntervalDays: row.recurringIntervalDays,
      recurringPriceEffectiveAt: row.recurringPriceEffectiveAt,
      paymentId: row.paymentId,
      paymentReference: row.paymentReference,
    }));
  }));
  const subscriptions = sourceRows.flat();
  const paymentIds = [...new Set(subscriptions.map((row) => row.paymentId).filter((id): id is string => Boolean(id)))];
  const payments = paymentIds.length
    ? await client.payment.findMany({
        where: { id: { in: paymentIds } },
        select: PAYMENT_SELECT,
      })
    : [];
  const evidence: RecurringPaymentEvidence[] = payments.map((row: any) => ({
    id: row.id,
    businessId: row.businessId,
    planId: row.planId,
    reference: row.reference,
    purpose: row.purpose,
    status: row.status,
    environment: row.environment,
    amount: row.amount,
    currency: row.currency,
    providerSettledAt: row.providerSettledAt,
    providerSettlementReference: row.providerSettlementReference,
    reconciliationStatus: row.reconciliationStatus,
  }));
  return calculateEvidenceGatedMrr(subscriptions, evidence, asOf);
}
