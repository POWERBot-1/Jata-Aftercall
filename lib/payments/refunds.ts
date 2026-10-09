/**
 * Refunds and reversals (§47, §48, §114).
 *
 * A refund is a request to the provider plus a new adjustment row — never an edit of the original
 * payment. The original amount, the original provider reference and the original receipt stay
 * exactly as they were; the refunded total moves forward, the status moves forward, and a person's
 * name and reason are attached.
 *
 * A PostgreSQL row lock on the payment is the refund reservation boundary. A REQUESTED refund row
 * is committed while that lock is held, before any provider call; every later request locks the same
 * payment and counts COMPLETED amounts plus REQUESTED/PENDING_PROVIDER reservations. Provider I/O
 * therefore cannot leave a gap in which two callers both spend the same refundable balance.
 */

import { canBeRefunded, isPaidStatus, type PaymentStatus } from "./states";
import { logPaymentAudit } from "./audit";
import { adapterContext, db, type PaymentClient } from "./context";
import { getAdapter } from "./providers/registry";
import { ensureNotificationsForConfirmation } from "./notifications";
import { recordReconciliationException } from "./reconciliation";
import { publishPaymentEvent } from "./realtime";
import { minorToKes } from "./money";
import { restoreRefundedSaleStock } from "@/lib/pos/sales";
import type { ProviderReversalResult } from "./providers/types";
import type { TransactionRecord } from "./types";

const RESERVED_REFUND_STATUSES = ["REQUESTED", "PENDING_PROVIDER"] as const;

/**
 * A refund whose provider outcome is not known is PENDING_PROVIDER (the amount stays reserved) with
 * this marker at the start of `failureReason`. The provider may still complete it, so it is neither
 * released for a retry nor reported as done — it waits for the authenticated result, or for a
 * person to check the provider's own records.
 */
export const REFUND_OUTCOME_UNKNOWN_MARKER = "OUTCOME UNKNOWN — ";

/** The explicit lifecycle of a refund, derived from the stored row (no schema change). */
export type RefundOutcomeState = "RESERVED" | "AWAITING_PROVIDER" | "UNKNOWN" | "COMPLETED" | "FAILED" | "REJECTED";

export function refundOutcomeState(refund: { status?: unknown; providerReference?: unknown; failureReason?: unknown }): RefundOutcomeState {
  const status = String(refund?.status ?? "");
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "FAILED") return "FAILED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "REQUESTED") return "RESERVED";
  // PENDING_PROVIDER: accepted and awaiting a result — unless JATA has no conversation id to match
  // a result to, or the provider reported that its queue timed out. Then the outcome is unknown.
  if (!refund?.providerReference || String(refund?.failureReason ?? "").startsWith(REFUND_OUTCOME_UNKNOWN_MARKER)) return "UNKNOWN";
  return "AWAITING_PROVIDER";
}

export type RefundActor = {
  actorId: string | null;
  actorName: string | null;
  roleKey: string;
  permissions: string[];
  /** Re-authentication marker required for high-risk money movement (§62). */
  confirmed: boolean;
};

export type RefundOutcome =
  | { ok: true; refundId: string; status: string; amountKES: number; message: string; remainingKES: number }
  | { ok: false; code: string; message: string; /** The provider may still complete this refund; the amount stays reserved. */ outcomeUnknown?: boolean };

function minorFromKes(value: unknown): number {
  const amountMinor = Math.round(Number(value ?? 0) * 100);
  return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : 0;
}

function paidMinor(transaction: {
  amountPaidMinor?: unknown;
  amountMinor?: unknown;
  paidKES?: unknown;
  amountKES?: unknown;
}): number {
  const amountPaidMinor = Number(transaction.amountPaidMinor ?? 0);
  const amountMinor = Number(transaction.amountMinor ?? 0);
  if (amountPaidMinor || amountMinor) return amountPaidMinor || amountMinor;
  // Merchant read models use KES major units; preserve an explicit paidKES: 0 rather than
  // falling back to the gross amountKES for an unpaid payment.
  if (transaction.paidKES != null) return minorFromKes(transaction.paidKES);
  if (transaction.amountKES != null) return minorFromKes(transaction.amountKES);
  return 0;
}

/** The most a payment can still be refunded, in minor units (§47), after active reservations. */
export function refundableMinor(
  transaction: { amountPaidMinor?: unknown; amountRefundedMinor?: unknown; amountMinor?: unknown },
  outstandingRefundMinor = 0,
): number {
  const refunded = Number(transaction.amountRefundedMinor ?? 0);
  return Math.max(0, paidMinor(transaction) - refunded - Math.max(0, Number(outstandingRefundMinor) || 0));
}

