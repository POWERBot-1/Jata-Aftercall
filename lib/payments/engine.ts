/**
 * The JATA payment engine (§24, §25, §30, §98) — where authoritative confirmation becomes money
 * in the books, atomically.
 *
 *   RECEIVE → AUTHENTICATE → VALIDATE → IDENTIFY BUSINESS → IDENTIFY TRANSACTION → VERIFY AMOUNT
 *   → VERIFY DESTINATION → ENFORCE IDEMPOTENCY → MARK PAYMENT CONFIRMED → SETTLE THE SALE → COMMIT
 *   → (asynchronously) notifications, receipt, realtime, reconciliation
 *
 * Two rules are absolute:
 *   1. Nothing is PAID because a request was sent, a browser redirected, a cashier said so or a
 *      timer elapsed. Only a provider confirmation that JATA has matched, amount-verified and
 *      idempotency-checked may settle anything (§30).
 *   2. The financial change is one transaction. A payment can never end up PAID while its sale
 *      stays unpaid, or a sale settled while the payment row still says PENDING (§98).
 */

import prisma from "@/lib/db";
import { effectiveConfiguration, loadConfiguration } from "@/lib/pos/provisioning";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { createSale, type PosActor, type SaleRequest } from "@/lib/pos/sales";
import { logPaymentAudit } from "./audit";
import { adapterContext, db, inTransaction, type PaymentClient } from "./context";
import { ensureNotificationsForConfirmation } from "./notifications";
import { isOk } from "./result";
import { recordMatchedReconciliation, recordReconciliationException } from "./reconciliation";
import { publishPaymentEvent } from "./realtime";
import { maskPhone, minorToKes } from "./money";
import { receiptToken } from "./ids";
import { canTransition, type PaymentStatus } from "./states";
import type { ProviderEventOutcome, ProviderKey, TransactionRecord } from "./types";
import { getAdapter } from "./providers/registry";

export type ConfirmationEvent = Extract<ProviderEventOutcome, { kind: "confirmation" }>;
export type ReversalEvent = Extract<ProviderEventOutcome, { kind: "reversal" }>;
export type FailureEvent = Extract<ProviderEventOutcome, { kind: "failure" }>;

export type ApplyResult =
  | { kind: "settled"; transactionId: string; businessId: string; saleId: string | null; status: PaymentStatus; duplicate: boolean }
  | { kind: "confirmed_unmatched"; reason: string }
  | { kind: "amount_mismatch"; transactionId: string; expectedMinor: number; receivedMinor: number }
  | { kind: "duplicate"; transactionId: string }
  | { kind: "exception"; reason: string; transactionId?: string }
  | { kind: "no_match"; reason: string };

export type PosPaymentContext = {
  version: 1;
  pos?: {
    /** The exact, server-priced sale request the cashier submitted (§20, §56). */
    request: SaleRequest;
    method: string;
    actor: { actorId: string | null; actorName: string | null; roleKey: string; permissions: string[]; staffId: string | null; branchId: string | null };
    business: { name: string; phone: string | null; whatsapp: string | null; location: string | null; logoUrl: string | null };
    configurationVersion: number;
    configurationFingerprint: string | null;
    /** The total the server priced when the request was made. */
    expectedTotalKES: number;
  };
  /** The till's own request key, so a double tap cannot start two payments (§33). */
  requestKey: string;
  /** Who is paying, when the cashier recorded it — masked before it is ever stored (§59). */
  customerName?: string | null;
};

/** Prisma returns JSONB as an object; a raw SQL path or the in-memory double may hand back text. */
export function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readPosContext(value: unknown): PosPaymentContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as PosPaymentContext;
  return context.version === 1 ? context : null;
}

/**
 * Finds the payment a provider event belongs to (§24, §56, §64).
 *
 * Ordered from strongest to weakest evidence: the reference JATA handed the provider, then the
 * provider's own transaction id, then a destination+amount correlation for counter payments whose
 * provider does not echo JATA's reference (an M-PESA till payment, for example). A weaker match is
 * never used when a stronger one exists, and a match is only accepted inside the same tenant.
 */
