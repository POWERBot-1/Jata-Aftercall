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
import type { ProviderReversalResult } from "./providers/types";
import type { TransactionRecord } from "./types";

const RESERVED_REFUND_STATUSES = ["REQUESTED", "PENDING_PROVIDER"] as const;

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
  | { ok: false; code: string; message: string };

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
        failureReason: result.ok ? (providerOutcomeUnknown ? result.message.slice(0, 300) : null) : result.message.slice(0, 300),
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
    });
    if (updated.count !== 1) throw new Error("Refund reservation changed before finalization.");

    if (status === "COMPLETED") {
      await applyRefundedTotals({
        businessId: params.businessId,
        transaction: currentTransaction,
        amountMinor: reservation.amountMinor,
        client: tx,
      });
    }

    const action = status === "COMPLETED" ? "REFUND_COMPLETED" : status === "FAILED" ? "REFUND_FAILED" : "REFUND_REQUESTED";
    const summary = status === "COMPLETED"
      ? `Refund completed through the provider: ${result.message}`
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
      afterState: { refundMinor: reservation.amountMinor, refundStatus: status, providerReference: result.ok ? result.providerReference ?? null : null },
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

  if (result.ok === false) return { ok: false, code: result.code, message: result.message };

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
  client?: PaymentClient;
}): Promise<
  | { matched: false }
  | { matched: true; kind: "settled" | "failed" | "exception" | "duplicate"; transactionId?: string; businessId?: string; status?: PaymentStatus; reason?: string }
> {
  const client = params.client ?? db();
  const providerReference = String(params.providerReference ?? "").trim();
  if (!providerReference) return { matched: false };

  const candidates = await client.refund.findMany({
    where: { provider: params.provider, providerReference },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (!candidates?.length) return { matched: false };
  if (candidates.length !== 1) {
    return { matched: true, kind: "exception", reason: "AMBIGUOUS_PROVIDER_REFUND_REFERENCE" };
  }

  const candidate = candidates[0];
  const outcome = await refundTransaction(client, async (tx: PaymentClient) => {
    const transaction = await lockPaymentForRefund(tx, candidate.businessId, candidate.transactionId);
    if (!transaction) return { matched: true as const, kind: "exception" as const, transactionId: candidate.transactionId, businessId: candidate.businessId, reason: "REFUND_PAYMENT_NOT_FOUND" };
    const refund = await tx.refund.findFirst({
      where: {
        id: candidate.id,
        businessId: candidate.businessId,
        transactionId: candidate.transactionId,
        provider: params.provider,
        providerReference,
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
        data: { status: "FAILED", failureReason: message, completedAt: null },
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
      data: { status: "COMPLETED", failureReason: null, completedAt: new Date() },
    });
    if (changed.count !== 1) return { matched: true as const, kind: "duplicate" as const, transactionId: transaction.id, businessId: transaction.businessId };

    const completedRowsMinor = await completedRefundMinor(tx, transaction.businessId, transaction.id);
    const amountRefundedNext = Math.min(
      paidMinor(transaction),
      Math.max(Number(transaction.amountRefundedMinor ?? 0) + Number(refund.amountMinor), completedRowsMinor),
    );
    const nextStatus = await applyRefundedTotals({
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
      summary: "The provider confirmed the reserved refund.",
      beforeState: { refundStatus: refund.status, amountRefundedMinor: transaction.amountRefundedMinor ?? 0 },
      afterState: { refundStatus: "COMPLETED", amountRefundedMinor: amountRefundedNext },
      reason: refund.reason,
    }, tx);
    const refreshed = await tx.paymentTransaction.findFirst({ where: { id: transaction.id, businessId: transaction.businessId } });
    await ensureNotificationsForConfirmation({
      businessId: transaction.businessId,
      transaction: refreshed ?? { ...transaction, status: nextStatus },
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
      status: (refreshed?.status ?? nextStatus) as PaymentStatus,
    };
  });
  return outcome;
}

/** Moves the refunded total forward; the original payment row keeps its own amount forever (§114). */
export async function applyRefundedTotals(params: {
  businessId: string;
  transaction: any;
  amountMinor: number;
  client: PaymentClient;
}) {
  const { businessId, transaction, amountMinor, client } = params;
  const paid = paidMinor(transaction);
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
          direction: "OUT",
          purpose: "REFUND",
          method: transaction.method ?? "mpesa",
          amountKES: minorToKes(amountMinor),
          reference: transaction.providerTransactionId ?? transaction.providerReference ?? null,
          status: "SETTLED",
          notes: `Refund against ${transaction.jataPaymentId}`,
        },
      });
    }
  }
  return nextStatus;
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
  return {
    paidKES: minorToKes(paid),
    refundedKES: minorToKes(refunded),
    reservedKES: minorToKes(reserved),
    refundableKES: minorToKes(available),
    refundable: available > 0 && canBeRefunded(status),
    status,
  };
}