export function refundValidation(params: {
  transaction: any;
  amountKES: number;
  outstandingRefundMinor?: number;
}): { ok: boolean; amountMinor: number; code?: string; message?: string } {
  const transaction = params.transaction ?? {};
  const status = String(transaction.status ?? "") as PaymentStatus;
  if (!isPaidStatus(status) && status !== "CONFIRMED") {
    return { ok: false, amountMinor: 0, code: "NOT_REFUNDABLE", message: "Only a payment that has been received can be refunded." };
  }
  if (!canBeRefunded(status)) {
    return { ok: false, amountMinor: 0, code: "NOT_REFUNDABLE", message: "This payment is already fully refunded or reversed." };
  }
  const amountMinor = Math.round(Number(params.amountKES ?? 0) * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, amountMinor: 0, code: "AMOUNT_REQUIRED", message: "Enter the amount to refund." };
  }
  const available = refundableMinor(transaction, params.outstandingRefundMinor ?? 0);
  if (amountMinor > available) {
    return {
      ok: false,
      amountMinor: 0,
      code: "AMOUNT_TOO_HIGH",
      message: `Only KES ${minorToKes(available).toLocaleString("en-KE")} of this payment is left to refund.`,
    };
  }
  return { ok: true, amountMinor };
}

/**
 * Open an explicit READ COMMITTED transaction for root Prisma clients. After a caller waits on
 * SELECT ... FOR UPDATE, the following refund aggregate sees the reservation committed by the
 * previous lock holder. A supplied transaction client is already inside its caller's transaction.
 */
function refundTransaction<T>(client: PaymentClient, work: (tx: PaymentClient) => Promise<T>): Promise<T> {
  // Prisma transaction clients expose model delegates/raw queries but not $transaction. Root clients,
  // including explicitly injected clients, always open the lock-owning transaction here.
  if (typeof client?.$transaction === "function") {
    return client.$transaction(work, { isolationLevel: "ReadCommitted" });
  }
  return work(client);
}

/** PostgreSQL serialization point shared by reservation, completion and release paths. */
async function lockPaymentForRefund(tx: PaymentClient, businessId: string, transactionId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("Refund safety requires PostgreSQL row-level locking.");
  }
  await tx.$queryRaw`
    SELECT "id"
      FROM "PaymentTransaction"
     WHERE "id" = ${transactionId}
       AND "businessId" = ${businessId}
     FOR UPDATE
  `;
  return tx.paymentTransaction.findFirst({ where: { id: transactionId, businessId } });
}

async function refundRowsMinor(
  tx: PaymentClient,
  businessId: string,
  transactionId: string,
  statuses: readonly string[],
): Promise<number> {
  const result = await tx.refund.aggregate({
    where: { businessId, transactionId, status: { in: [...statuses] } },
    _sum: { amountMinor: true },
  });
  return Math.max(0, Number(result?._sum?.amountMinor ?? 0));
}

async function outstandingRefundMinor(tx: PaymentClient, businessId: string, transactionId: string): Promise<number> {
  return refundRowsMinor(tx, businessId, transactionId, RESERVED_REFUND_STATUSES);
}

async function completedRefundMinor(tx: PaymentClient, businessId: string, transactionId: string): Promise<number> {
  return refundRowsMinor(tx, businessId, transactionId, ["COMPLETED"]);
}

function notFound(): RefundOutcome {
  return { ok: false, code: "NOT_FOUND", message: "That payment was not found for this business." };
}

/**
 * Requests a refund. The amount is reserved atomically before calling the provider. An accepted
 * M-PESA reversal remains PENDING_PROVIDER (and therefore reserved) until its authenticated result
 * callback confirms success or failure.
 */