export async function locateTransaction(
  provider: ProviderKey | string,
  event: ConfirmationEvent,
  client: PaymentClient = db(),
) {
  if (event.providerReference) {
    const byReference = await client.paymentTransaction.findFirst({ where: { provider, providerReference: event.providerReference } });
    if (byReference) return { transaction: byReference, how: "PROVIDER_REFERENCE" as const };
  }
  if (event.providerTransactionId) {
    const byProviderId = await client.paymentTransaction.findFirst({ where: { provider, providerTransactionId: event.providerTransactionId } });
    if (byProviderId) return { transaction: byProviderId, how: "PROVIDER_TRANSACTION_ID" as const };
  }

  const destinationId = event.destination.providerDestinationId;
  if (!destinationId) return { transaction: null, how: "NONE" as const };

  const destination = await client.paymentDestination.findFirst({
    where: { provider, providerDestinationId: destinationId.replace(/[^0-9]/g, ""), isActive: true },
  });
  if (!destination) return { transaction: null, how: "NONE" as const };

  // Destination + amount + still-open, most recent first, inside a 24-hour window. A merchant
  // paying a till is identified by the till and the amount; JATA never guesses beyond that (§44).
  const candidates = await client.paymentTransaction.findMany({
    where: {
      businessId: destination.businessId,
      destinationId: destination.id,
      status: { in: ["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING", "EXPIRED"] },
      amountMinor: event.amountMinor,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const fresh = (candidates ?? []).find((row: any) => {
    const created = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    return Date.now() - created <= 24 * 60 * 60 * 1000;
  });
  return { transaction: fresh ?? null, how: fresh ? ("DESTINATION_AND_AMOUNT" as const) : ("NONE" as const), destination };
}

/**
 * Applies an authoritative provider confirmation. Runs entirely inside one database transaction:
 * the payment row, the POS sale, the stock movements, the audit record and the notification queue
 * entries commit together or not at all (§98, §100).
 */
export async function applyConfirmation(params: {
  provider: ProviderKey | string;
  event: ConfirmationEvent;
  eventRowId?: string | null;
  client?: PaymentClient;
  /** Skip the async fan-out (used by tests that assert the atomic part only). */
  skipFanout?: boolean;
}): Promise<ApplyResult> {
  const { provider, event } = params;

  const outcome = await inTransaction(params.client, async (tx: PaymentClient) => {
    const located = await locateTransaction(provider, event, tx);
    const transaction = located.transaction;
    if (!transaction) {
      return { kind: "no_match" as const, reason: "NO_MATCHING_TRANSACTION" };
    }

    const businessId = String(transaction.businessId);

    // ── Verify the destination belongs to the same tenant (§56, §57) ──────────
    if (transaction.destinationId) {
      const destination = await tx.paymentDestination.findFirst({ where: { id: transaction.destinationId, businessId } });
      if (!destination) {
        await recordReconciliationException({
          businessId,
          transactionId: transaction.id,
          provider,
          providerReference: event.providerReference || transaction.providerReference,
          result: "UNCONFIRMED",
          expectedAmountMinor: transaction.amountMinor,
          receivedAmountMinor: event.amountMinor,
          notes: "A provider confirmation arrived whose destination does not belong to the payment's business.",
        }, tx);
        return { kind: "exception" as const, reason: "DESTINATION_TENANT_MISMATCH", transactionId: transaction.id };
      }
      if (event.destination.providerDestinationId && destination.providerDestinationId !== event.destination.providerDestinationId.replace(/[^0-9]/g, "")) {
        await recordReconciliationException({
          businessId,
          transactionId: transaction.id,
          provider,
          providerReference: event.providerReference || transaction.providerReference,
          result: "UNCONFIRMED",
          expectedAmountMinor: transaction.amountMinor,
          receivedAmountMinor: event.amountMinor,
          notes: "The provider confirmed a different destination than the one this payment was routed to.",
        }, tx);
        return { kind: "exception" as const, reason: "DESTINATION_MISMATCH", transactionId: transaction.id };
      }
    }

    // ── Verify the amount and currency (§24, §42, §98) ────────────────────────
    if (event.amountMinor !== transaction.amountMinor || event.currency !== transaction.currency) {
      await recordReconciliationException({
        businessId,
        transactionId: transaction.id,
        provider,
        providerReference: event.providerReference || transaction.providerReference,
        result: "AMOUNT_MISMATCH",
        expectedAmountMinor: transaction.amountMinor,
        receivedAmountMinor: event.amountMinor,
        notes: `Expected ${transaction.amountMinor} ${transaction.currency}, provider confirmed ${event.amountMinor} ${event.currency}.`,
      }, tx);
      await logPaymentAudit({
        businessId,
        transactionId: transaction.id,
        actorKind: "JATA_SYSTEM",
        action: "PAYMENT_AMOUNT_MISMATCH",
        summary: "Provider confirmation did not match the requested amount, so nothing was marked paid.",
        beforeState: { status: transaction.status, amountMinor: transaction.amountMinor },
        afterState: { receivedMinor: event.amountMinor, currency: event.currency },
      }, tx);
      return { kind: "amount_mismatch" as const, transactionId: transaction.id, expectedMinor: transaction.amountMinor, receivedMinor: event.amountMinor };
    }

    // ── Idempotency: a compare-and-set on the state, backed by unique indexes (§33) ──
    const currentStatus = transaction.status as PaymentStatus;
    if (!canTransition(currentStatus, "CONFIRMED")) {
      if (["CONFIRMED", "PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"].includes(currentStatus)) {
        return { kind: "duplicate" as const, transactionId: transaction.id };
      }
      // A definitive failure followed by a confirmation: money arrived for a payment JATA had
      // closed. Never silently re-open it — a person must look at this (§42, §44).
      await recordReconciliationException({
        businessId,
        transactionId: transaction.id,
        provider,
        providerReference: event.providerReference || transaction.providerReference,
        result: "UNCONFIRMED",
        expectedAmountMinor: transaction.amountMinor,
        receivedAmountMinor: event.amountMinor,
        notes: `A confirmation arrived after the payment was marked ${currentStatus}. Review before treating it as paid.`,
      }, tx);
      return { kind: "exception" as const, reason: `LATE_CONFIRMATION_${currentStatus}`, transactionId: transaction.id };
    }

    const claimed = await tx.paymentTransaction.updateMany({
      where: {
        id: transaction.id,
        businessId,
        status: { in: ["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING", "EXPIRED"] },
      },
      data: {
        status: "CONFIRMED",
        providerTransactionId: event.providerTransactionId ?? transaction.providerTransactionId ?? null,
        providerReference: transaction.providerReference ?? event.providerReference ?? null,
        providerConfirmedAt: event.occurredAt ?? new Date(),
        jataVerifiedAt: new Date(),
        amountPaidMinor: event.amountMinor,
        customerPhoneMasked: event.customerPhoneMasked ?? transaction.customerPhoneMasked ?? null,
        customerName: transaction.customerName ?? event.customerName ?? null,
      },
    });
    if (claimed?.count === 0) {
      // Another instance confirmed it between our read and our write: exactly one financial effect.
      return { kind: "duplicate" as const, transactionId: transaction.id };
    }

    await logPaymentAudit({
      businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: "PAYMENT_CONFIRMATION_RECEIVED",
      summary: `Provider confirmation received for ${transaction.jataPaymentId}.`,
      beforeState: { status: currentStatus },
      afterState: { status: "CONFIRMED", providerTransactionId: event.providerTransactionId ?? null, amountMinor: event.amountMinor },
    }, tx);
    await logPaymentAudit({
      businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: "PAYMENT_VERIFIED",
      summary: "Amount, currency, destination and tenant verified.",
      afterState: { amountMinor: event.amountMinor, currency: event.currency, matchedBy: located.how },
    }, tx);

    if (transaction.destinationId) {
      await tx.paymentDestination.updateMany({ where: { id: transaction.destinationId, businessId }, data: { lastEventAt: new Date() } });
    }
    if (transaction.provider) {
      await tx.paymentProviderConnection.updateMany({ where: { businessId, provider: transaction.provider }, data: { lastEventAt: new Date(), lastHealthyAt: new Date(), healthy: true } });
    }

    // ── Settle the POS sale this payment was for (§25, §37, §98) ─────────────
    let saleId: string | null = transaction.posSaleId ?? null;
    let paidStatus: PaymentStatus = "PAID";
    let receiptNumber: string | null = transaction.receiptNumber ?? null;
    const context = readPosContext(parseJson(transaction.paymentContext));
    if (!saleId && context?.pos) {
      const settled = await settlePosSale({ businessId, transaction, event, context, client: tx });
      if (!isOk(settled)) {
        // Rolling back here is deliberate: the caller records the exception outside the transaction.
        return { kind: "exception" as const, reason: settled.code, transactionId: transaction.id };
      }
      saleId = settled.saleId;
      paidStatus = settled.status as PaymentStatus;
      receiptNumber = settled.receiptNumber;
    }
    if (!receiptNumber && saleId) {
      const sale = await tx.posSale.findFirst({ where: { id: saleId, businessId } });
      receiptNumber = (sale?.receiptNumber as string | null) ?? null;
    }
    const token = receiptNumber ? (transaction.receiptToken ?? receiptToken()) : null;

    const updated = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: paidStatus,
        posSaleId: saleId,
        paidAt: new Date(),
        receiptNumber,
        receiptToken: token,
        receiptGeneratedAt: receiptNumber ? new Date() : transaction.receiptGeneratedAt ?? null,
      },
    });

    await logPaymentAudit({
      businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: paidStatus === "PAID" ? "PAYMENT_SETTLED" : "PAYMENT_PARTIALLY_SETTLED",
      summary: saleId ? "Sale settled from a verified provider confirmation." : "Payment recorded as paid; no POS sale was attached.",
      beforeState: { status: "CONFIRMED" },
      afterState: { status: paidStatus, posSaleId: saleId, receiptNumber },
    }, tx);

    await recordMatchedReconciliation({
      businessId,
      transactionId: transaction.id,
      provider: transaction.provider,
      providerReference: updated.providerReference ?? event.providerReference ?? null,
      expectedAmountMinor: transaction.amountMinor,
      receivedAmountMinor: event.amountMinor,
      currency: transaction.currency,
    }, tx);

    await ensureNotificationsForConfirmation({
      businessId,
      transaction: updated,
      destinationId: transaction.destinationId ?? null,
      saleId,
      client: tx,
    });

    return {
      kind: "settled" as const,
      transactionId: transaction.id,
      businessId,
      saleId,
      status: paidStatus,
      duplicate: false,
    };
  });

  // ── Asynchronous fan-out (§36, §100): notifications, realtime, never part of the money path ──
  if (outcome.kind === "settled" && !params.skipFanout) {
    publishPaymentEvent({
      businessId: outcome.businessId,
      transactionId: outcome.transactionId,
      status: outcome.status,
      at: new Date().toISOString(),
    });
  }

  return outcome;
}

