/**
 * Read-only reconciliation primitives. These inputs are snapshots supplied by a trusted future
 * server-side loader, NOT proof of Paystack verification or permission to accrue/pay commission.
 * This module does not query a provider, store a ledger, send messages or mutate financial data.
 * Amounts are integer KES minor units; never convert them to floating point.
 */
export type PaymentReconciliationSnapshot = {
  paymentId: string;
  reference: string;
  localStatus: string;
  localCurrency: string;
  localAmountMinor: bigint;
  /** Independently verified provider data; null when unavailable or not verified. */
  verifiedProvider: null | { reference: string; transactionId: string; status: string; currency: string; amountMinor: bigint };
};

export type CommissionEntrySnapshot = {
  id: string;
  paymentId: string;
  agentId: string;
  currency: string;
  kind: "ACCRUAL" | "REVERSAL";
  amountMinor: bigint; // positive accrual, negative reversal
  reversesEntryId: string | null;
  sourceEventId: string;
};

export type ReconciliationIssue = {
  code: string;
  paymentId: string | null;
  entryId: string | null;
};

/**
 * Diagnostics only. Missing provider proof is a discrepancy, never a verified payment. A zero
 * issue result is not a calculation of eligibility: approved policy, attribution, provider
 * retrieval, settlement history, authorization and refund terms are intentionally out of scope.
 */
export function reconcileCommissionSnapshots(
  payments: readonly PaymentReconciliationSnapshot[],
  entries: readonly CommissionEntrySnapshot[],
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const issue = (code: string, paymentId: string | null, entryId: string | null = null) => issues.push({ code, paymentId, entryId });
  const paymentById = new Map<string, PaymentReconciliationSnapshot>();
  const providerIds = new Map<string, string>();
  const references = new Map<string, string>();
  for (const payment of payments) {
    if (!payment.paymentId || !payment.reference || paymentById.has(payment.paymentId)) {
      issue("DUPLICATE_OR_INVALID_PAYMENT", payment.paymentId || null); continue;
    }
    paymentById.set(payment.paymentId, payment);
    const priorReference = references.get(payment.reference);
    if (priorReference && priorReference !== payment.paymentId) issue("DUPLICATE_PAYMENT_REFERENCE", payment.paymentId);
    else references.set(payment.reference, payment.paymentId);
    if (payment.localCurrency !== "KES" || typeof payment.localAmountMinor !== "bigint" || payment.localAmountMinor <= BigInt(0)) issue("INVALID_LOCAL_PAYMENT", payment.paymentId);
    if (payment.localStatus === "REFUNDED") issue("PROVIDER_REFUND_VERIFICATION_REQUIRED", payment.paymentId);
    const provider = payment.verifiedProvider;
    if (!provider || typeof provider.transactionId !== "string" || !provider.transactionId.trim() || provider.transactionId.length > 255 || /^data:/i.test(provider.transactionId.trim())) { issue("PROVIDER_VERIFICATION_UNAVAILABLE", payment.paymentId); continue; }
    const providerId = provider.transactionId.trim();
    const prior = providerIds.get(providerId);
    if (prior && prior !== payment.paymentId) issue("DUPLICATE_PROVIDER_TRANSACTION", payment.paymentId);
    else providerIds.set(providerId, payment.paymentId);
    if (provider.reference !== payment.reference) issue("PROVIDER_REFERENCE_MISMATCH", payment.paymentId);
    if (provider.currency !== "KES" || provider.currency !== payment.localCurrency) issue("PROVIDER_CURRENCY_MISMATCH", payment.paymentId);
    if (typeof provider.amountMinor !== "bigint" || provider.amountMinor !== payment.localAmountMinor) issue("PROVIDER_AMOUNT_MISMATCH", payment.paymentId);
    if ((payment.localStatus === "PAID" && provider.status !== "success") || (payment.localStatus !== "PAID" && provider.status === "success" && payment.localStatus !== "REFUNDED")) issue("PAYMENT_STATUS_MISMATCH", payment.paymentId);
  }
  const byId = new Map<string, CommissionEntrySnapshot>();
  const sources = new Set<string>();
  const accrualsByPayment = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || byId.has(entry.id)) { issue("DUPLICATE_OR_INVALID_ENTRY", entry.paymentId || null, entry.id || null); continue; }
    byId.set(entry.id, entry);
    if (!entry.sourceEventId || sources.has(entry.sourceEventId)) issue("DUPLICATE_OR_INVALID_SOURCE", entry.paymentId, entry.id);
    else sources.add(entry.sourceEventId);
    if (!paymentById.has(entry.paymentId)) issue("PAYMENT_NOT_FOUND", entry.paymentId, entry.id);
    if (!entry.agentId || entry.currency !== "KES" || typeof entry.amountMinor !== "bigint") { issue("INVALID_ENTRY", entry.paymentId, entry.id); continue; }
    if (entry.kind === "ACCRUAL") {
      if (entry.amountMinor <= BigInt(0) || entry.reversesEntryId !== null) issue("INVALID_ACCRUAL", entry.paymentId, entry.id);
      if (accrualsByPayment.has(entry.paymentId)) issue("MULTIPLE_ACCRUALS_REVIEW", entry.paymentId, entry.id);
      accrualsByPayment.add(entry.paymentId);
    } else if (entry.kind === "REVERSAL") {
      if (entry.amountMinor >= BigInt(0) || !entry.reversesEntryId) issue("INVALID_REVERSAL", entry.paymentId, entry.id);
    } else issue("INVALID_ENTRY_KIND", entry.paymentId, entry.id);
  }
  const reversed = new Map<string, bigint>();
  for (const entry of byId.values()) {
    if (entry.kind !== "REVERSAL" || !entry.reversesEntryId || typeof entry.amountMinor !== "bigint" || entry.amountMinor >= BigInt(0)) continue;
    // The current snapshot has no independently verified refund evidence or approved reversal policy.
    issue("REVERSAL_EVIDENCE_REVIEW", entry.paymentId, entry.id);
    const original = byId.get(entry.reversesEntryId);
    if (!original || original.kind !== "ACCRUAL" || original.paymentId !== entry.paymentId || original.agentId !== entry.agentId || original.currency !== entry.currency || typeof original.amountMinor !== "bigint" || original.amountMinor <= BigInt(0)) {
      issue("REVERSAL_REFERENCE_MISMATCH", entry.paymentId, entry.id); continue;
    }
    reversed.set(original.id, (reversed.get(original.id) ?? BigInt(0)) - entry.amountMinor);
  }
  for (const [id, amount] of reversed) {
    const original = byId.get(id)!;
    if (amount > original.amountMinor) issue("OVER_REVERSED", original.paymentId, id);
  }
  for (const entry of byId.values()) {
    if (entry.kind !== "ACCRUAL" || typeof entry.amountMinor !== "bigint" || entry.amountMinor <= BigInt(0)) continue;
    const payment = paymentById.get(entry.paymentId);
    if (payment?.localStatus === "REFUNDED" && (reversed.get(entry.id) ?? BigInt(0)) < entry.amountMinor) issue("REFUND_REVERSAL_REVIEW", entry.paymentId, entry.id);
    if (payment && payment.localStatus !== "PAID" && payment.localStatus !== "REFUNDED") issue("ACCRUAL_ON_UNPAID_PAYMENT", entry.paymentId, entry.id);
  }
  return issues;
}
