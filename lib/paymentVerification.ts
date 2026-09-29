import { PAYMENT_CURRENCY } from "./paymentCurrency";

export type PaymentExpectation = { reference: string; amount: number; currency: string };
export type PaymentEvidence = { reference?: unknown; amount?: unknown; currency?: unknown; status?: unknown };
export type PaymentMismatch = "REFERENCE_MISMATCH" | "AMOUNT_MISMATCH" | "CURRENCY_MISMATCH";

export function validatePaymentEvidence(expected: PaymentExpectation, evidence: PaymentEvidence): { ok: true } | { ok: false; reason: PaymentMismatch } {
  if (evidence.reference !== expected.reference) return { ok: false, reason: "REFERENCE_MISMATCH" };
  if (evidence.amount !== expected.amount) return { ok: false, reason: "AMOUNT_MISMATCH" };
  if (expected.currency !== PAYMENT_CURRENCY || evidence.currency !== PAYMENT_CURRENCY) return { ok: false, reason: "CURRENCY_MISMATCH" };
  return { ok: true };
}

export function subscriptionWindow(
  now: Date,
  durationDays: number,
  current?: { status: string; startAt?: Date | null; expiresAt?: Date | null } | null,
): { startAt: Date; expiresAt: Date } {
  const extend = (current?.status === "ACTIVE" || current?.status === "EXPIRING") && current.expiresAt && current.expiresAt > now;
  const startAt = extend ? current.startAt || now : now;
  const base = extend ? current.expiresAt! : now;
  return { startAt, expiresAt: new Date(base.getTime() + durationDays * 86400000) };
}

/**
 * Paystack statuses that mean the transaction is still in progress, not final.
 * See https://paystack.com/docs/payments/verify-payments/ — "ongoing", "pending",
 * "processing" and "queued" can still become "success", so they must never be
 * recorded as a failure in our database.
 */
export const PAYSTACK_IN_PROGRESS_STATUSES = ["ongoing", "pending", "processing", "queued"] as const;
export type PaystackInProgressStatus = (typeof PAYSTACK_IN_PROGRESS_STATUSES)[number];

export function isInProgressPaymentStatus(providerStatus: unknown): providerStatus is PaystackInProgressStatus {
  return typeof providerStatus === "string" && (PAYSTACK_IN_PROGRESS_STATUSES as readonly string[]).includes(providerStatus);
}

/** Final, non-successful outcome for a provider status. Only call this for statuses that are neither success nor in progress. */
export function failedPaymentStatus(providerStatus: unknown): "CANCELLED" | "EXPIRED" | "FAILED" {
  if (providerStatus === "abandoned") return "CANCELLED";
  if (providerStatus === "expired") return "EXPIRED";
  return "FAILED";
}

export type ProviderOutcome =
  | { kind: "success" }
  | { kind: "in_progress"; providerStatus: PaystackInProgressStatus }
  | { kind: "final_failure"; status: "CANCELLED" | "EXPIRED" | "FAILED" };

/** Single place that decides what a verified Paystack status means for our payment record. */
export function classifyProviderStatus(providerStatus: unknown): ProviderOutcome {
  if (providerStatus === "success") return { kind: "success" };
  if (isInProgressPaymentStatus(providerStatus)) return { kind: "in_progress", providerStatus };
  return { kind: "final_failure", status: failedPaymentStatus(providerStatus) };
}