/**
 * Creates the POS sale from the context captured when the payment was requested, inserting the
 * provider-confirmed payment as a settled row. If the re-priced total no longer equals what the
 * customer actually paid, the settlement is refused and the caller raises a reconciliation
 * exception — JATA never quietly books a different amount (§42, §98).
 */
async function settlePosSale(params: {
  businessId: string;
  transaction: any;
  event: ConfirmationEvent;
  context: PosPaymentContext;
  client: PaymentClient;
}): Promise<{ ok: true; saleId: string; status: PaymentStatus; receiptNumber: string | null } | { ok: false; code: string }> {
  const { businessId, transaction, event, context, client } = params;
  const pos = context.pos;
  if (!pos) return { ok: false, code: "NO_POS_CONTEXT" };

  const record = await loadConfiguration(businessId).catch(() => null);
  const configuration = effectiveConfiguration(record, "LIVE") ?? baselineConfiguration();
  const actor: PosActor = {
    actorId: pos.actor.actorId,
    actorName: pos.actor.actorName,
    roleKey: pos.actor.roleKey,
    // The permissions captured server-side at request time: a later staff change must not block a
    // payment the customer has already made.
    permissions: (pos.actor.permissions ?? []) as PosActor["permissions"],
    staffId: pos.actor.staffId,
    branchId: pos.actor.branchId,
  };

  const method = (transaction.method ?? pos.method ?? "mpesa").toLowerCase().includes("paystack") ? "card" : "mpesa";
  const request: SaleRequest = {
    ...pos.request,
    payments: [
      {
        method: pos.method || method,
        amountKES: minorToKes(event.amountMinor),
        reference: event.providerTransactionId ?? transaction.providerReference ?? transaction.jataPaymentId,
      },
    ],
  };

  const outcome = await createSale({
    businessId,
    business: pos.business,
    configuration,
    configurationVersion: pos.configurationVersion,
    configurationFingerprint: pos.configurationFingerprint,
    actor,
    request,
    client,
  });

  if (!outcome.ok || !outcome.sale) {
    return { ok: false, code: outcome.code ?? "SALE_NOT_CREATED" };
  }
  const totalKES = Number(outcome.totals?.totalKES ?? outcome.sale.totalKES ?? 0);
  if (Math.round(totalKES * 100) !== event.amountMinor) {
    // The cart was re-priced to something different from what the customer paid.
    throw new AmountDriftError(String(transaction.id), Math.round(totalKES * 100), event.amountMinor);
  }

  const status: PaymentStatus = Number(outcome.totals?.balanceKES ?? 0) > 0 ? "PARTIALLY_PAID" : "PAID";
  return { ok: true, saleId: String(outcome.sale.id), status, receiptNumber: outcome.sale.receiptNumber ?? null };
}

