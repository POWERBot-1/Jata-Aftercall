/**
 * The JATA Payment Orchestrator (§6, §19, §20, §21, §127).
 *
 * The POS asks for a payment and JATA decides how to accomplish it: which destination, which
 * provider, which capability, which method. The POS never chooses an API, never learns a payload
 * and never sees a credential (§1, §3, §6).
 *
 *   REQUEST PAYMENT → route to the primary destination → check the capability → ask the adapter →
 *   give the cashier something honest to show the customer → wait for the provider → confirm
 *
 * A payment request is idempotent (§33): the till sends a request key, and a double tap or a
 * retried request returns the payment that already exists rather than starting a second one.
 */

import prisma from "@/lib/db";
import { effectiveConfiguration, loadConfiguration } from "@/lib/pos/provisioning";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { isPricedSale, priceSaleRequest, type PosActor, type SaleRequest } from "@/lib/pos/sales";
import type { ReceiptBusiness } from "@/lib/pos/receipt";
import type { PosConfiguration } from "@/lib/pos/types";
import { logPaymentAudit } from "./audit";
import { adapterContext, db, findTransactionByIdempotencyKey, inTransaction, listDestinations, type PaymentClient } from "./context";
import { idempotencyKeyFor, jataPaymentId, providerReferenceFor } from "./ids";
import { kesToMinor, isValidCurrency, minorToKes, maskPhone } from "./money";
import { refreshStatus } from "./engine";
import { getAdapter, isProviderAvailable } from "./providers/registry";
import { isOk } from "./result";
import { routeDestination, effectiveCapabilities, destinationHeadline } from "./destinations";
import type { CustomerInstructions, DestinationRecord, ProviderCapability } from "./types";
import type { PaymentStatus } from "./states";

/** How long JATA keeps an open request before it stops waiting (§68). */
const EXPIRY_MINUTES: Record<string, number> = {
  MPESA_STK: 5,
  PAYSTACK_CHECKOUT: 60,
  MANUAL: 240,
};

export type OrchestratorActor = {
  actorId: string | null;
  actorName: string | null;
  roleKey: string;
  permissions: string[];
  staffId: string | null;
  branchId: string | null;
};

export type CreatePaymentRequestInput = {
  businessId: string;
  /** The till's own key for this checkout attempt — makes the request idempotent (§33). */
  requestKey: string;
  /** Which configured payment method the cashier chose ("mpesa", "card", …). */
  method: string;
  destinationId?: string | null;
  /** A cart to price server-side. When absent, `amountKES` is required. */
  sale?: {
    request: SaleRequest;
    business: ReceiptBusiness;
    configurationVersion: number;
    configurationFingerprint: string | null;
  } | null;
  amountKES?: number | null;
  currency?: string;
  customer?: { name?: string | null; phone?: string | null; email?: string | null; posCustomerId?: string | null };
  orderId?: string | null;
  actor: OrchestratorActor;
  now?: Date;
  fetchImpl?: typeof fetch;
  client?: PaymentClient;
  /** Tests assert the atomic part; production always fans out. */
  skipFanout?: boolean;
};

export type PaymentRequestOutcome =
  | {
      ok: true;
      transactionId: string;
      jataPaymentId: string;
      status: PaymentStatus;
      amountKES: number;
      currency: string;
      destinationLabel: string;
      provider: string;
      method: string;
      automaticConfirmation: boolean;
      instructions: CustomerInstructions;
      duplicate: boolean;
      expiresAt: string | null;
    }
  | { ok: false; code: string; message: string; instructions?: CustomerInstructions };

function failure(code: string, message: string, instructions?: CustomerInstructions): PaymentRequestOutcome {
  return instructions ? { ok: false, code, message, instructions } : { ok: false, code, message };
}

/**
 * Creates (or returns) the payment request for a counter sale. The amount that goes to the
 * provider is priced by the same engine that will record the sale, from JATA's own product and
 * configuration records — never from the browser (§20, §56).
 */
