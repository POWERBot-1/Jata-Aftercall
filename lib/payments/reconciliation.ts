/**
 * Reconciliation (§29, §42, §43, §44) — anomalies are never silently ignored.
 *
 * Every confirmed payment is matched against the JATA order it settled; every provider event that
 * cannot be matched becomes an exception a person can see. Matching is *evidence*, never
 * convenience: JATA will not attach an unknown payment to an order because the amount looks
 * familiar (§44).
 */

import prisma from "@/lib/db";
import { logPaymentAudit, type PaymentAuditAction } from "./audit";
import { db, type PaymentClient } from "./context";
import type { ProviderKey } from "./types";

export type ReconciliationResult =
  | "MATCHED"
  | "AMOUNT_MISMATCH"
  | "UNKNOWN_PAYMENT"
  | "DUPLICATE"
  | "UNCONFIRMED"
  | "MANUAL_MATCHED";

export async function recordMatchedReconciliation(params: {
  businessId: string;
  transactionId: string;
  provider: ProviderKey | string;
  providerReference: string | null;
  expectedAmountMinor: number;
  receivedAmountMinor: number;
  currency: string;
  notes?: string;
}, client: PaymentClient = db()) {
  if (!client.paymentReconciliation?.create) return null;
  return client.paymentReconciliation.create({
    data: {
      businessId: params.businessId,
      transactionId: params.transactionId,
      provider: params.provider,
      providerReference: params.providerReference,
      result: "MATCHED",
      expectedAmountMinor: params.expectedAmountMinor,
      receivedAmountMinor: params.receivedAmountMinor,
      differenceMinor: 0,
      currency: params.currency,
      notes: params.notes ?? "Order, payment, provider transaction and destination all matched.",
      resolvedAt: new Date(),
    },
  });
}

export async function recordReconciliationException(params: {
  businessId: string;
  transactionId?: string | null;
  provider: ProviderKey | string;
  providerReference?: string | null;
  result: ReconciliationResult;
  expectedAmountMinor?: number | null;
  receivedAmountMinor?: number | null;
  currency?: string;
  notes: string;
}, client: PaymentClient = db()) {
  const expected = params.expectedAmountMinor ?? null;
  const received = params.receivedAmountMinor ?? null;
  const difference = expected === null || received === null ? 0 : received - expected;
  if (!client.paymentReconciliation?.create) return null;
  const row = await client.paymentReconciliation.create({
    data: {
      businessId: params.businessId,
      transactionId: params.transactionId ?? null,
      provider: params.provider,
      providerReference: params.providerReference ?? null,
      result: params.result,
      expectedAmountMinor: expected,
      receivedAmountMinor: received,
      differenceMinor: difference,
      currency: params.currency ?? "KES",
      notes: params.notes.slice(0, 500),
    },
  });
  // The audit action says what happened, not what a catch-all default assumed: an exception is an
  // amount mismatch only when the amounts are what did not line up (§86, §114).
  await logPaymentAudit({
    businessId: params.businessId,
    transactionId: params.transactionId ?? null,
    actorKind: "JATA_SYSTEM",
    action: RECONCILIATION_AUDIT_ACTION[params.result] ?? "PAYMENT_NEEDS_REVIEW",
    summary: params.notes,
    beforeState: { expectedAmountMinor: expected },
    afterState: { receivedAmountMinor: received, differenceMinor: difference, result: params.result },
  }, client);
  return row;
}

/** One exception, one accurate audit action (§86: the trail must not claim something untrue). */
const RECONCILIATION_AUDIT_ACTION: Record<string, PaymentAuditAction> = {
  UNKNOWN_PAYMENT: "PAYMENT_UNMATCHED",
  AMOUNT_MISMATCH: "PAYMENT_AMOUNT_MISMATCH",
  DUPLICATE: "PAYMENT_NEEDS_REVIEW",
  UNCONFIRMED: "PAYMENT_NEEDS_REVIEW",
  MANUAL_MATCHED: "MANUAL_MATCH",
};

export type DailyReconciliation = {
  posSalesKES: number;
  confirmedPaymentsKES: number;
  differenceKES: number;
  transactions: number;
  matched: number;
  exceptions: number;
  unmatchedKES: number;
  reconciled: boolean;
  byProvider: { provider: string; confirmedKES: number; count: number }[];
};

/**
 * The daily reconciliation (§43): POS sales against confirmed payments, with every difference
 * explainable as a counted exception rather than a rounding shrug.
 */