export async function requestRefund(params: {
  businessId: string;
  transactionId: string;
  amountKES: number;
  reason: string;
  actor: RefundActor;
  now?: Date;
  fetchImpl?: typeof fetch;
  client?: PaymentClient;
}): Promise<RefundOutcome> {
  const client = params.client ?? db();
  // `checkPermission` needs a full tenant configuration to answer; the wallet routes resolve the
  // actor's permission set once with `requirePosAccess` and pass the resolved keys here, so the
  // guard is a membership test over the same permission key (§57, §62).
  if (!Array.isArray(params.actor.permissions) || !params.actor.permissions.includes("REFUND_PAYMENT")) {
    return { ok: false, code: "NOT_ALLOWED", message: "Only an owner or manager can refund a payment." };
  }
  if (!params.actor.confirmed) {
    return { ok: false, code: "CONFIRMATION_REQUIRED", message: "Confirm the refund before it is sent to the provider." };
  }
  const reason = String(params.reason ?? "").trim();
  if (reason.length < 4) {
    return { ok: false, code: "REASON_REQUIRED", message: "Give a reason for this refund." };
  }

  // This first tenant-scoped read only selects the provider adapter. The refundable balance is
  // deliberately not checked here: that happens after the payment row is locked below.
  const initialTransaction = await client.paymentTransaction.findFirst({
    where: { id: params.transactionId, businessId: params.businessId },
  });
  if (!initialTransaction) return notFound();
  const adapter = getAdapter(initialTransaction.provider);
  if (!adapter) return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "This payment provider is not supported yet." };

  const reservation = await refundTransaction(client, async (tx: PaymentClient) => {
    const transaction = await lockPaymentForRefund(tx, params.businessId, params.transactionId);
    if (!transaction) return { ok: false as const, outcome: notFound() };

    const [outstanding, completedRowsMinor] = await Promise.all([
      outstandingRefundMinor(tx, params.businessId, transaction.id),
      completedRefundMinor(tx, params.businessId, transaction.id),
    ]);
    // The refund ledger is authoritative too; max protects against older/out-of-sync aggregate
    // fields without double-counting rows already reflected in amountRefundedMinor.
    const alreadyRefundedMinor = Math.max(Number(transaction.amountRefundedMinor ?? 0), completedRowsMinor);
    const validation = refundValidation({
      transaction: { ...transaction, amountRefundedMinor: alreadyRefundedMinor },
      amountKES: params.amountKES,
      outstandingRefundMinor: outstanding,
    });
    if (!validation.ok) {
      return {
        ok: false as const,
        outcome: {
          ok: false as const,
          code: validation.code ?? "NOT_REFUNDABLE",
          message: validation.message ?? "This payment cannot be refunded.",
        },
      };
    }

    // The provider's own limits (full amount only, receipt required, initiator configured) are
    // checked while the payment row is locked and *before* anything is reserved or sent, so an
    // impossible refund leaves no reservation, no provider call and no failed-refund row behind.
    const destinationRow = transaction.destinationId
      ? await tx.paymentDestination.findFirst({ where: { id: transaction.destinationId, businessId: params.businessId } })
      : null;
    const providerCheck = adapter.validateRefund?.({
      transaction: transaction as TransactionRecord,
      destination: destinationRow,
      amountMinor: validation.amountMinor,
      alreadyRefundedMinor,
      outstandingMinor: outstanding,
    });
    if (providerCheck && !providerCheck.ok) {
      return {
        ok: false as const,
        outcome: {
          ok: false as const,
          code: providerCheck.code ?? "NOT_REFUNDABLE",
          message: providerCheck.message ?? "This payment cannot be refunded through the provider.",
        },
      };
    }

    const refund = await tx.refund.create({
      data: {
        businessId: params.businessId,
        transactionId: transaction.id,
        provider: transaction.provider,
        amountMinor: validation.amountMinor,
        currency: transaction.currency,
        status: "REQUESTED",
        reason: reason.slice(0, 300),
        initiatedById: params.actor.actorId,
        initiatedByName: params.actor.actorName,
      },
    });
    const remainingAfterReservation = Math.max(0, paidMinor(transaction) - alreadyRefundedMinor - outstanding - validation.amountMinor);
    await logPaymentAudit({
      businessId: params.businessId,
      transactionId: transaction.id,
      actorKind: "MERCHANT_STAFF",
      actorId: params.actor.actorId,
      actorName: params.actor.actorName,
      action: "REFUND_REQUESTED",
      summary: "Refund amount reserved before contacting the payment provider.",
      beforeState: {
        status: transaction.status,
        amountRefundedMinor: transaction.amountRefundedMinor ?? 0,
        completedRefundRowsMinor: completedRowsMinor,
        outstandingRefundMinor: outstanding,
      },
      afterState: { refundMinor: validation.amountMinor, status: "REQUESTED", remainingRefundableMinor: remainingAfterReservation },
      reason,
    }, tx);

    return { ok: true as const, refundId: String(refund.id), transaction, amountMinor: validation.amountMinor };
  });
  if (!reservation.ok) return reservation.outcome;

  const transaction = reservation.transaction;
  const destination = transaction.destinationId
    ? await client.paymentDestination.findFirst({
        where: { id: transaction.destinationId, businessId: params.businessId },
      })
    : null;
  const ctx = adapterContext(params.now ?? new Date(), { fetchImpl: params.fetchImpl, verifyWithProvider: true });

  let result: ProviderReversalResult;
  let providerOutcomeUnknown = false;
  try {
    result = await adapter.refund(
      {
        transaction: transaction as TransactionRecord,
        destination,
        amountMinor: reservation.amountMinor,
        reason,
      },
      ctx,
    );
  } catch {
    // A network exception can mean the provider accepted the request but its response was lost.
    // Keep the reservation visible and unresolved rather than retrying money movement blindly.
    providerOutcomeUnknown = true;
    result = {
      ok: false,
      code: "PROVIDER_RESULT_UNKNOWN",
      message: "JATA could not confirm the provider's response. This refund is reserved for reconciliation.",
      retryable: true,
    };
  }

  if (result.ok === false && result.outcomeUnknown) providerOutcomeUnknown = true;
  // When the adapter returns a providerReference the refund is awaiting an authenticated
  // asynchronous result from the provider (M-PESA reversal result or Paystack refund.processed);
  // that's when the reservation must stay booked. A successful response without a follow-up
  // reference can be treated as final only if the provider confirmed the money moved.
  const asyncProviderAwaited = result.ok && result.providerReference;
  const status = result.ok
    ? (asyncProviderAwaited ? "PENDING_PROVIDER" : "COMPLETED")
    : (providerOutcomeUnknown ? "PENDING_PROVIDER" : "FAILED");
  const finalized = await refundTransaction(client, async (tx: PaymentClient) => {
    const currentTransaction = await lockPaymentForRefund(tx, params.businessId, transaction.id);
    if (!currentTransaction) throw new Error("Refund payment disappeared before finalization.");
    const refund = await tx.refund.findFirst({
      where: { id: reservation.refundId, businessId: params.businessId, transactionId: transaction.id },
    });
    if (!refund || refund.status !== "REQUESTED") {
      throw new Error("Refund reservation was not in the expected state.");
    }

    const updated = await tx.refund.updateMany({
      where: { id: refund.id, businessId: params.businessId, transactionId: transaction.id, status: "REQUESTED" },
      data: {
        status,
        providerReference: result.ok ? result.providerReference ?? null : null,
        failureReason: result.ok
          ? null
          : (providerOutcomeUnknown ? `${REFUND_OUTCOME_UNKNOWN_MARKER}${result.message}` : result.message).slice(0, 300),
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
    });
    if (updated.count !== 1) throw new Error("Refund reservation changed before finalization.");

    let restored = { returnedToStock: 0, restoredLines: 0 };
    if (status === "COMPLETED") {
      const applied = await applyRefundedTotals({
        businessId: params.businessId,
        transaction: currentTransaction,
        amountMinor: reservation.amountMinor,
        client: tx,
      });
      restored = applied.restored;
    }

    const action = status === "COMPLETED"
      ? "REFUND_COMPLETED"
      : status === "FAILED"
        ? "REFUND_FAILED"
        : providerOutcomeUnknown
          ? "REFUND_OUTCOME_UNKNOWN"
          : "REFUND_REQUESTED";
    const summary = status === "COMPLETED"
      ? (restored.returnedToStock > 0
        ? `Refund completed through the provider: ${result.message} ${restored.returnedToStock} unit${restored.returnedToStock === 1 ? "" : "s"} went back into stock.`
        : `Refund completed through the provider: ${result.message}`)
      : status === "FAILED"
        ? `Refund could not be completed through the provider: ${result.message}`
        : `Refund is awaiting provider confirmation: ${result.message}`;
    await logPaymentAudit({
      businessId: params.businessId,
      transactionId: transaction.id,
      actorKind: "MERCHANT_STAFF",
      actorId: params.actor.actorId,
      actorName: params.actor.actorName,
      action,
      summary,
      beforeState: { status: currentTransaction.status, amountRefundedMinor: currentTransaction.amountRefundedMinor ?? 0 },
      afterState: {
        refundMinor: reservation.amountMinor,
        refundStatus: status,
        providerReference: result.ok ? result.providerReference ?? null : null,
        returnedToStock: restored.returnedToStock,
        restoredLines: restored.restoredLines,
      },
      reason,
    }, tx);

    if (!result.ok) {
      await recordReconciliationException({
        businessId: params.businessId,
        transactionId: transaction.id,
        provider: transaction.provider,
        providerReference: transaction.providerReference,
        result: "UNCONFIRMED",
        expectedAmountMinor: transaction.amountMinor,
        receivedAmountMinor: reservation.amountMinor,
        notes: `${providerOutcomeUnknown ? "Provider response was inconclusive" : "Refund could not be completed through the provider"}: ${result.message}`,
      }, tx);
    }

    const refreshed = await tx.paymentTransaction.findFirst({ where: { id: transaction.id, businessId: params.businessId } });
    const stillReserved = await outstandingRefundMinor(tx, params.businessId, transaction.id);
    return {
      status,
      remainingMinor: refundableMinor(refreshed ?? currentTransaction, stillReserved),
      transaction: refreshed ?? currentTransaction,
    };
  });

  if (status === "COMPLETED") {
    await emitRefundUpdate({ businessId: params.businessId, transaction: finalized.transaction, client });
  }

  if (result.ok === false) {
    return { ok: false, code: result.code, message: result.message, ...(providerOutcomeUnknown ? { outcomeUnknown: true } : {}) };
  }

  return {
    ok: true,
    refundId: reservation.refundId,
    status,
    amountKES: minorToKes(reservation.amountMinor),
    message: result.message,
    remainingKES: minorToKes(finalized.remainingMinor),
  };
}

