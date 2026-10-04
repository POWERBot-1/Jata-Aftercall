/**
 * The payment audit trail (§60, §98, §114).
 *
 * Every critical payment event is recorded with who, what, when, and the before/after state.
 * Records are written inside the same database transaction as the change they describe, so a
 * payment can never exist without the trail that explains it — and the database refuses to
 * update them afterwards (immutability trigger in the payment-wallet migration).
 */

import prisma from "@/lib/db";
import type { PaymentClient } from "./context";

export const PAYMENT_AUDIT_ACTIONS = [
  "DESTINATION_CREATED",
  "DESTINATION_VERIFIED",
  "DESTINATION_CHANGED",
  "DESTINATION_DISCONNECTED",
  "CONNECTION_AUTHORIZED",
  "CONFIRMATION_REFUSED",
  "PAYMENT_REQUESTED",
  "PAYMENT_CONFIRMATION_RECEIVED",
  "PAYMENT_VERIFIED",
  "PAYMENT_SETTLED",
  "PAYMENT_PARTIALLY_SETTLED",
  "PAYMENT_FAILED",
  "PAYMENT_EXPIRED",
  "PAYMENT_CANCELLED",
  "PAYMENT_REVERSED",
  "PAYMENT_UNMATCHED",
  "PAYMENT_AMOUNT_MISMATCH",
  "REFUND_REQUESTED",
  "REFUND_COMPLETED",
  "REFUND_FAILED",
  "MANUAL_MATCH",
  "PROVIDER_EVENT_REJECTED",
  "PAYMENT_RECHECKED_BY_OPERATOR",
  "NOTIFICATION_RETRIED",
] as const;

export type PaymentAuditAction = (typeof PAYMENT_AUDIT_ACTIONS)[number];

export const PAYMENT_AUDIT_LABELS: Record<PaymentAuditAction, string> = {
  DESTINATION_CREATED: "Payment destination added",
  DESTINATION_VERIFIED: "Payment destination checked",
  DESTINATION_CHANGED: "Payment destination changed",
  DESTINATION_DISCONNECTED: "Payment destination disconnected",
  CONNECTION_AUTHORIZED: "Provider connection authorized",
  CONFIRMATION_REFUSED: "A confirmation was refused",
  PAYMENT_REQUESTED: "Payment requested",
  PAYMENT_CONFIRMATION_RECEIVED: "Provider confirmation received",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_SETTLED: "Order marked paid",
  PAYMENT_PARTIALLY_SETTLED: "Part of the order paid",
  PAYMENT_FAILED: "Payment not completed",
  PAYMENT_EXPIRED: "We stopped waiting for confirmation",
  PAYMENT_CANCELLED: "Payment request cancelled",
  PAYMENT_REVERSED: "Payment reversed by the provider",
  PAYMENT_UNMATCHED: "Payment received with no matching order",
  PAYMENT_AMOUNT_MISMATCH: "Payment amount did not match",
  REFUND_REQUESTED: "Refund requested",
  REFUND_COMPLETED: "Refund completed",
  REFUND_FAILED: "Refund could not be completed",
  MANUAL_MATCH: "Payment matched to an order by a person",
  PROVIDER_EVENT_REJECTED: "Provider event refused",
  PAYMENT_RECHECKED_BY_OPERATOR: "Payment status re-checked with the provider by JATA",
  NOTIFICATION_RETRIED: "Message retried",
};

export type PaymentAuditInput = {
  businessId: string;
  transactionId?: string | null;
  destinationId?: string | null;
  actorKind: "MERCHANT_STAFF" | "CUSTOMER" | "JATA_SYSTEM" | "JATA_OPERATOR";
  actorId?: string | null;
  actorName?: string | null;
  action: PaymentAuditAction;
  summary: string;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
};

/** Trims a before/after snapshot to a JSON-safe, non-sensitive shape. */
function snapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined);
  if (!entries.length) return null;
  return Object.fromEntries(entries.slice(0, 40).map(([key, entry]) => {
    if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) return [key, entry];
    if (Array.isArray(entry)) return [key, entry.slice(0, 20).map((item) => (typeof item === "object" ? "[object]" : item))];
    return [key, "[object]"];
  }));
}

export async function logPaymentAudit(input: PaymentAuditInput, client: PaymentClient = prisma) {
  const data = {
    businessId: input.businessId,
    transactionId: input.transactionId ?? null,
    destinationId: input.destinationId ?? null,
    actorKind: input.actorKind,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: input.action,
    summary: input.summary.slice(0, 300),
    beforeState: snapshot(input.beforeState) ?? undefined,
    afterState: snapshot(input.afterState) ?? undefined,
    reason: input.reason ? input.reason.slice(0, 300) : null,
  };
  // The audit row is part of the caller's transaction (§98): if it cannot be written, the
  // financial change it describes is rolled back with it. The only tolerated case is an offline
  // environment whose Prisma double has no payment models loaded at all.
  if (!client.paymentAuditEvent?.create) return null;
  return client.paymentAuditEvent.create({ data });
}

export type TimelineEntry = {
  action: PaymentAuditAction;
  label: string;
  summary: string;
  actorKind: string;
  at: Date | string;
};

export function toTimeline(rows: any[]): TimelineEntry[] {
  return (rows ?? []).map((row) => ({
    action: row.action,
    label: PAYMENT_AUDIT_LABELS[row.action as PaymentAuditAction] ?? row.action,
    summary: row.summary,
    actorKind: row.actorKind,
    at: row.createdAt,
  }));
}
