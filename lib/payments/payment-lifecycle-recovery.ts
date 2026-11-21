/**
 * Deterministic, read-only recovery queue planner for payment/entitlement exceptions.
 *
 * Queue items are review work, not commands. This module never retries provider calls,
 * activates/suspends entitlements, changes payments, issues refunds, or posts ledger entries.
 */
import { createHash } from "node:crypto";
import type {
  PaymentEntitlementException,
  PaymentEntitlementFinding,
  PaymentEntitlementReport,
} from "@/lib/admin/payment-entitlement-reconciliation";

export type PaymentRecoveryPriority = "CRITICAL" | "HIGH" | "MEDIUM";
export type PaymentRecoveryQueueItem = PaymentEntitlementFinding & {
  idempotencyKey: string;
  priority: PaymentRecoveryPriority;
  status: "REVIEW_REQUIRED";
  permittedAction: "MANUAL_REVIEW_ONLY";
};

const priority: Record<PaymentEntitlementException, PaymentRecoveryPriority> = {
  PAID_PAYMENT_WITHOUT_ENTITLEMENT: "HIGH",
  ENTITLEMENT_PAYMENT_NOT_FOUND: "HIGH",
  ENTITLEMENT_PAYMENT_NOT_PAID: "CRITICAL",
  ENTITLEMENT_PAYMENT_IDENTITY_MISMATCH: "CRITICAL",
  DUPLICATE_ENTITLEMENT_FOR_PAYMENT: "MEDIUM",
};

const priorityRank: Record<PaymentRecoveryPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
};

/**
 * Converts a completed lifecycle inventory into stable, deduplicated operator work.
 * The key is derived only from opaque internal identifiers and the exception identity.
 */
export function buildPaymentLifecycleRecoveryQueue(
  report: Pick<PaymentEntitlementReport, "findings">,
): PaymentRecoveryQueueItem[] {
  const unique = new Map<string, PaymentRecoveryQueueItem>();

  for (const finding of report.findings) {
    const identity = [
      finding.exception,
      finding.paymentId ?? null,
      finding.entitlementId ?? null,
      finding.product ?? null,
    ];
    const idempotencyKey = "payment-recovery:v1:" + createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    if (unique.has(idempotencyKey)) continue;

    unique.set(idempotencyKey, {
      ...finding,
      idempotencyKey,
      priority: priority[finding.exception],
      status: "REVIEW_REQUIRED",
      permittedAction: "MANUAL_REVIEW_ONLY",
    });
  }

  return [...unique.values()].sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority] ||
    a.idempotencyKey.localeCompare(b.idempotencyKey),
  );
}