async function emitRefundUpdate(params: { businessId: string; transaction: any; client: PaymentClient }) {
  const transaction = params.transaction;
  await ensureNotificationsForConfirmation({
    businessId: params.businessId,
    transaction,
    destinationId: transaction.destinationId ?? null,
    saleId: transaction.posSaleId ?? null,
    client: params.client,
    kind: "REVERSAL",
  }).catch(() => undefined);
  publishPaymentEvent({
    businessId: params.businessId,
    transactionId: transaction.id,
    status: String(transaction.status ?? "PARTIALLY_REFUNDED"),
    at: new Date().toISOString(),
  });
}

/**
 * Resolve an asynchronous provider refund/reversal result by its provider-issued refund reference.
 * Unknown, duplicate or mismatched events do not release the outstanding reservation.
 */
export async function resolvePendingProviderRefund(params: {
  provider: string;
  providerReference: string;
  succeeded: boolean;
  amountMinor?: number | null;
  failureReason?: string | null;
  /** The receipt of the payment the result says was reversed — a fallback way to find the refund. */
  originalTransactionId?: string | null;
  client?: PaymentClient;
}): Promise<
  | { matched: false }
  | { matched: true; kind: "settled" | "failed" | "exception" | "duplicate"; transactionId?: string; businessId?: string; status?: PaymentStatus; reason?: string }
