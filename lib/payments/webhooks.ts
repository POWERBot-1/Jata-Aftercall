/**
 * The centralized provider event pipeline (§24, §34, §35, §98).
 *
 * These endpoints belong to JATA. A merchant never registers a callback, never pastes a secret and
 * never sees this path (§14, §54). The pipeline is the same for every provider:
 *
 *   AUTHENTICATE → VALIDATE → IDENTIFY PROVIDER → IDENTIFY DESTINATION/TENANT → IDENTIFY TRANSACTION
 *   → IDEMPOTENCY → ATOMIC UPDATE → PaymentConfirmed → notifications
 *
 * Nothing here trusts a payload because it resembles a payment: authentication happens first, the
 * idempotency key is claimed in the database before any financial change, and a confirmation is
 * matched, amount-verified and destination-verified before it can make anything PAID (§30, §35).
 */

import prisma from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { adapterContext, db, type PaymentClient } from "./context";
import { applyConfirmation, applyFailure, applyReversal } from "./engine";
import { deliverPendingPaymentNotifications } from "./notifications";
import { isOk } from "./result";
import { recordReconciliationException } from "./reconciliation";
import { publishPaymentEvent } from "./realtime";
import { getAdapter } from "./providers/registry";
import type { ProviderKey } from "./types";

export type WebhookInput = {
  provider: ProviderKey | string;
  rawBody: string;
  payload: Record<string, unknown>;
  headers: Headers;
  url: URL;
  client?: PaymentClient;
  now?: Date;
  fetchImpl?: typeof fetch;
};

export type WebhookResult = {
  /** Machine-readable outcome for the route (and for tests). */
  status:
    | "processed"
    | "already_processed"
    | "duplicate"
    | "rejected"
    | "ignored"
    | "unmatched"
    | "amount_mismatch"
    | "failed";
  httpStatus: number;
  body: Record<string, unknown>;
  transactionId?: string | null;
  businessId?: string | null;
};

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2002";
}

/**
 * Runs one provider event end to end. Returns what happened in terms the route can answer with —
 * and in terms the tests can assert on without inspecting the database.
 */