export class AmountDriftError extends Error {
  constructor(public transactionId: string, public rePricedMinor: number, public paidMinor: number) {
    super(`Re-priced total ${rePricedMinor} does not match the confirmed payment ${paidMinor}.`);
    this.name = "AmountDriftError";
  }
}

// ── Reversals, failures and expiries (§48, §68, §97) ─────────────────────────

/**
 * A provider reversed a payment. History is never rewritten (§114): a reversal row moves the
 * status forward, alerts the merchant, flags the order for review and records the adjustment.
 */
export async function applyReversal(params: {
  provider: ProviderKey | string;
  event: ReversalEvent;
  client?: PaymentClient;
}): Promise<ApplyResult> {
  const { provider, event } = params;
  const outcome = await inTransaction(params.client, async (tx: PaymentClient) => {
    const transaction = event.providerReference
      ? await tx.paymentTransaction.findFirst({ where: { provider, OR: [{ providerReference: event.providerReference }, { providerTransactionId: event.providerReference }] } })
      : event.providerTransactionId
        ? await tx.paymentTransaction.findFirst({ where: { provider, providerTransactionId: event.providerTransactionId } })
        : null;
    if (!transaction) return { kind: "no_match" as const, reason: "NO_MATCHING_TRANSACTION" };

    const businessId = String(transaction.businessId);
    const reversalMinor = event.amountMinor > 0 ? event.amountMinor : transaction.amountMinor;
    const status = transaction.status as PaymentStatus;
    if (status === "REVERSED") return { kind: "duplicate" as const, transactionId: transaction.id };
    if (!canTransition(status, "REVERSED")) {
      await recordReconciliationException({
        businessId,
        transactionId: transaction.id,
        provider,
        providerReference: transaction.providerReference,
        result: "UNCONFIRMED",
        expectedAmountMinor: transaction.amountMinor,
        receivedAmountMinor: reversalMinor,
        notes: `A reversal arrived for a payment in state ${status}.`,
      }, tx);
      return { kind: "exception" as const, reason: `REVERSAL_IN_STATE_${status}`, transactionId: transaction.id };
    }

    await tx.paymentTransaction.updateMany({
      where: { id: transaction.id, businessId, status: { in: ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "CONFIRMED"] } },
      data: { status: "REVERSED", amountRefundedMinor: Math.max(Number(transaction.amountRefundedMinor ?? 0), reversalMinor) },
    });
    await logPaymentAudit({
      businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: "PAYMENT_REVERSED",
      summary: event.reason ?? "The provider reversed this payment.",
      beforeState: { status },
      afterState: { status: "REVERSED", reversedMinor: reversalMinor },
    }, tx);

    if (transaction.posSaleId) {
      // Never leave a reversed payment looking validly paid: the till's own books move too (§48).
      await tx.posSale.updateMany({
        where: { id: transaction.posSaleId, businessId },
        data: { status: "REVERSED", notes: `Payment ${transaction.jataPaymentId} was reversed by the provider.` },
      });
      await tx.posPayment.create({
        data: {
          businessId,
          saleId: transaction.posSaleId,
          direction: "OUT",
          purpose: "REFUND",
          method: transaction.method ?? "mpesa",
          amountKES: minorToKes(reversalMinor),
          reference: transaction.providerTransactionId ?? transaction.providerReference ?? null,
          status: "SETTLED",
          notes: `Provider reversal for ${transaction.jataPaymentId}`,
        },
      });
    }

    await recordReconciliationException({
      businessId,
      transactionId: transaction.id,
      provider,
      providerReference: transaction.providerReference,
      result: "UNCONFIRMED",
      expectedAmountMinor: transaction.amountMinor,
      receivedAmountMinor: reversalMinor,
      notes: "Provider reversal: order flagged for review and accounting adjustment recorded.",
    }, tx);

    await ensureNotificationsForConfirmation({
      businessId,
      transaction: { ...transaction, status: "REVERSED" },
      destinationId: transaction.destinationId ?? null,
      saleId: transaction.posSaleId ?? null,
      client: tx,
      kind: "REVERSAL",
    });

    return { kind: "settled" as const, transactionId: transaction.id, businessId, saleId: transaction.posSaleId ?? null, status: "REVERSED" as PaymentStatus, duplicate: false };
  });

  if (outcome.kind === "settled") {
    publishPaymentEvent({ businessId: outcome.businessId, transactionId: outcome.transactionId, status: outcome.status, at: new Date().toISOString() });
  }
  return outcome;
}

