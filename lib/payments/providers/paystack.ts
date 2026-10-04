/**
 * Paystack adapter (§18, §90) — connected centrally through JATA.
 *
 * The merchant never sees a webhook URL, a callback URL, a secret key or an API endpoint (§18,
 * §54). JATA holds the connection, receives the events on its own centralized endpoint, verifies
 * the payment server-side and only then tells the POS that money arrived.
 *
 * Two things this adapter is strict about:
 *   • a redirect back to the browser is never proof of payment — the authoritative answer comes
 *     from `verify` on the server plus the signed `charge.success` event (§30, §67);
 *   • a Paystack destination is only CONNECTED once the business has completed its authorization
 *     step. Until then it is ACTION_REQUIRED, and JATA says so (§18, §53).
 */

import crypto from "crypto";
import { readPaystackConfig, publicBaseUrl, type PaystackConnectorConfig } from "../config";
import { formatMinor } from "../money";
import { identifyDestination, type DestinationDraft, type DestinationInput, type IdentificationResult } from "../destinations";
import type {
  CustomerInstructions,
  DestinationHint,
  ProviderCapability,
  ProviderEventOutcome,
  ProviderStatusReport,
} from "../types";
import type {
  AdapterContext,
  DestinationVerification,
  EventVerification,
  InitiationInput,
  PaymentProviderAdapter,
  ProviderEventRequest,
  ProviderReversalResult,
  ReversalInput,
} from "./types";

const DECLARED_CAPABILITIES: ProviderCapability[] = [
  "PAYMENT_INITIATION",
  "REAL_TIME_CONFIRMATION",
  "WEBHOOKS",
  "STATUS_QUERY",
  "REFUNDS",
  "MOBILE_MONEY",
  "BANK_TRANSFER",
  "PAYMENT_INSTRUCTIONS",
];

const PAYSTACK_BASE = "https://api.paystack.co";

function secret(config: PaystackConnectorConfig): string {
  if (!config.secretKey) throw new Error("PAYSTACK_NOT_CONFIGURED");
  return config.secretKey;
}

export function paystackSignature(rawBody: string, secretKey: string): string {
  return crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
}

/** Timing-safe comparison of the `x-paystack-signature` header (§35). */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !secretKey) return false;
  const expected = Buffer.from(paystackSignature(rawBody, secretKey), "utf8");
  const presented = Buffer.from(signature.trim(), "utf8");
  if (expected.length !== presented.length) return false;
  return crypto.timingSafeEqual(expected, presented);
}

/** Paystack's own reference for a JATA payment, derived from the JATA payment id (§64). */
export function paystackReference(providerReference: string): string {
  return providerReference.replace(/[^A-Za-z0-9.=-]/g, "-").slice(0, 100);
}

function checkoutInstructions(amountMinor: number, currency: string, url: string): CustomerInstructions {
  return {
    mode: "CHECKOUT_LINK",
    headline: `PAY ${formatMinor(amountMinor, currency)}`,
    body: "Open the secure payment page to complete this payment.",
    steps: ["Tap Pay now.", "Choose M-PESA or card.", "Approve on your phone."],
    automaticConfirmation: true,
    redirectUrl: url,
  };
}

/**
 * Asks Paystack for the authoritative status of a reference. Nothing in JATA treats a payment as
 * paid on the strength of a redirect, a browser message or an unsigned event (§30, §67).
 */