export async function applyProviderEvent(input: WebhookInput): Promise<WebhookResult> {
  const client = input.client ?? db();
  const provider = String(input.provider).toUpperCase();
  const adapter = getAdapter(provider);
  const now = input.now ?? new Date();
  const ctx = adapterContext(now, { fetchImpl: input.fetchImpl, verifyWithProvider: true });

  if (!adapter) {
    await logAudit({ action: "PAYMENT_WEBHOOK_PROVIDER_UNKNOWN", metadata: { provider } });
    return { status: "rejected", httpStatus: 404, body: { error: "Unknown provider." } };
  }

  // ── 1. Authenticate (§35) ────────────────────────────────────────────────
  // Unconditional: there is no flag, no internal caller and no replay path that may skip this.
  // Every stored event that reached the point of being applied was authenticated first, so an
  // event JATA refused at the door can never be re-run — not by an operator, not by a retry, and
  // not by anything that reuses this function (§35, §120).
  const verification = await adapter.verifyEvent(
    { rawBody: input.rawBody, headers: input.headers, payload: input.payload, url: input.url },
    ctx,
  );

  const eventIdFromPayload = () => {
    const id = input.payload?.id;
    if (typeof id === "string") return id.slice(0, 200);
    if (typeof id === "number" && Number.isSafeInteger(id)) return String(id);
    const body = input.payload?.Body as Record<string, unknown> | undefined;
    const callback = body?.stkCallback as Record<string, unknown> | undefined;
    if (callback) return `stk:${String(callback.CheckoutRequestID ?? "")}:${String(callback.ResultCode ?? "")}`.slice(0, 200);
    const transId = input.payload?.TransID;
    if (typeof transId === "string") return `c2b:${transId}`.slice(0, 200);
    return "";
  };
  const eventId = verification.ok ? verification.eventId || eventIdFromPayload() : verification.eventId ?? eventIdFromPayload();
  const eventType = verification.ok ? verification.eventType : verification.eventType ?? "UNKNOWN";

  if (!isOk(verification)) {
    await logAudit({ action: "PAYMENT_WEBHOOK_REJECTED", metadata: { provider, code: verification.code } });
    if (eventId) {
      await recordEvent(client, {
        provider,
        eventId,
        eventType: eventType || "UNKNOWN",
        signatureVerified: false,
        status: "REJECTED",
        payload: { type: eventType, refused: verification.code },
        errorCode: verification.code,
      });
    }
    return { status: "rejected", httpStatus: 401, body: { error: "Event refused." } };
  }

  if (!eventId) {
    await logAudit({ action: "PAYMENT_WEBHOOK_MALFORMED", metadata: { provider } });
    return { status: "rejected", httpStatus: 400, body: { error: "Event refused." } };
  }

  // ── 2. Idempotency (§33): claim the event before anything financial happens ──
  let eventRowId: string | null = null;
  try {
    const row = await client.paymentEvent.create({
      data: {
        provider,
        providerEventId: eventId,
        eventType: eventType || "UNKNOWN",
        signatureVerified: true,
        status: "RECEIVED",
        payload: { type: eventType || "UNKNOWN" },
      },
    });
    eventRowId = row?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The provider sent the same event twice (or retried after a timeout). One financial effect.
      await client.paymentEvent.updateMany({
        where: { provider, providerEventId: eventId },
        data: { status: "DUPLICATE", processedAt: new Date() },
      });
      return { status: "already_processed", httpStatus: 200, body: { status: "already_processed" } };
    }
    throw error;
  }

  // ── 3. Normalize (§24) ───────────────────────────────────────────────────
  let outcome;
  try {
    outcome = await adapter.parseEvent({ rawBody: input.rawBody, headers: input.headers, payload: input.payload, url: input.url }, ctx);
  } catch {
    await finishEvent(client, eventRowId, { status: "FAILED", errorCode: "PARSING_FAILED", processedAt: new Date() });
    return { status: "failed", httpStatus: 500, body: { error: "Could not process this event." } };
  }

  // ── 4. Apply ─────────────────────────────────────────────────────────────
  if (outcome.kind === "confirmation") {
    const result = await applyConfirmation({ provider: provider as ProviderKey, event: outcome, eventRowId, client: input.client });

    if (result.kind === "settled" || result.kind === "duplicate") {
      await finishEvent(client, eventRowId, {
        status: result.kind === "duplicate" ? "DUPLICATE" : "PROCESSED",
        processedAt: new Date(),
        ...(result.kind === "settled" ? { transactionId: result.transactionId, businessId: result.businessId } : { transactionId: result.transactionId }),
        providerReference: outcome.providerReference || null,
        payload: outcome.sanitized,
      });
    } else if (result.kind === "amount_mismatch" || result.kind === "exception") {
      await finishEvent(client, eventRowId, {
        status: "PROCESSED",
        processedAt: new Date(),
        transactionId: result.transactionId ?? null,
        errorCode: result.kind === "amount_mismatch" ? "AMOUNT_MISMATCH" : result.reason,
        payload: outcome.sanitized,
      });
    } else if (result.kind === "no_match") {
      await handleUnmatched(client, { provider, outcome, eventRowId, destinationIdentified: false });
    }

    if (input.client === undefined) {
      // Notifications are delivered outside the money path (§100). The business id is known for a
      // settled payment; an unmatched event is surfaced through reconciliation instead.
      const businessId = result.kind === "settled" ? result.businessId : null;
      if (businessId) {
        await deliverPendingPaymentNotifications({ businessId, client: prisma }).catch(() => undefined);
      }
    }

    const httpStatus = 200;
    return {
      status: result.kind === "settled" ? "processed" : result.kind === "no_match" ? "unmatched" : result.kind === "amount_mismatch" ? "amount_mismatch" : result.kind === "duplicate" ? "duplicate" : "processed",
      httpStatus,
      body: { status: result.kind === "settled" ? "processed" : result.kind },
      transactionId: "transactionId" in result ? result.transactionId : null,
      businessId: result.kind === "settled" ? result.businessId : null,
    };
  }

  if (outcome.kind === "reversal") {
    const result = await applyReversal({ provider: provider as ProviderKey, event: outcome, client: input.client });
    await finishEvent(client, eventRowId, {
      status: result.kind === "no_match" ? "RECEIVED" : "PROCESSED",
      processedAt: new Date(),
      transactionId: "transactionId" in result ? result.transactionId ?? null : null,
      providerReference: outcome.providerReference || null,
      payload: outcome.sanitized,
      errorCode: result.kind === "no_match" ? "NO_MATCHING_TRANSACTION" : null,
    });
    if (result.kind === "no_match") await handleUnmatched(client, { provider, outcome, eventRowId, destinationIdentified: false });
    return { status: "processed", httpStatus: 200, body: { status: "processed" } };
  }

  if (outcome.kind === "failure") {
    const result = await applyFailure({ provider: provider as ProviderKey, event: outcome, client: input.client });
    await finishEvent(client, eventRowId, {
      status: "PROCESSED",
      processedAt: new Date(),
      transactionId: "transactionId" in result ? result.transactionId ?? null : null,
      providerReference: outcome.providerReference ?? null,
      payload: outcome.sanitized,
      errorCode: outcome.code,
    });
    return { status: "processed", httpStatus: 200, body: { status: "processed" } };
  }

  // Provider chatter that is not a payment event (a validation probe, an unhandled event type).
  await finishEvent(client, eventRowId, { status: "PROCESSED", processedAt: new Date(), payload: outcome.sanitized, errorCode: outcome.reason });
  return { status: "ignored", httpStatus: 200, body: { status: "ignored", reason: outcome.reason } };
}