export async function createPaymentRequest(input: CreatePaymentRequestInput): Promise<PaymentRequestOutcome> {
  const client = input.client ?? db();
  const now = input.now ?? new Date();
  const currency = isValidCurrency(input.currency) ? input.currency : "KES";
  const requestKey = String(input.requestKey ?? "").trim().slice(0, 80);
  if (!requestKey) return failure("REQUEST_KEY_REQUIRED", "Something went wrong starting this payment. Try again.");

  const idempotencyKey = idempotencyKeyFor({ businessId: input.businessId, scope: `pos:${input.sale ? "sale" : input.orderId ?? "direct"}`, requestKey });

  // ── Idempotency first (§33): a double tap must not start a second payment ──
  const existing = await findTransactionByIdempotencyKey(idempotencyKey, client);
  if (existing) {
    return {
      ok: true,
      transactionId: existing.id,
      jataPaymentId: existing.jataPaymentId,
      status: existing.status as PaymentStatus,
      amountKES: minorToKes(existing.amountMinor),
      currency: existing.currency,
      destinationLabel: existing.providerTransactionId ? "Existing request" : "Existing request",
      provider: existing.provider,
      method: existing.method ?? "mpesa",
      automaticConfirmation: Boolean(existing.providerTransactionId),
      instructions: pendingInstructions(existing.status as PaymentStatus),
      duplicate: true,
      expiresAt: existing.expiresAt ? new Date(existing.expiresAt).toISOString() : null,
    };
  }

  // ── Where does this business get paid? (§9, §21) ─────────────────────────
  const destinations = (await listDestinations(input.businessId, client)) as unknown as DestinationRecord[];
  const routed = routeDestination(destinations, input.destinationId ?? null);
  if (!isOk(routed)) return failure(routed.code, routed.message);
  const destination = routed.destination;

  if (!isProviderAvailable(destination.provider)) {
    return failure("PROVIDER_UNAVAILABLE", `${destination.provider} payments are not available for this destination yet.`);
  }
  const adapter = getAdapter(destination.provider);
  if (!adapter) return failure("PROVIDER_UNAVAILABLE", "This payment provider is not supported yet.");

  // ── The amount: the server's price, not the till's arithmetic (§20, §56) ──
  let amountKES = 0;
  let configuration: PosConfiguration | null = null;
  let saleContext: { request: SaleRequest; configurationVersion: number; configurationFingerprint: string | null } | null = null;

  if (input.sale) {
    const record = await loadConfiguration(input.businessId).catch(() => null);
    configuration = effectiveConfiguration(record, "LIVE") ?? baselineConfiguration();
    const priced = await priceSaleRequest({
      businessId: input.businessId,
      configuration,
      actor: { ...input.actor, permissions: input.actor.permissions as PosActor["permissions"] },
      request: { ...input.sale.request, payments: [{ method: input.method, amountKES: 0 }] },
      client,
      options: { unpaid: true },
    });
    if (!isPricedSale(priced)) return failure(priced.code ?? "SALE_NOT_PRICED", priced.message ?? "We couldn't price that sale.");
    amountKES = Number(priced.calculation.totals.totalKES);
    saleContext = {
      request: { ...input.sale.request, payments: [] },
      configurationVersion: input.sale.configurationVersion,
      configurationFingerprint: input.sale.configurationFingerprint,
    };
  } else {
    amountKES = Math.max(0, Math.round(Number(input.amountKES ?? 0)));
  }

  if (amountKES <= 0) return failure("AMOUNT_REQUIRED", "There is nothing to pay for this sale.");
  const amountMinor = kesToMinor(amountKES);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return failure("AMOUNT_INVALID", "That amount cannot be charged.");

  // ── Which capabilities does this destination really have? (§8, §88) ──────
  const connectorReadyForProvider = adapter.connectorReady();
  const verificationLevel = (destination.verificationSource === "LIVE" ? "LIVE" : destination.verificationSource === "PROVIDER" ? "PROVIDER" : "FORMAT") as
    | "NONE" | "FORMAT" | "PROVIDER" | "LIVE";
  const capabilities = effectiveCapabilities({
    providerCapabilities: Array.isArray(destination.capabilities) && destination.capabilities.length ? destination.capabilities : adapter.declaredCapabilities(),
    connectorReady: connectorReadyForProvider,
    verificationLevel,
  }) as ProviderCapability[];

  const jataId = jataPaymentId(saleContext ? (input.sale?.configurationVersion ?? 1) : requestKey, now);
  const providerReference = providerReferenceFor(jataId, destination.provider);
  const method = input.method || (destination.provider === "PAYSTACK" ? "card" : "mpesa");

  const created = await inTransaction(input.client, async (tx: PaymentClient) => {
    const row = await tx.paymentTransaction.create({
      data: {
        jataPaymentId: jataId,
        businessId: input.businessId,
        destinationId: destination.id,
        provider: destination.provider,
        status: "CREATED",
        idempotencyKey,
        method,
        amountMinor,
        currency,
        customerName: input.customer?.name ? String(input.customer.name).slice(0, 120) : null,
        customerPhoneMasked: maskPhone(input.customer?.phone),
        posCustomerId: input.customer?.posCustomerId ? String(input.customer.posCustomerId).slice(0, 64) : null,
        orderId: input.orderId ? String(input.orderId).slice(0, 64) : null,
        paymentContext: saleContext
          ? {
              version: 1,
              requestKey,
              pos: {
                request: saleContext.request,
                method,
                actor: { ...input.actor },
                business: input.sale?.business ?? { name: "", phone: null, whatsapp: null, location: null, logoUrl: null },
                configurationVersion: saleContext.configurationVersion,
                configurationFingerprint: saleContext.configurationFingerprint,
                expectedTotalKES: amountKES,
              },
            }
          : { version: 1, requestKey },
      },
    });
    await logPaymentAudit({
      businessId: input.businessId,
      transactionId: row.id,
      destinationId: destination.id,
      actorKind: "MERCHANT_STAFF",
      actorId: input.actor.actorId,
      actorName: input.actor.actorName,
      action: "PAYMENT_REQUESTED",
      summary: `Payment requested for ${destinationHeadline(destination)}.`,
      afterState: { status: "CREATED", amountMinor, provider: destination.provider, method },
    }, tx);
    return row;
  });

  // ── Ask the provider (or explain how the customer pays) ──────────────────
  const ctx = adapterContext(now, { fetchImpl: input.fetchImpl, verifyWithProvider: false });
  const canInitiate = capabilities.includes("PAYMENT_INITIATION");

  let initiation;
  if (canInitiate) {
    initiation = await adapter.createPaymentRequest(
      {
        jataPaymentId: jataId,
        providerReference,
        amountMinor,
        currency,
        destination,
        customer: {
          name: input.customer?.name ?? null,
          phone: input.customer?.phone ?? null,
          emailHint: input.customer?.email ?? input.sale?.business?.email ?? null,
        },
        description: input.orderId ? `Order ${input.orderId}` : `Sale of ${amountKES}`,
        connection: (await client.paymentProviderConnection?.findFirst?.({ where: { businessId: input.businessId, provider: destination.provider } }).catch(() => null)) ?? null,
      },
      ctx,
    );
  } else {
    initiation = {
      kind: "manual" as const,
      method: `${destination.kind}_MANUAL`,
      instructions: adapter.getDisplayInstructions({ destination, amountMinor, currency, providerReference }),
    };
  }

  const attemptStatus = initiation.kind === "initiated" ? "ACCEPTED" : initiation.kind === "manual" ? "ACCEPTED" : initiation.kind === "failed" ? "FAILED" : "REJECTED";
  await inTransaction(input.client, async (tx: PaymentClient) => {
    await tx.paymentAttempt.create({
      data: {
        businessId: input.businessId,
        transactionId: created.id,
        provider: destination.provider,
        attemptNumber: 1,
        status: attemptStatus,
        requestReference: providerReference,
        providerReference: initiation.kind === "initiated" ? initiation.providerReference : null,
        errorCode: initiation.kind === "failed" || initiation.kind === "unsupported" ? initiation.code : null,
        errorMessage: initiation.kind === "failed" || initiation.kind === "unsupported" ? initiation.message : null,
      },
    });
  });

  if (initiation.kind === "failed" || initiation.kind === "unsupported") {
    await inTransaction(input.client, async (tx: PaymentClient) => {
      await tx.paymentTransaction.updateMany({
        where: { id: created.id, businessId: input.businessId, status: "CREATED" },
        data: {
          status: initiation.kind === "failed" ? "FAILED" : "CANCELLED",
          failureCode: initiation.code,
          failureReason: initiation.message,
        },
      });
      await logPaymentAudit({
        businessId: input.businessId,
        transactionId: created.id,
        actorKind: "JATA_SYSTEM",
        action: initiation.kind === "failed" ? "PAYMENT_FAILED" : "PAYMENT_CANCELLED",
        summary: initiation.message,
        beforeState: { status: "CREATED" },
        afterState: { status: initiation.kind === "failed" ? "FAILED" : "CANCELLED", code: initiation.code },
      }, tx);
    });
    return failure(initiation.code, initiation.message, initiation.kind === "unsupported" ? adapter.getDisplayInstructions({ destination, amountMinor, currency, providerReference }) : undefined);
  }

  const automaticConfirmation = initiation.kind === "initiated" && capabilities.includes("REAL_TIME_CONFIRMATION") && capabilities.includes("WEBHOOKS");
  const expiresMinutes = EXPIRY_MINUTES[initiation.kind === "initiated" ? initiation.method : "MANUAL"] ?? (automaticConfirmation ? 10 : 240);
  const expiresAt = new Date(now.getTime() + expiresMinutes * 60_000);

  const finalStatus: PaymentStatus = initiation.kind === "initiated" ? "PENDING" : "PAYMENT_REQUESTED";
  await inTransaction(input.client, async (tx: PaymentClient) => {
    await tx.paymentTransaction.updateMany({
      where: { id: created.id, businessId: input.businessId, status: "CREATED" },
      data: {
        status: finalStatus,
        method: initiation.method,
        providerReference: initiation.kind === "initiated" ? initiation.providerReference : providerReference,
        providerTransactionId: initiation.kind === "initiated" ? initiation.providerTransactionId : null,
        requestedAt: now,
        providerAcceptedAt: initiation.kind === "initiated" ? now : null,
        expiresAt,
      },
    });
    await logPaymentAudit({
      businessId: input.businessId,
      transactionId: created.id,
      actorKind: "JATA_SYSTEM",
      action: "PAYMENT_REQUESTED",
      summary:
        initiation.kind === "initiated"
          ? `Payment request accepted by ${destination.provider}; waiting for the customer.`
          : "Payment instructions given to the customer; automatic confirmation is not available for this destination.",
      beforeState: { status: "CREATED" },
      afterState: { status: finalStatus, method: initiation.method, automaticConfirmation },
    }, tx);
  });

  return {
    ok: true,
    transactionId: created.id,
    jataPaymentId: jataId,
    status: finalStatus,
    amountKES,
    currency,
    destinationLabel: destinationHeadline(destination),
    provider: destination.provider,
    method: initiation.method,
    automaticConfirmation,
    instructions: initiation.instructions,
    duplicate: false,
    expiresAt: expiresAt.toISOString(),
  };
}