> {
  const client = params.client ?? db();
  const providerReference = String(params.providerReference ?? "").trim();
  const originalTransactionId = String(params.originalTransactionId ?? "").trim();
  if (!providerReference && !originalTransactionId) return { matched: false };

  let candidates: any[] = providerReference
    ? await client.refund.findMany({
        where: { provider: params.provider, providerReference },
        orderBy: { createdAt: "asc" },
        take: 2,
      })
    : [];
  // A result whose conversation id matches no refund (the synchronous answer that would have
  // recorded it was lost) is still tied back by the receipt it reversed — but only when exactly
  // one open refund on exactly one payment carries that receipt.
  let correlatedByOriginal = false;
  if (!candidates?.length && originalTransactionId) {
    const correlated = await findPendingRefundByOriginalTransaction(client, params.provider, originalTransactionId);
    if (correlated.ambiguous) return { matched: true, kind: "exception", reason: "AMBIGUOUS_PROVIDER_REFUND_REFERENCE" };
    if (correlated.refund) {
      candidates = [correlated.refund];
      correlatedByOriginal = true;
    }
  }
  if (!candidates?.length) return { matched: false };
  if (candidates.length !== 1) {
    return { matched: true, kind: "exception", reason: "AMBIGUOUS_PROVIDER_REFUND_REFERENCE" };
  }

  const candidate = candidates[0];
  // When the refund was found by the reversed receipt, its stored reference is empty or stale:
  // record the conversation id the provider used, so the trail ties both ends together.
  const backfillReference = correlatedByOriginal && providerReference && !candidate.providerReference ? { providerReference } : {};
  const outcome = await refundTransaction(client, async (tx: PaymentClient) => {
    const transaction = await lockPaymentForRefund(tx, candidate.businessId, candidate.transactionId);
    if (!transaction) return { matched: true as const, kind: "exception" as const, transactionId: candidate.transactionId, businessId: candidate.businessId, reason: "REFUND_PAYMENT_NOT_FOUND" };
    const refund = await tx.refund.findFirst({
      where: {
        id: candidate.id,
        businessId: candidate.businessId,
        transactionId: candidate.transactionId,
        provider: params.provider,
        ...(correlatedByOriginal ? {} : { providerReference }),
      },
    });
    if (!refund) return { matched: true as const, kind: "exception" as const, transactionId: transaction.id, businessId: transaction.businessId, reason: "REFUND_NOT_FOUND" };
    if (refund.status === "COMPLETED" || refund.status === "FAILED" || refund.status === "REJECTED") {
      return { matched: true as const, kind: "duplicate" as const, transactionId: transaction.id, businessId: transaction.businessId, status: transaction.status as PaymentStatus };
    }
    if (refund.status !== "REQUESTED" && refund.status !== "PENDING_PROVIDER") {
      return { matched: true as const, kind: "exception" as const, transactionId: transaction.id, businessId: transaction.businessId, reason: "REFUND_NOT_PENDING" };
    }

    if (params.succeeded && Number(params.amountMinor ?? 0) !== Number(refund.amountMinor)) {
      const received = params.amountMinor == null ? null : Number(params.amountMinor);
      const notes = received === null
        ? "The provider reported a successful reversal without an amount that can be matched to the refund reservation. The reservation remains pending for review."
        : "The provider's reversal amount did not match the reserved refund amount. The reservation remains pending for review.";
      await recordReconciliationException({
        businessId: transaction.businessId,
        transactionId: transaction.id,
        provider: params.provider,
        providerReference,
        result: "UNCONFIRMED",
        expectedAmountMinor: refund.amountMinor,
        receivedAmountMinor: received,
        notes,
      }, tx);
      await logPaymentAudit({
        businessId: transaction.businessId,
        transactionId: transaction.id,
        actorKind: "JATA_SYSTEM",
        action: "PAYMENT_NEEDS_REVIEW",
        summary: notes,
        beforeState: { refundStatus: refund.status, refundMinor: refund.amountMinor },
        afterState: { providerAmountMinor: received, reservationReleased: false },
      }, tx);
      return { matched: true as const, kind: "exception" as const, transactionId: transaction.id, businessId: transaction.businessId, reason: "REFUND_AMOUNT_MISMATCH" };
    }

    if (!params.succeeded) {
      const message = String(params.failureReason ?? "The provider did not complete this refund.").slice(0, 300);
      const changed = await tx.refund.updateMany({
        where: { id: refund.id, businessId: transaction.businessId, transactionId: transaction.id, status: { in: ["REQUESTED", "PENDING_PROVIDER"] } },
        data: { status: "FAILED", failureReason: message, completedAt: null, ...backfillReference },
      });
      if (changed.count !== 1) return { matched: true as const, kind: "duplicate" as const, transactionId: transaction.id, businessId: transaction.businessId };
      await logPaymentAudit({
        businessId: transaction.businessId,
        transactionId: transaction.id,
        actorKind: "JATA_SYSTEM",
        action: "REFUND_FAILED",
        summary: `Provider confirmed that the refund failed: ${message}`,
        beforeState: { refundStatus: refund.status },
        afterState: { refundStatus: "FAILED", reservationReleased: true },
        reason: message,
      }, tx);
      await recordReconciliationException({
        businessId: transaction.businessId,
        transactionId: transaction.id,
        provider: params.provider,
        providerReference,
        result: "UNCONFIRMED",
        expectedAmountMinor: refund.amountMinor,
        receivedAmountMinor: params.amountMinor ?? null,
        notes: `Provider confirmed refund failure: ${message}`,
      }, tx);
      return { matched: true as const, kind: "failed" as const, transactionId: transaction.id, businessId: transaction.businessId };
    }

    const changed = await tx.refund.updateMany({
      where: { id: refund.id, businessId: transaction.businessId, transactionId: transaction.id, status: { in: ["REQUESTED", "PENDING_PROVIDER"] } },
      data: { status: "COMPLETED", failureReason: null, completedAt: new Date(), ...backfillReference },
    });
    if (changed.count !== 1) return { matched: true as const, kind: "duplicate" as const, transactionId: transaction.id, businessId: transaction.businessId };

    const completedRowsMinor = await completedRefundMinor(tx, transaction.businessId, transaction.id);
    const amountRefundedNext = Math.min(
      paidMinor(transaction),
      Math.max(Number(transaction.amountRefundedMinor ?? 0) + Number(refund.amountMinor), completedRowsMinor),
    );
    const applied = await applyRefundedTotals({
      businessId: transaction.businessId,
      transaction,
      amountMinor: Number(refund.amountMinor),
      client: tx,
    });
    await logPaymentAudit({
      businessId: transaction.businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: "REFUND_COMPLETED",
      summary: applied.restored.returnedToStock > 0
        ? `The provider confirmed the reserved refund. ${applied.restored.returnedToStock} unit${applied.restored.returnedToStock === 1 ? "" : "s"} went back into stock.`
        : "The provider confirmed the reserved refund.",
      beforeState: { refundStatus: refund.status, amountRefundedMinor: transaction.amountRefundedMinor ?? 0 },
      afterState: {
        refundStatus: "COMPLETED",
        amountRefundedMinor: amountRefundedNext,
        returnedToStock: applied.restored.returnedToStock,
        restoredLines: applied.restored.restoredLines,
      },
      reason: refund.reason,
    }, tx);
    const refreshed = await tx.paymentTransaction.findFirst({ where: { id: transaction.id, businessId: transaction.businessId } });
    await ensureNotificationsForConfirmation({
      businessId: transaction.businessId,
      transaction: refreshed ?? { ...transaction, status: applied.status },
      destinationId: transaction.destinationId ?? null,
      saleId: transaction.posSaleId ?? null,
      client: tx,
      kind: "REVERSAL",
    }).catch(() => undefined);
    return {
      matched: true as const,
      kind: "settled" as const,
      transactionId: transaction.id,
      businessId: transaction.businessId,
      status: (refreshed?.status ?? applied.status) as PaymentStatus,
    };
  });
  return outcome;
}