/** A definitive provider failure. It can never be followed by an automatic PAID (§30, §31). */
export async function applyFailure(params: {
  provider: ProviderKey | string;
  event: FailureEvent;
  client?: PaymentClient;
}): Promise<ApplyResult> {
  const { provider, event } = params;
  return inTransaction(params.client, async (tx: PaymentClient) => {
    // An STK failure quotes the CheckoutRequestID rather than JATA's reference, so the provider's
    // own handle is the second, equally authoritative way to find the attempt it belongs to (§64).
    const transaction =
      (event.providerReference
        ? await tx.paymentTransaction.findFirst({ where: { provider, providerReference: event.providerReference } })
        : null) ??
      (event.providerTransactionId
        ? await tx.paymentTransaction.findFirst({ where: { provider, providerTransactionId: event.providerTransactionId } })
        : null);
    if (!transaction) return { kind: "no_match" as const, reason: "NO_MATCHING_TRANSACTION" };
    const businessId = String(transaction.businessId);
    const status = transaction.status as PaymentStatus;
    if (!canTransition(status, "FAILED")) return { kind: "duplicate" as const, transactionId: transaction.id };

    await tx.paymentTransaction.updateMany({
      where: { id: transaction.id, businessId, status: { in: ["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING"] } },
      data: { status: "FAILED", failureCode: event.code.slice(0, 64), failureReason: event.message.slice(0, 300) },
    });
    await logPaymentAudit({
      businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: "PAYMENT_FAILED",
      summary: event.message,
      beforeState: { status },
      afterState: { status: "FAILED", code: event.code },
    }, tx);
    await ensureNotificationsForConfirmation({
      businessId,
      transaction: { ...transaction, status: "FAILED", failureReason: event.message },
      destinationId: transaction.destinationId ?? null,
      saleId: null,
      client: tx,
      kind: "FAILURE",
    });
    return { kind: "exception" as const, reason: "PAYMENT_FAILED", transactionId: transaction.id };
  });
}