export async function verifyPaystackReference(reference: string, ctx: AdapterContext): Promise<ProviderStatusReport> {
  const config = readPaystackConfig();
  if (!config.ready) {
    return {
      status: "UNKNOWN",
      amountMinor: null,
      currency: null,
      providerTransactionId: null,
      message: "JATA's Paystack connection is not configured in this deployment, so this payment cannot be confirmed with Paystack.",
    };
  }
  if (!reference) {
    return { status: "UNKNOWN", amountMinor: null, currency: null, providerTransactionId: null, message: "JATA has no Paystack reference to check for this payment." };
  }
  try {
    const response = await ctx.fetchImpl(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret(config)}` },
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json().catch(() => null)) as { status?: unknown; data?: Record<string, unknown> } | null;
    const data = result?.data;
    if (!response.ok || !result?.status || !data) {
      return { status: "UNKNOWN", amountMinor: null, currency: null, providerTransactionId: null, message: null };
    }
    const status = typeof data.status === "string" ? data.status : "";
    const amountMinor = typeof data.amount === "number" && Number.isSafeInteger(data.amount) ? data.amount : null;
    const currency = typeof data.currency === "string" ? data.currency : null;
    const providerTransactionId = data.id == null ? null : String(data.id);
    if (status === "success") return { status: "CONFIRMED", amountMinor, currency, providerTransactionId, message: null };
    if (["failed", "abandoned", "reversed"].includes(status)) {
      return { status: "FAILED", amountMinor, currency, providerTransactionId, message: typeof data.gateway_response === "string" ? data.gateway_response : null };
    }
    return { status: "PENDING", amountMinor, currency, providerTransactionId, message: null };
  } catch {
    return { status: "UNKNOWN", amountMinor: null, currency: null, providerTransactionId: null, message: null };
  }
}

export function createPaystackAdapter(): PaymentProviderAdapter {
  return {
    key: "PAYSTACK",
    displayName: "Paystack",
    supportedKinds: ["PAYSTACK"],

    declaredCapabilities: () => [...DECLARED_CAPABILITIES],

    connectorReady: () => readPaystackConfig().ready,

    connectorNote: () => {
      const config = readPaystackConfig();
      return config.ready
        ? `Paystack ${config.mode.toLowerCase()} connector configured with JATA's central webhook.`
        : "Paystack connector key is not configured in this deployment.";
    },

    identifyDestination: (input: DestinationInput): IdentificationResult => identifyDestination(input),
    validateDestination: (input: DestinationInput): IdentificationResult => identifyDestination(input),

    verifyDestination: async (draft: DestinationDraft, _ctx: AdapterContext): Promise<DestinationVerification> => {
      const config = readPaystackConfig();
      if (!config.ready) {
        return {
          level: "FORMAT",
          status: "ACTION_REQUIRED",
          capabilities: ["PAYMENT_INSTRUCTIONS"],
          detail: "JATA is completing the Paystack connection for this deployment. Online payments cannot be confirmed automatically yet.",
          actionRequired: { label: "JATA is finishing this connection", kind: "SUPPORT" },
        };
      }
      // The business must authorize JATA to collect on its behalf before money can move (§18).
      return {
        level: "FORMAT",
        status: "ACTION_REQUIRED",
        capabilities: ["PAYMENT_INSTRUCTIONS"],
        detail: "Connected through JATA. Authorize this business to receive online payments and real-time confirmation switches on.",
        actionRequired: { label: "Authorize", kind: "AUTHORIZE" },
      };
    },

    getCapabilities: (destination) => {
      if (!readPaystackConfig().ready) return ["PAYMENT_INSTRUCTIONS"];
      return destination ? [...DECLARED_CAPABILITIES] : [...DECLARED_CAPABILITIES];
    },

    getDisplayInstructions: ({ amountMinor, currency, providerReference }): CustomerInstructions => ({
      mode: "CHECKOUT_LINK",
      headline: `PAY ${formatMinor(amountMinor, currency)}`,
      body: "JATA will give the customer a secure Paystack payment page.",
      steps: providerReference ? [`Reference ${providerReference}`] : [],
      automaticConfirmation: false,
    }),

    createPaymentRequest: async (input: InitiationInput, ctx: AdapterContext) => {
      const config = readPaystackConfig();
      if (!config.ready) {
        return { kind: "unsupported" as const, code: "PAYSTACK_NOT_CONNECTED", message: "Online payments are not connected yet. Add an M-PESA destination or try again later." };
      }
      if (!input.connection?.providerConnectionId) {
        return {
          kind: "unsupported" as const,
          code: "AUTHORIZATION_REQUIRED",
          message: "This business still needs to authorize online payments before JATA can request one.",
        };
      }
      const email = input.customer.emailHint;
      if (!email) {
        return {
          kind: "unsupported" as const,
          code: "CUSTOMER_EMAIL_REQUIRED",
          message: "Online payments need an email address for the receipt. Add the customer's email, or take the payment on M-PESA.",
        };
      }

      const reference = paystackReference(input.providerReference);
      try {
        const response = await ctx.fetchImpl(`${PAYSTACK_BASE}/transaction/initialize`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret(config)}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            // Paystack uses the currency's minor unit: the same integer JATA stores (§77).
            amount: String(input.amountMinor),
            currency: input.currency,
            reference,
            callback_url: `${ctx.baseUrl}/payments/return?reference=${encodeURIComponent(reference)}`,
            metadata: {
              jata_payment_id: input.jataPaymentId,
              business_id: input.destination.businessId,
              destination_id: input.destination.id,
              provider_reference: reference,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const result = (await response.json().catch(() => null)) as { status?: unknown; data?: Record<string, unknown> } | null;
        const authorizationUrl = typeof result?.data?.authorization_url === "string" ? result.data.authorization_url : "";
        const returnedReference = typeof result?.data?.reference === "string" ? result.data.reference : "";
        if (!response.ok || !result?.status || !authorizationUrl || returnedReference !== reference) {
          return { kind: "failed" as const, code: "PAYSTACK_INITIALIZATION_FAILED", message: "Paystack could not start this payment. Try again.", retryable: true };
        }
        let safe = false;
        try {
          const parsed = new URL(authorizationUrl);
          safe = parsed.protocol === "https:" && parsed.hostname === "checkout.paystack.com";
        } catch {
          safe = false;
        }
        if (!safe) {
          return { kind: "failed" as const, code: "PAYSTACK_URL_REJECTED", message: "Paystack returned an unexpected payment page, so JATA refused it.", retryable: false };
        }
        return {
          kind: "initiated" as const,
          method: "PAYSTACK_CHECKOUT",
          providerReference: reference,
          providerTransactionId: typeof result?.data?.access_code === "string" ? result.data.access_code : null,
          instructions: checkoutInstructions(input.amountMinor, input.currency, authorizationUrl),
        };
      } catch {
        return { kind: "failed" as const, code: "PAYSTACK_UNREACHABLE", message: "Paystack could not be reached. Check the connection and try again.", retryable: true };
      }
    },

    /** §30, §90: the server asks Paystack, rather than trusting the browser's return URL. */
    getPaymentStatus: async (transaction, _destination, ctx): Promise<ProviderStatusReport> => {
      if (!transaction.providerReference) {
        return { status: "UNKNOWN", amountMinor: null, currency: null, providerTransactionId: null, message: null };
      }
      return verifyPaystackReference(transaction.providerReference, ctx);
    },

    verifyEvent: async (request: ProviderEventRequest, _ctx: AdapterContext): Promise<EventVerification> => {
      const config = readPaystackConfig();
      const signature = request.headers.get("x-paystack-signature");
      const eventIdRaw = request.payload.id;
      const eventId = typeof eventIdRaw === "string" ? eventIdRaw.trim() : typeof eventIdRaw === "number" && Number.isSafeInteger(eventIdRaw) ? String(eventIdRaw) : "";
      const eventType = typeof request.payload.event === "string" ? request.payload.event : "";
      if (!eventId || eventId.length > 200 || !eventType || eventType.length > 100) {
        return { ok: false, code: "INVALID_EVENT", message: "Unrecognised Paystack payload.", eventId: eventId || null, eventType: eventType || null };
      }
      if (!config.ready) {
        return { ok: false, code: "PAYSTACK_NOT_CONFIGURED", message: "Paystack is not configured in this deployment.", eventId, eventType };
      }
      if (!verifyPaystackSignature(request.rawBody, signature, config.secretKey)) {
        return { ok: false, code: "SIGNATURE_INVALID", message: "Paystack signature did not match.", eventId, eventType };
      }
      return { ok: true, eventId, eventType };
    },

    parseEvent: async (request: ProviderEventRequest, ctx: AdapterContext): Promise<ProviderEventOutcome> => {
      const payload = request.payload;
      const eventType = typeof payload.event === "string" ? payload.event : "";
      const data = (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : {}) as Record<string, unknown>;
      const reference = typeof data.reference === "string" ? data.reference : "";
      const providerTransactionId = data.id == null ? null : String(data.id);
      const amountMinor = typeof data.amount === "number" && Number.isSafeInteger(data.amount) ? data.amount : null;
      const currency = typeof data.currency === "string" ? data.currency : "KES";
      const sanitized: Record<string, unknown> = {
        type: eventType,
        reference: reference || null,
        providerTransactionId,
        amountMinor,
        currency,
        status: typeof data.status === "string" ? data.status : null,
        channel: typeof data.channel === "string" ? data.channel : null,
      };

      if (eventType === "charge.success") {
        if (!reference || amountMinor === null || amountMinor <= 0) {
          return {
            kind: "failure",
            providerReference: reference || null,
            providerTransactionId,
            code: "PAYSTACK_CONFIRMATION_INCOMPLETE",
            message: "The Paystack event did not include a verifiable amount.",
            sanitized,
          };
        }
        // §30, §90: verify server-side before anything is treated as paid.
        if (ctx.verifyWithProvider) {
          const verified = await verifyPaystackReference(reference, ctx);
          if (verified.status !== "CONFIRMED") {
            return { kind: "ignored", reason: "PROVIDER_VERIFICATION_PENDING", sanitized: { ...sanitized, verified: verified.status } };
          }
          if (verified.amountMinor !== null && verified.amountMinor !== amountMinor) {
            return {
              kind: "failure",
              providerReference: reference,
              providerTransactionId: verified.providerTransactionId ?? providerTransactionId,
              code: "PAYSTACK_AMOUNT_MISMATCH",
              message: "Paystack reported a different amount on verification.",
              sanitized,
            };
          }
          return {
            kind: "confirmation",
            providerReference: reference,
            providerTransactionId: verified.providerTransactionId ?? providerTransactionId,
            amountMinor: verified.amountMinor ?? amountMinor,
            currency: verified.currency ?? currency,
            destination: { kind: "PAYSTACK", providerDestinationId: null, providerAccountRef: null },
            method: "PAYSTACK_CHECKOUT",
            customerName: null,
            customerPhoneMasked: null,
            occurredAt: typeof data.paid_at === "string" ? new Date(data.paid_at) : ctx.now,
            sanitized,
          };
        }
        return {
          kind: "confirmation",
          providerReference: reference,
          providerTransactionId,
          amountMinor,
          currency,
          destination: { kind: "PAYSTACK", providerDestinationId: null, providerAccountRef: null },
          method: "PAYSTACK_CHECKOUT",
          customerName: null,
          customerPhoneMasked: null,
          occurredAt: typeof data.paid_at === "string" ? new Date(data.paid_at) : ctx.now,
          sanitized,
        };
      }

      if (eventType === "refund.processed") {
        const refundReference = typeof data.transaction_reference === "string" ? data.transaction_reference : reference;
        if (!refundReference) {
          return { kind: "ignored", reason: "REFUND_WITHOUT_REFERENCE", sanitized };
        }
        return {
          kind: "reversal",
          providerReference: refundReference,
          providerTransactionId,
          amountMinor: amountMinor ?? 0,
          reason: "Paystack refund processed",
          sanitized,
        };
      }

      if (eventType === "charge.failed") {
        return {
          kind: "failure",
          providerReference: reference || null,
          providerTransactionId,
          code: "PAYSTACK_CHARGE_FAILED",
          message: "The customer's payment did not go through.",
          sanitized,
        };
      }

      return { kind: "ignored", reason: `UNHANDLED_${eventType || "EVENT"}`, sanitized };
    },

    refund: async (input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult> => {
      const config = readPaystackConfig();
      if (!config.ready) {
        return { ok: false, code: "PAYSTACK_NOT_CONNECTED", message: "Refunds are not available in this deployment yet.", retryable: false };
      }
      if (!input.transaction.providerTransactionId && !input.transaction.providerReference) {
        return { ok: false, code: "MISSING_PROVIDER_ID", message: "This payment has no Paystack reference to refund.", retryable: false };
      }
      try {
        const response = await ctx.fetchImpl(`${PAYSTACK_BASE}/refund`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret(config)}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction: input.transaction.providerTransactionId ?? input.transaction.providerReference,
            amount: String(input.amountMinor),
            merchant_note: input.reason.slice(0, 200),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        const result = (await response.json().catch(() => null)) as { status?: unknown; data?: Record<string, unknown>; message?: unknown } | null;
        if (!response.ok || !result?.status) {
          return {
            ok: false,
            code: "PAYSTACK_REFUND_FAILED",
            message: typeof result?.message === "string" ? `Paystack refused the refund: ${result.message}` : "Paystack could not be reached for this refund.",
            retryable: true,
            // A connection/server failure without an explicit refusal may have happened after the
            // provider accepted the request. Keep the reservation until reconciliation resolves it.
            outcomeUnknown: !result || response.status >= 500,
          };
        }
        return {
          ok: true,
          providerReference: result.data?.id == null ? null : String(result.data.id),
          message: "Paystack accepted the refund and will confirm when it completes.",
        };
      } catch {
        return { ok: false, code: "PAYSTACK_UNREACHABLE", message: "Paystack could not be reached for this refund.", retryable: true, outcomeUnknown: true };
      }
    },

    reverse: async (_input: ReversalInput, _ctx: AdapterContext): Promise<ProviderReversalResult> => ({
      ok: false,
      code: "REVERSAL_NOT_SUPPORTED",
      message: "Paystack does not reverse a completed payment; a refund is the correct correction. JATA has recorded this request for review.",
      retryable: false,
    }),

    reconcile: async (transaction, destination, ctx) => createPaystackAdapter().getPaymentStatus(transaction, destination, ctx),

    connectDestination: async (draft, ctx) => createPaystackAdapter().verifyDestination(draft, ctx),

    disconnectDestination: async () => ({
      ok: true,
      detail: "Online payments through Paystack will no longer use this destination. Existing records are unchanged.",
    }),

    destinationHintFromEvent: (_outcome: ProviderEventOutcome): DestinationHint => ({ kind: "PAYSTACK", providerDestinationId: null, providerAccountRef: null }),
  };
}

export { publicBaseUrl };