/** The one open refund on the one payment that carries this M-PESA receipt, or "ambiguous". */
async function findPendingRefundByOriginalTransaction(
  client: PaymentClient,
  provider: string,
  originalTransactionId: string,
): Promise<{ refund: any | null; ambiguous: boolean }> {
  const transactions = await client.paymentTransaction.findMany({
    where: { provider, OR: [{ providerReceipt: originalTransactionId }, { providerTransactionId: originalTransactionId }] },
    take: 3,
  });
  if (!transactions?.length) return { refund: null, ambiguous: false };
  if (transactions.length > 1) return { refund: null, ambiguous: true };
  const refunds = await client.refund.findMany({
    where: {
      businessId: transactions[0].businessId,
      transactionId: transactions[0].id,
      provider,
      status: { in: [...RESERVED_REFUND_STATUSES] },
    },
    orderBy: { createdAt: "asc" },
    take: 3,
  });
  if (!refunds?.length) return { refund: null, ambiguous: false };
  if (refunds.length > 1) return { refund: null, ambiguous: true };
  return { refund: refunds[0], ambiguous: false };
}

/**
 * A reversal QueueTimeOut notice (M-PESA): the provider's queue gave up, which is NOT a verdict —
 * the reversal may still be processed. The refund therefore stays PENDING_PROVIDER with its amount
 * reserved (so it cannot be re-sent or double-spent), is marked with an explicit unknown outcome,
 * and is surfaced for a person to check the provider's records. It is never released as a failure.
 */