export async function dailyReconciliation(
  businessId: string,
  range: { from: Date; to: Date },
  client: PaymentClient = prisma,
): Promise<DailyReconciliation> {
  const [sales, transactions, reconciliations] = await Promise.all([
    client.posSale.findMany({
      where: { businessId, createdAt: { gte: range.from, lte: range.to }, status: { not: "VOIDED" } },
      select: { totalKES: true, status: true },
    }),
    client.paymentTransaction.findMany({
      where: { businessId, createdAt: { gte: range.from, lte: range.to } },
      select: { amountMinor: true, status: true, provider: true },
    }),
    client.paymentReconciliation.findMany({
      where: { businessId, createdAt: { gte: range.from, lte: range.to } },
      select: { result: true, differenceMinor: true },
    }),
  ]);

  const posSalesKES = (sales ?? []).reduce((total: number, sale: any) => total + Number(sale.totalKES ?? 0), 0);
  const confirmed = (transactions ?? []).filter((row: any) =>
    ["CONFIRMED", "PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"].includes(String(row.status)),
  );
  const confirmedPaymentsKES = confirmed.reduce((total: number, row: any) => Math.round(total + Number(row.amountMinor ?? 0) / 100), 0);
  const matched = (reconciliations ?? []).filter((row: any) => row.result === "MATCHED" || row.result === "MANUAL_MATCHED").length;
  const exceptions = (reconciliations ?? []).filter((row: any) => row.result !== "MATCHED" && row.result !== "MANUAL_MATCHED").length;
  const unmatchedKES = (reconciliations ?? [])
    .filter((row: any) => row.result === "UNKNOWN_PAYMENT")
    .reduce((total: number, row: any) => Math.round(total + Number(row.receivedAmountMinor ?? 0) / 100), 0);

  const providerTotals = new Map<string, { confirmedKES: number; count: number }>();
  for (const row of confirmed) {
    const key = String(row.provider);
    const current = providerTotals.get(key) ?? { confirmedKES: 0, count: 0 };
    current.confirmedKES += Math.round(Number(row.amountMinor ?? 0) / 100);
    current.count += 1;
    providerTotals.set(key, current);
  }

  return {
    posSalesKES,
    confirmedPaymentsKES,
    differenceKES: confirmedPaymentsKES - posSalesKES,
    transactions: (transactions ?? []).length,
    matched,
    exceptions,
    unmatchedKES,
    reconciled: exceptions === 0,
    byProvider: [...providerTotals.entries()].map(([provider, totals]) => ({ provider, ...totals })),
  };
}

export type ExceptionRow = {
  id: string;
  result: ReconciliationResult;
  provider: string;
  providerReference: string | null;
  expectedAmountMinor: number | null;
  receivedAmountMinor: number | null;
  differenceMinor: number;
  notes: string | null;
  transactionId: string | null;
  jataPaymentId: string | null;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
};

export async function listReconciliationExceptions(
  businessId: string,
  options: { limit?: number; includeResolved?: boolean } = {},
  client: PaymentClient = prisma,
): Promise<ExceptionRow[]> {
  const rows = await client.paymentReconciliation.findMany({
    where: {
      businessId,
      result: { in: ["AMOUNT_MISMATCH", "UNKNOWN_PAYMENT", "DUPLICATE", "UNCONFIRMED"] },
      ...(options.includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
  });
  const transactionIds = (rows ?? []).map((row: any) => row.transactionId).filter(Boolean);
  const transactions = transactionIds.length
    ? await client.paymentTransaction.findMany({ where: { businessId, id: { in: transactionIds } }, select: { id: true, jataPaymentId: true } })
    : [];
  const byId = new Map((transactions ?? []).map((row: any) => [row.id, row.jataPaymentId]));
  return (rows ?? []).map((row: any) => ({
    id: row.id,
    result: row.result,
    provider: row.provider,
    providerReference: row.providerReference ?? null,
    expectedAmountMinor: row.expectedAmountMinor ?? null,
    receivedAmountMinor: row.receivedAmountMinor ?? null,
    differenceMinor: Number(row.differenceMinor ?? 0),
    notes: row.notes ?? null,
    transactionId: row.transactionId ?? null,
    jataPaymentId: byId.get(row.transactionId) ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }));
}

/**
 * Manual matching (§44) is a deliberate, attributed act: an authorized role, a stated reason,
 * the provider reference, and an immutable audit record. It cannot attach money to an order
 * belonging to another tenant, and it cannot make a payment confirm.
 */
export async function matchUnmatchedPayment(params: {
  businessId: string;
  reconciliationId: string;
  transactionId?: string | null;
  actorId: string | null;
  actorName: string | null;
  reason: string;
  client?: PaymentClient;
}) {
  const client = params.client ?? prisma;
  const reason = String(params.reason ?? "").trim();
  if (reason.length < 5) return { ok: false as const, code: "REASON_REQUIRED", message: "Give a reason for matching this payment." };

  const row = await client.paymentReconciliation.findFirst({ where: { id: params.reconciliationId, businessId: params.businessId } });
  if (!row) return { ok: false as const, code: "NOT_FOUND", message: "That reconciliation record was not found." };
  if (row.resolvedAt) return { ok: false as const, code: "ALREADY_RESOLVED", message: "That payment has already been matched." };

  let transaction: any = null;
  if (params.transactionId) {
    transaction = await client.paymentTransaction.findFirst({ where: { id: params.transactionId, businessId: params.businessId } });
    if (!transaction) return { ok: false as const, code: "TRANSACTION_NOT_FOUND", message: "That payment does not belong to this business." };
  }

  const before = { result: row.result, resolvedAt: row.resolvedAt ?? null, transactionId: row.transactionId ?? null };
  const updated = await client.paymentReconciliation.update({
    where: { id: row.id },
    data: {
      result: "MANUAL_MATCHED",
      transactionId: transaction?.id ?? row.transactionId ?? null,
      matchedByActorId: params.actorId,
      matchedByActorName: params.actorName,
      matchedReason: reason.slice(0, 300),
      resolvedAt: new Date(),
    },
  });
  await logPaymentAudit({
    businessId: params.businessId,
    transactionId: transaction?.id ?? row.transactionId ?? null,
    actorKind: "MERCHANT_STAFF",
    actorId: params.actorId,
    actorName: params.actorName,
    action: "MANUAL_MATCH",
    summary: `Unmatched payment matched by hand: ${reason}`.slice(0, 300),
    beforeState: before,
    afterState: { result: "MANUAL_MATCHED", transactionId: transaction?.id ?? null },
    reason,
  }, client);
  return { ok: true as const, reconciliation: updated };
}
