/**
 * Refunds and reversals (§47, §48, §114).
 *
 * A refund is a request to the provider plus a new adjustment row — never an edit of the original
 * payment. The original amount, the original provider reference and the original receipt stay
 * exactly as they were; the refunded total moves forward, the status moves forward, and a person's
 * name and reason are attached.
 *
 * If JATA cannot complete a refund through the provider (the connector is not configured, or the
 * provider does not offer refunds for that method), it says so plainly and records the request —
 * it never marks the money returned when it has not been.
 */

import { canBeRefunded, isPaidStatus, type PaymentStatus } from "./states";
import { logPaymentAudit } from "./audit";
import { adapterContext, db, inTransaction, type PaymentClient } from "./context";
import { getAdapter } from "./providers/registry";
import { ensureNotificationsForConfirmation } from "./notifications";
import { recordReconciliationException } from "./reconciliation";
import { isOk } from "./result";
import { publishPaymentEvent } from "./realtime";
import { minorToKes } from "./money";
import type { TransactionRecord } from "./types";

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

/** The most a payment can still be refunded, in minor units (§47). */
export function refundableMinor(transaction: { amountPaidMinor?: unknown; amountRefundedMinor?: unknown; amountMinor?: unknown }): number {
  const paid = Number(transaction.amountPaidMinor ?? 0) || Number(transaction.amountMinor ?? 0);
  const refunded = Number(transaction.amountRefundedMinor ?? 0);
  return Math.max(0, paid - refunded);
}

export function refundValidation(params: { transaction: any; amountKES: number }): { ok: boolean; amountMinor: number; code?: string; message?: string } {
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
  const available = refundableMinor(transaction);
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
 * Requests a refund. The provider call happens first; only a provider-accepted refund is recorded
 * as completed, and a provider that refuses leaves the request recorded as FAILED with its reason.
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

  const transaction = await client.paymentTransaction.findFirst({ where: { id: params.transactionId, businessId: params.businessId } });
  if (!transaction) return { ok: false, code: "NOT_FOUND", message: "That payment was not found for this business." };

  const validation = refundValidation({ transaction, amountKES: params.amountKES });
  if (!validation.ok) return { ok: false, code: validation.code ?? "NOT_REFUNDABLE", message: validation.message ?? "This payment cannot be refunded." };

  const destination = transaction.destinationId
    ? await client.paymentDestination.findFirst({ where: { id: transaction.destinationId, businessId: params.businessId } })
    : null;
  const adapter = getAdapter(transaction.provider);
  if (!adapter) return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "This payment provider is not supported yet." };

  const ctx = adapterContext(params.now ?? new Date(), { fetchImpl: params.fetchImpl, verifyWithProvider: true });
  const result = await adapter.refund(
    {
      transaction: transaction as TransactionRecord,
      destination,
      amountMinor: validation.amountMinor,
      reason,
    },
    ctx,
  );

  const status = result.ok ? (transaction.provider === "MPESA" ? "PENDING_PROVIDER" : "COMPLETED") : "FAILED";
  const refundId = await inTransaction(params.client, async (tx: PaymentClient) => {
    const row = await tx.refund.create({
      data: {
        businessId: params.businessId,
        transactionId: transaction.id,
        provider: transaction.provider,
        amountMinor: validation.amountMinor,
        currency: transaction.currency,
        status,
        reason: reason.slice(0, 300),
        initiatedById: params.actor.actorId,
        initiatedByName: params.actor.actorName,
        providerReference: result.ok ? result.providerReference ?? null : null,
        failureReason: result.ok ? null : result.message.slice(0, 300),
        completedAt: result.ok && status === "COMPLETED" ? new Date() : null,
      },
    });

    if (result.ok && status === "COMPLETED") {
      await applyRefundedTotals({ businessId: params.businessId, transaction, amountMinor: validation.amountMinor, client: tx });
    }

    await logPaymentAudit({
      businessId: params.businessId,
      transactionId: transaction.id,
      actorKind: "MERCHANT_STAFF",
      actorId: params.actor.actorId,
      actorName: params.actor.actorName,
      action: result.ok ? "REFUND_REQUESTED" : "REFUND_FAILED",
      summary: result.ok ? `Refund requested: ${result.message}` : `Refund could not be completed: ${result.message}`,
      beforeState: { status: transaction.status, amountRefundedMinor: transaction.amountRefundedMinor },
      afterState: { refundMinor: validation.amountMinor, providerStatus: status },
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
        receivedAmountMinor: validation.amountMinor,
        notes: `Refund could not be completed through the provider: ${result.message}`,
      }, tx);
    }

    return row.id as string;
  });

  if (result.ok && status === "COMPLETED") {
    const refreshed = await client.paymentTransaction.findFirst({ where: { id: transaction.id, businessId: params.businessId } });
    await ensureNotificationsForConfirmation({
      businessId: params.businessId,
      transaction: { ...refreshed, status: "PARTIALLY_REFUNDED" },
      destinationId: transaction.destinationId ?? null,
      saleId: transaction.posSaleId ?? null,
      client,
      kind: "REVERSAL",
    }).catch(() => undefined);
    publishPaymentEvent({ businessId: params.businessId, transactionId: transaction.id, status: String(refreshed?.status ?? "PARTIALLY_REFUNDED"), at: new Date().toISOString() });
  }

  if (!isOk(result)) return { ok: false, code: result.code, message: result.message };

  const remaining = refundableMinor(transaction) - validation.amountMinor;
  return {
    ok: true,
    refundId,
    status,
    amountKES: minorToKes(validation.amountMinor),
    message: result.message,
    remainingKES: minorToKes(Math.max(0, remaining)),
  };
}

/** Moves the refunded total forward; the original payment row keeps its own amount forever (§114). */
export async function applyRefundedTotals(params: {
  businessId: string;
  transaction: any;
  amountMinor: number;
  client: PaymentClient;
}) {
  const { businessId, transaction, amountMinor, client } = params;
  const paid = Number(transaction.amountPaidMinor ?? 0) || Number(transaction.amountMinor ?? 0);
  const refunded = Math.min(paid, Number(transaction.amountRefundedMinor ?? 0) + amountMinor);
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
export function refundSummary(transaction: any) {
  const paidMinor = Number(transaction?.amountPaidMinor ?? 0) || Number(transaction?.amountMinor ?? 0);
  const refundedMinor = Number(transaction?.amountRefundedMinor ?? 0);
  const availableMinor = refundableMinor(transaction);
  return {
    paidKES: minorToKes(paidMinor),
    refundedKES: minorToKes(refundedMinor),
    refundableKES: minorToKes(availableMinor),
    refundable: availableMinor > 0 && canBeRefunded(String(transaction?.status ?? "") as PaymentStatus),
    status: String(transaction?.status ?? ""),
  };
}