export async function recordPendingProviderRefundTimeout(params: {
  provider: string;
  providerReference?: string | null;
  originalTransactionId?: string | null;
  client?: PaymentClient;
}): Promise<
  | { matched: false }
  | { matched: true; kind: "unknown" | "duplicate" | "exception"; transactionId?: string; businessId?: string; reason?: string }
> {
  const client = params.client ?? db();
  const providerReference = String(params.providerReference ?? "").trim();
  const originalTransactionId = String(params.originalTransactionId ?? "").trim();
  if (!providerReference && !originalTransactionId) return { matched: false };

  let candidates: any[] = providerReference
    ? await client.refund.findMany({ where: { provider: params.provider, providerReference }, orderBy: { createdAt: "asc" }, take: 2 })
    : [];
  let correlatedByOriginal = false;
  if (!candidates?.length && originalTransactionId) {
    const correlated = await findPendingRefundByOriginalTransaction(client, params.provider, originalTransactionId);
    if (correlated.ambiguous) return { matched: true, kind: "exception", reason: "AMBIGUOUS_PROVIDER_REFUND_REFERENCE" };
    if (correlated.refund) {
      candidates = [correlated.refund];
      correlatedByOriginal = true;
    }
  }
  if (!candidates?.length) return { matched: false };
  if (candidates.length !== 1) return { matched: true, kind: "exception", reason: "AMBIGUOUS_PROVIDER_REFUND_REFERENCE" };
  const candidate = candidates[0];

  return refundTransaction(client, async (tx: PaymentClient) => {
    const transaction = await lockPaymentForRefund(tx, candidate.businessId, candidate.transactionId);
    if (!transaction) return { matched: true as const, kind: "exception" as const, transactionId: candidate.transactionId, businessId: candidate.businessId, reason: "REFUND_PAYMENT_NOT_FOUND" };
    const refund = await tx.refund.findFirst({
      where: { id: candidate.id, businessId: candidate.businessId, transactionId: candidate.transactionId, provider: params.provider },
    });
    if (!refund) return { matched: true as const, kind: "exception" as const, transactionId: transaction.id, businessId: transaction.businessId, reason: "REFUND_NOT_FOUND" };
    if (refund.status === "COMPLETED" || refund.status === "FAILED" || refund.status === "REJECTED") {
      // A timeout notice that arrives after the verdict changes nothing.
      return { matched: true as const, kind: "duplicate" as const, transactionId: transaction.id, businessId: transaction.businessId };
    }
    const note = "M-PESA reported that its queue timed out before processing this reversal. It may still complete, so the amount stays reserved and the reversal must not be sent again.";
    const backfill = correlatedByOriginal && providerReference && !refund.providerReference ? { providerReference } : {};
    await tx.refund.updateMany({
      where: { id: refund.id, businessId: transaction.businessId, transactionId: transaction.id, status: { in: [...RESERVED_REFUND_STATUSES] } },
      data: { status: "PENDING_PROVIDER", failureReason: `${REFUND_OUTCOME_UNKNOWN_MARKER}${note}`.slice(0, 300), ...backfill },
    });
    await logPaymentAudit({
      businessId: transaction.businessId,
      transactionId: transaction.id,
      actorKind: "JATA_SYSTEM",
      action: "REFUND_OUTCOME_UNKNOWN",
      summary: note,
      beforeState: { refundStatus: refund.status },
      afterState: { refundStatus: "PENDING_PROVIDER", outcome: "UNKNOWN", reservationReleased: false },
    }, tx);
    await recordReconciliationException({
      businessId: transaction.businessId,
      transactionId: transaction.id,
      provider: params.provider,
      providerReference: providerReference || refund.providerReference || null,
      result: "UNCONFIRMED",
      expectedAmountMinor: refund.amountMinor,
      receivedAmountMinor: null,
      notes: "Reversal outcome unknown after an M-PESA queue timeout. Check the M-PESA portal before refunding by any other means.",
    }, tx);
    return { matched: true as const, kind: "unknown" as const, transactionId: transaction.id, businessId: transaction.businessId };
  });
}

/**
 * Moves the refunded total forward; the original payment row keeps its own amount forever (§114).
 *
 * Also settles the goods side of a refunded POS sale, so money and stock move together. The
 * result carries how much came back to the shelf so the caller can put it in the audit trail
 * beside the money.
 */
