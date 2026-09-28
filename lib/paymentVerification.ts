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

export function failedPaymentStatus(providerStatus: unknown): "CANCELLED" | "EXPIRED" | "FAILED" {
  if (providerStatus === "abandoned") return "CANCELLED";
  if (providerStatus === "expired") return "EXPIRED";
  return "FAILED";
}