function pendingInstructions(status: PaymentStatus): CustomerInstructions {
  if (status === "PAID" || status === "CONFIRMED") {
    return { mode: "PROMPT_ON_PHONE", headline: "PAYMENT RECEIVED", body: "This payment is already confirmed.", steps: [], automaticConfirmation: true };
  }
  return {
    mode: "PROMPT_ON_PHONE",
    headline: "PAYMENT PENDING",
    body: "We're waiting for provider confirmation.",
    steps: ["This payment request already exists."],
    automaticConfirmation: true,
  };
}

/**
 * §67, §68: ask the provider what happened, then apply it. Used by the "Check status" button and
 * by the reconciliation job — never by assuming a timeout means failure.
 */
export async function checkPaymentStatus(params: {
  businessId: string;
  transactionId: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  const transaction = await client.paymentTransaction.findFirst({ where: { id: params.transactionId, businessId: params.businessId } });
  if (!transaction) return { ok: false as const, code: "NOT_FOUND", message: "That payment was not found for this business." };
  const destination = transaction.destinationId
    ? await client.paymentDestination.findFirst({ where: { id: transaction.destinationId, businessId: params.businessId } })
    : null;
  const result = await refreshStatus({
    businessId: params.businessId,
    transaction,
    destination,
    now: params.now,
    fetchImpl: params.fetchImpl,
    client: params.client,
  });
  const updated = await client.paymentTransaction.findFirst({ where: { id: transaction.id, businessId: params.businessId } });
  return { ok: true as const, checked: result.checked, status: String(updated?.status ?? result.status), message: result.message };
}

/** A cashier may cancel a request that has not been paid. Money that already arrived is never hidden. */
export async function cancelPaymentRequest(params: {
  businessId: string;
  transactionId: string;
  actorId: string | null;
  actorName: string | null;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  return inTransaction(params.client, async (tx: PaymentClient) => {
    const transaction = await tx.paymentTransaction.findFirst({ where: { id: params.transactionId, businessId: params.businessId } });
    if (!transaction) return { ok: false as const, code: "NOT_FOUND", message: "That payment was not found for this business." };
    const status = String(transaction.status) as PaymentStatus;
    if (!["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING"].includes(status)) {
      return { ok: false as const, code: "NOT_CANCELLABLE", message: "That payment is already settled and cannot be cancelled." };
    }
    const claimed = await tx.paymentTransaction.updateMany({
      where: { id: transaction.id, businessId: params.businessId, status: { in: ["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING"] } },
      data: { status: "CANCELLED" },
    });
    if (!claimed?.count) return { ok: false as const, code: "NOT_CANCELLABLE", message: "That payment had already moved on." };
    await logPaymentAudit({
      businessId: params.businessId,
      transactionId: transaction.id,
      actorKind: "MERCHANT_STAFF",
      actorId: params.actorId,
      actorName: params.actorName,
      action: "PAYMENT_CANCELLED",
      summary: "Payment request cancelled at the till.",
      beforeState: { status },
      afterState: { status: "CANCELLED" },
    }, tx);
    return { ok: true as const, status: "CANCELLED" as PaymentStatus };
  });
}

/**
 * §102: JATA operations may ask the provider what the truth is now for a payment the event log did
 * not settle by itself — a request that is stuck, or one whose event JATA could not apply.
 *
 * This is deliberately *not* a "replay" of a stored payload. Re-running stored provider data would
 * mean re-running something the provider's own delivery did not vouch for at this moment, and the
 * event log keeps sanitized payloads precisely so that full customer data is not retained (§116).
 * Instead the adapter asks the provider directly, and only the provider's own answer can move the
 * payment (§41, §120). An operator can therefore create an effect only where the provider confirms
 * one — the same rule that applies at the till.
 */
export async function recheckPaymentForOperator(params: {
  transactionId: string;
  businessId?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  client?: PaymentClient;
}) {
  const client = params.client ?? db();
  const transaction = await client.paymentTransaction.findFirst({
    where: { id: params.transactionId, ...(params.businessId ? { businessId: params.businessId } : {}) },
  });
  if (!transaction) return { ok: false as const, code: "NOT_FOUND", message: "That payment was not found." };

  const businessId = String(transaction.businessId);
  const before = String(transaction.status);
  const destination = transaction.destinationId
    ? await client.paymentDestination.findFirst({ where: { id: transaction.destinationId, businessId } })
    : null;

  const result = await refreshStatus({
    businessId,
    transaction,
    destination,
    now: params.now,
    fetchImpl: params.fetchImpl,
    client,
  });

  const updated = await client.paymentTransaction.findFirst({ where: { id: transaction.id, businessId } });
  const status = String(updated?.status ?? result.status);
  await logPaymentAudit({
    businessId,
    transactionId: transaction.id,
    actorKind: "JATA_OPERATOR",
    action: "PAYMENT_RECHECKED_BY_OPERATOR",
    summary: `Operator asked ${String(transaction.provider)} for the current status of this payment.`,
    beforeState: { status: before },
    afterState: { status, checked: result.checked },
    reason: result.message ?? null,
  }, client);

  return { ok: true as const, checked: result.checked, status, before, message: result.message, businessId };
}

export { destinationHeadline, minorToKes };