export async function applyRefundedTotals(params: {
  businessId: string;
  transaction: any;
  amountMinor: number;
  client: PaymentClient;
}): Promise<{ status: PaymentStatus; restored: { returnedToStock: number; restoredLines: number } }> {
  const { businessId, transaction, amountMinor, client } = params;
  const paid = paidMinor(transaction);
  let restored = { returnedToStock: 0, restoredLines: 0 };
  // Callers have transitioned the reservation to COMPLETED in this same locked transaction, so
  // the ledger sum includes this refund. `amountRefundedMinor + amountMinor` preserves the normal
  // sequential path; max also repairs a stale aggregate without double-counting completed rows.
  const completedRowsMinor = await completedRefundMinor(client, businessId, transaction.id);
  const refunded = Math.min(
    paid,
    Math.max(Number(transaction.amountRefundedMinor ?? 0) + amountMinor, completedRowsMinor),
  );
  const nextStatus: PaymentStatus = refunded >= paid ? "FULLY_REFUNDED" : "PARTIALLY_REFUNDED";
  await client.paymentTransaction.updateMany({
    where: { id: transaction.id, businessId },
    data: { amountRefundedMinor: refunded, status: nextStatus },
  });

  if (transaction.posSaleId) {
    const sale = await client.posSale.findFirst({ where: { id: transaction.posSaleId, businessId } });
    if (sale) {
      const saleRefunded = Number(sale.refundedKES ?? 0) + minorToKes(amountMinor);
      const salePaid = Number(sale.paidKES ?? 0);
      const saleStatus = saleRefunded >= salePaid ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await client.posSale.updateMany({
        where: { id: sale.id, businessId },
        data: { refundedKES: saleRefunded, status: saleStatus },
      });
      await client.posPayment.create({
        data: {
          businessId,
          saleId: sale.id,
          customerId: sale.customerId ?? null,
          branchId: sale.branchId ?? null,
          direction: "OUT",
          purpose: "REFUND",
          method: transaction.method ?? "mpesa",
          amountKES: minorToKes(amountMinor),
          reference: transaction.providerTransactionId ?? transaction.providerReference ?? null,
          status: "SETTLED",
          notes: `Refund against ${transaction.jataPaymentId}`,
        },
      });
      // Stock comes back with the money, in this same locked transaction. Once the whole sale
      // has been refunded the customer no longer has the goods, so leaving them off the shelf
      // would quietly lose inventory. The claim inside is atomic, so a repeated provider
      // callback, a duplicate confirmation or a POS-side return cannot double-restore (§33, §54).
      // Deliberately not swallowed: if the goods cannot be accounted for, the whole refund
      // transaction rolls back rather than settling money and silently losing inventory.
      restored = await restoreRefundedSaleStock({
        businessId,
        saleId: sale.id,
        paidKES: salePaid,
        refundedKES: saleRefunded,
        note: `Refunded against ${transaction.jataPaymentId}`,
        client: client as any,
      });
    }
  }
  return { status: nextStatus, restored };
}

/** §47: what a refund screen shows before anyone commits to anything. */
export function refundSummary(transaction: any, refunds: any[] = []) {
  const payment = transaction ?? {};
  const paid = paidMinor(payment);
  const storedRefundedMinor = payment.amountRefundedMinor != null
    ? Number(payment.amountRefundedMinor)
    : payment.refundedKES != null
      ? minorFromKes(payment.refundedKES)
      : 0;
  const amountForRow = (refund: any) => refund?.amountMinor != null
    ? Number(refund.amountMinor)
    : minorFromKes(refund?.amountKES);
  const completedFromRows = (refunds ?? []).reduce((total, refund) => {
    if (String(refund?.status) !== "COMPLETED") return total;
    const amountMinor = amountForRow(refund);
    return total + (Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : 0);
  }, 0);
  const refunded = Math.max(
    Number.isSafeInteger(storedRefundedMinor) && storedRefundedMinor > 0 ? storedRefundedMinor : 0,
    completedFromRows,
  );
  const reserved = (refunds ?? []).reduce((total, refund) => {
    if (!RESERVED_REFUND_STATUSES.includes(String(refund?.status) as (typeof RESERVED_REFUND_STATUSES)[number])) return total;
    const amountMinor = amountForRow(refund);
    return total + (Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : 0);
  }, 0);
  const available = refundableMinor({ ...(transaction ?? {}), amountRefundedMinor: refunded }, reserved);
  const status = String(transaction?.status ?? "") as PaymentStatus;
  const unknownOutcomeRefunds = (refunds ?? []).filter((refund) => refundOutcomeState(refund) === "UNKNOWN").length;
  return {
    /** Refunds the provider may still complete; their amounts stay reserved. */
    unknownOutcomeRefunds,
    paidKES: minorToKes(paid),
    refundedKES: minorToKes(refunded),
    reservedKES: minorToKes(reserved),
    refundableKES: minorToKes(available),
    refundable: available > 0 && canBeRefunded(status),
    status,
  };
}
