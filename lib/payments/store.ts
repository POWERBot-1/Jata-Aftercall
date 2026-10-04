/**
 * Read models for the merchant payment screens (§40, §41, §72).
 *
 * These are deliberately shaped for the till, the wallet screen and the live payments board:
 * plain-language labels, no provider payloads, no credentials, no internal jargon. Every query is
 * tenant-scoped by `businessId` and nothing here can be reached without the caller having already
 * passed `requirePosAccess` (§5, §57, §75).
 */

import prisma from "@/lib/db";
import type { PaymentClient } from "./context";
import { minorToKes } from "./money";
import { paymentStatusLabel, PAYMENT_STATUS_TONES, type PaymentStatus } from "./states";
import { toTimeline } from "./audit";
import { PROVIDER_LABELS } from "./types";
import { notificationStatusLabel } from "./notifications";

export type MerchantPaymentRow = {
  id: string;
  jataPaymentId: string;
  provider: string;
  providerLabel: string;
  method: string | null;
  status: string;
  statusLabel: string;
  tone: "neutral" | "warn" | "success" | "danger";
  amountKES: number;
  paidKES: number;
  refundedKES: number;
  currency: string;
  destinationLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  saleId: string | null;
  receiptNumber: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string | null;
  paidAt: string | null;
  awaitingCustomer: boolean;
};

export function toMerchantPaymentRow(transaction: any, destination?: any | null): MerchantPaymentRow {
  const status = String(transaction.status ?? "CREATED") as PaymentStatus;
  return {
    id: String(transaction.id),
    jataPaymentId: String(transaction.jataPaymentId ?? ""),
    provider: String(transaction.provider ?? ""),
    providerLabel: PROVIDER_LABELS[String(transaction.provider) as keyof typeof PROVIDER_LABELS] ?? String(transaction.provider ?? ""),
    method: transaction.method ?? null,
    status,
    statusLabel: paymentStatusLabel(status),
    tone: PAYMENT_STATUS_TONES[status] ?? "neutral",
    amountKES: minorToKes(Number(transaction.amountMinor ?? 0)),
    paidKES: minorToKes(Number(transaction.amountPaidMinor ?? 0)),
    refundedKES: minorToKes(Number(transaction.amountRefundedMinor ?? 0)),
    currency: String(transaction.currency ?? "KES"),
    destinationLabel: destination?.label ?? null,
    customerName: transaction.customerName ?? null,
    customerPhone: transaction.customerPhoneMasked ?? null,
    saleId: transaction.posSaleId ?? null,
    receiptNumber: transaction.receiptNumber ?? null,
    failureReason: transaction.failureReason ?? null,
    createdAt: new Date(transaction.createdAt ?? Date.now()).toISOString(),
    updatedAt: transaction.updatedAt ? new Date(transaction.updatedAt).toISOString() : null,
    paidAt: transaction.paidAt ? new Date(transaction.paidAt).toISOString() : null,
    awaitingCustomer: ["PAYMENT_REQUESTED", "PENDING", "PROCESSING"].includes(status),
  };
}

/** Recent payments for the live board (§41). Filterable by status without ever leaving the tenant. */
export async function listRecentPayments(
  businessId: string,
  options: { take?: number; status?: string | null; saleId?: string | null; openOnly?: boolean } = {},
  client: PaymentClient = prisma,
): Promise<MerchantPaymentRow[]> {
  const take = Math.min(Math.max(options.take ?? 25, 1), 100);
  const where: Record<string, unknown> = { businessId };
  if (options.status) where.status = options.status;
  if (options.saleId) where.posSaleId = options.saleId;
  if (options.openOnly) where.status = { in: ["PAYMENT_REQUESTED", "PENDING", "PROCESSING"] };

  const rows = await client.paymentTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });
  const destinationIds = [...new Set((rows ?? []).map((row: any) => row.destinationId).filter(Boolean))];
  const destinations = destinationIds.length
    ? await client.paymentDestination.findMany({ where: { businessId, id: { in: destinationIds } } })
    : [];
  const byId = new Map((destinations ?? []).map((row: any) => [row.id, row]));
  return (rows ?? []).map((row: any) => toMerchantPaymentRow(row, byId.get(row.destinationId) ?? null));
}

/** Everything the payment detail drawer shows — all of it already sanitized on the way in (§35). */
export async function paymentDetail(
  businessId: string,
  transactionId: string,
  client: PaymentClient = prisma,
) {
  const transaction = await client.paymentTransaction.findFirst({ where: { id: transactionId, businessId } });
  if (!transaction) return null;

  const destination = transaction.destinationId
    ? await client.paymentDestination.findFirst({ where: { id: transaction.destinationId, businessId } })
    : null;

  const [attempts, events, notifications, refunds, reconciliations, audit] = await Promise.all([
    client.paymentAttempt?.findMany?.({ where: { businessId, transactionId }, orderBy: { createdAt: "asc" } }) ?? [],
    client.paymentEvent?.findMany?.({ where: { businessId, transactionId }, orderBy: { receivedAt: "desc" }, take: 50 }) ?? [],
    client.paymentNotification?.findMany?.({ where: { businessId, transactionId }, orderBy: { createdAt: "desc" } }) ?? [],
    client.refund?.findMany?.({ where: { businessId, transactionId }, orderBy: { createdAt: "desc" } }) ?? [],
    client.paymentReconciliation?.findMany?.({ where: { businessId, transactionId }, orderBy: { createdAt: "desc" } }) ?? [],
    client.paymentAuditEvent?.findMany?.({ where: { businessId, transactionId }, orderBy: { createdAt: "asc" }, take: 200 }) ?? [],
  ]);

  return {
    payment: toMerchantPaymentRow(transaction, destination),
    destination: destination
      ? { id: destination.id, label: destination.label, kind: destination.kind, provider: destination.provider, status: destination.status }
      : null,
    attempts: (attempts ?? []).map((row: any) => ({
      id: row.id,
      provider: row.provider,
      status: row.status,
      attemptNumber: row.attemptNumber,
      failureReason: row.errorMessage ?? null,
      createdAt: row.createdAt,
    })),
    events: (events ?? []).map((row: any) => ({
      id: row.id,
      provider: row.provider,
      eventType: row.eventType,
      status: row.status,
      signatureVerified: Boolean(row.signatureVerified),
      receivedAt: row.receivedAt,
    })),
    notifications: (notifications ?? []).map((row: any) => ({
      id: row.id,
      audience: row.audience,
      channel: row.channel,
      status: notificationStatusLabel(String(row.status ?? "")),
      deliveredAt: row.deliveredAt,
      failureReason: row.failureReason ?? null,
    })),
    refunds: (refunds ?? []).map((row: any) => ({
      id: row.id,
      amountKES: minorToKes(Number(row.amountMinor ?? 0)),
      status: row.status,
      reason: row.reason,
      initiatedByName: row.initiatedByName,
      createdAt: row.createdAt,
    })),
    exceptions: (reconciliations ?? []).map((row: any) => ({
      id: row.id,
      result: row.result,
      differenceKES: minorToKes(Number(row.differenceMinor ?? 0)),
      notes: row.notes,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    })),
    timeline: toTimeline(audit ?? []),
  };
}

/** What the till asks for while a customer stands at the counter (§21, §25, §41). */
export async function paymentForSale(businessId: string, saleId: string, client: PaymentClient = prisma) {
  const row = await client.paymentTransaction.findFirst({
    where: { businessId, posSaleId: saleId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  const walletTransactions = await listRecentPayments(businessId, { saleId, take: 10 }, client);
  return { current: toMerchantPaymentRow(row), history: walletTransactions };
}