/**
 * §68: a payment JATA has stopped waiting for. This is *not* a provider failure and it is not a
 * refund — it is JATA saying "we no longer have an open request", and the payment stays
 * reconcilable if a late confirmation arrives.
 */
export async function expireStalePayments(params: { businessId?: string; now?: Date; limit?: number; client?: PaymentClient } = {}) {
  const now = params.now ?? new Date();
  const client = params.client ?? prisma;
  const stale = await client.paymentTransaction.findMany({
    where: {
      ...(params.businessId ? { businessId: params.businessId } : {}),
      status: { in: ["PAYMENT_REQUESTED", "PENDING", "PROCESSING", "CREATED"] },
      expiresAt: { not: null, lte: now },
    },
    take: params.limit ?? 200,
  });
  let expired = 0;
  for (const row of stale ?? []) {
    const claimed = await client.paymentTransaction.updateMany({
      where: { id: row.id, status: { in: ["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING"] } },
      data: { status: "EXPIRED" },
    });
    if (claimed?.count) {
      expired += 1;
      await logPaymentAudit({
        businessId: String(row.businessId),
        transactionId: row.id,
        actorKind: "JATA_SYSTEM",
        action: "PAYMENT_EXPIRED",
        summary: "JATA stopped waiting for confirmation. The payment is still reconcilable if a confirmation arrives later.",
        beforeState: { status: row.status, expiresAt: row.expiresAt },
        afterState: { status: "EXPIRED" },
      }, client);
      publishPaymentEvent({ businessId: String(row.businessId), transactionId: row.id, status: "EXPIRED", at: new Date().toISOString() });
    }
  }
  return { expired };
}