async function recordEvent(client: PaymentClient, data: Record<string, unknown>) {
  if (!client.paymentEvent?.create) return null;
  try {
    return await client.paymentEvent.create({ data });
  } catch {
    return null;
  }
}

async function finishEvent(client: PaymentClient, eventRowId: string | null, data: Record<string, unknown>) {
  if (!eventRowId || !client.paymentEvent?.updateMany) return;
  const patch: Record<string, unknown> = { ...data };
  delete patch.businessId;
  await client.paymentEvent.updateMany({ where: { id: eventRowId }, data: patch });
}

/**
 * A legitimate provider payment JATA cannot match to an order (§42, §44). It is never attached to
 * a random order: when the destination identifies a tenant, the anomaly is recorded against that
 * tenant so the merchant sees it; otherwise it stays in the provider event log for JATA operations.
 */
async function handleUnmatched(
  client: PaymentClient,
  params: { provider: string; outcome: any; eventRowId: string | null; destinationIdentified: boolean },
) {
  const { outcome, eventRowId } = params;
  const destinationHint = outcome.kind === "confirmation" ? outcome.destination : { providerDestinationId: null, providerAccountRef: null };
  let businessId: string | null = null;
  let destinationId: string | null = null;
  if (destinationHint?.providerDestinationId && client.paymentDestination?.findFirst) {
    const destination = await client.paymentDestination.findFirst({
      where: { provider: params.provider, providerDestinationId: String(destinationHint.providerDestinationId).replace(/[^0-9]/g, "") },
    });
    if (destination) {
      businessId = String(destination.businessId);
      destinationId = String(destination.id);
    }
  }
  const amountMinor = outcome.kind === "confirmation" || outcome.kind === "reversal" ? outcome.amountMinor : null;
  if (businessId) {
    await recordReconciliationException({
      businessId,
      transactionId: null,
      provider: params.provider,
      providerReference: outcome.providerReference ?? null,
      result: "UNKNOWN_PAYMENT",
      expectedAmountMinor: null,
      receivedAmountMinor: amountMinor,
      notes: `Payment received with no matching JATA order at ${destinationId ? "a configured destination" : "this business"}.`,
    }, client);
    publishPaymentEvent({ businessId, transactionId: `unmatched:${eventRowId ?? Date.now()}`, status: "UNMATCHED", at: new Date().toISOString() });
  }
  await finishEvent(client, eventRowId, { status: "RECEIVED", errorCode: "NO_MATCHING_TRANSACTION", payload: outcome.sanitized });
  return { businessId };
}