/** Server-side status re-check (§67, §68): ask the provider, then apply what it says. */
export async function refreshStatus(params: {
  businessId: string;
  transaction: any;
  destination: any;
  now?: Date;
  fetchImpl?: typeof fetch;
  client?: PaymentClient;
}) {
  const adapter = getAdapter(params.transaction.provider);
  if (!adapter) return { checked: false, status: params.transaction.status as PaymentStatus, message: null as string | null };
  const ctx = adapterContext(params.now ?? new Date(), { fetchImpl: params.fetchImpl, verifyWithProvider: true });
  const report = await adapter.getPaymentStatus(params.transaction as TransactionRecord, params.destination, ctx);
  if (report.status === "CONFIRMED") {
    const applied = await applyConfirmation({
      provider: params.transaction.provider,
      event: {
        kind: "confirmation",
        providerReference: params.transaction.providerReference ?? "",
        providerTransactionId: report.providerTransactionId ?? params.transaction.providerTransactionId ?? null,
        amountMinor: report.amountMinor ?? params.transaction.amountMinor,
        currency: report.currency ?? params.transaction.currency,
        destination: { kind: null, providerDestinationId: null, providerAccountRef: null },
        method: params.transaction.method ?? "UNKNOWN",
        customerName: null,
        customerPhoneMasked: null,
        occurredAt: params.now ?? new Date(),
        sanitized: { source: "STATUS_QUERY" },
      },
      client: params.client,
    });
    return { checked: true, status: (applied.kind === "settled" ? applied.status : params.transaction.status) as PaymentStatus, message: report.message };
  }
  if (report.status === "FAILED") {
    await applyFailure({
      provider: params.transaction.provider,
      event: {
        kind: "failure",
        providerReference: params.transaction.providerReference ?? "",
        providerTransactionId: params.transaction.providerTransactionId ?? null,
        code: "PROVIDER_STATUS_FAILED",
        message: report.message ?? "The provider reports this payment was not completed.",
        sanitized: { source: "STATUS_QUERY" },
      },
      client: params.client,
    });
    return { checked: true, status: "FAILED" as PaymentStatus, message: report.message };
  }
  return { checked: true, status: params.transaction.status as PaymentStatus, message: report.message };
}

/** Masked phone for the audit trail — the only phone shape JATA stores (§59). */
export function safeCustomerPhone(phone: unknown): string | null {
  return maskPhone(phone);
}
