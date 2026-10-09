/**
 * M-PESA (Safaricom Daraja) adapter — JATA's central connector (§11, §12, §13, §89).
 *
 * All provider-facing machinery belongs to JATA: authentication, the callback endpoints, the
 * event processing and the verification. The merchant enters a till or PayBill number and never
 * sees a URL, a key, a passkey or a payload (§3, §14, §54).
 *
 * What this adapter refuses to do:
 *   • claim it verified ownership of a till Safaricom does not expose an ownership lookup for —
 *     the strongest legitimate check available is the format check, and until JATA's Daraja
 *     connector is configured a destination is never reported as "connected" (§13, §52);
 *   • treat a callback as genuine because it *looks* like a payment. A callback must carry the
 *     token JATA registered with the provider (or come from an allowed provider address), and
 *     the resulting confirmation is still matched, amount-verified and idempotency-checked
 *     before it can make anything PAID (§24, §30, §35).
 *
 * When the connector is configured, the flows are real Daraja calls: OAuth, STK push, STK query,
 * C2B validation/confirmation callbacks and a reversal request.
 */

import { createHash } from "crypto";
import { MPESA_HOSTS, MPESA_MAX_TRANSACTION_KES, readMpesaConfig, readTestMode, publicBaseUrl, type MpesaConfig } from "../config";
import { decimalStringToMinor, formatMinor, maskPhone, normalizePhoneKE } from "../money";
import { normalizeMpesaReceipt } from "./mpesa-receipt";
import { identifyDestination, type DestinationDraft, type DestinationInput, type IdentificationResult } from "../destinations";
import type {
  CustomerInstructions,
  DestinationHint,
  ProviderCapability,
  ProviderEventOutcome,
  ProviderStatusReport,
  TransactionRecord,
} from "../types";
import type {
  AdapterContext,
  DestinationVerification,
  EventVerification,
  InitiationInput,
  PaymentProviderAdapter,
  ProviderEventRequest,
  ProviderReversalResult,
  RefundValidationInput,
  RefundValidation,
  ReversalInput,
} from "./types";

const DECLARED_CAPABILITIES: ProviderCapability[] = [
  "PAYMENT_INITIATION",
  "REAL_TIME_CONFIRMATION",
  "WEBHOOKS",
  "STATUS_QUERY",
  "REVERSALS",
  "MOBILE_MONEY",
  "PAYMENT_INSTRUCTIONS",
];

/**
 * STK Query result codes that are a final failure for the CheckoutRequestID (1 insufficient
 * balance, 1032 cancelled by the customer, 1037 customer unreachable / timed out, 2001 wrong PIN).
 * Deliberately short: a code JATA is not certain is final is treated as "still pending".
 */
const FINAL_STK_FAILURE_CODES = new Set(["1", "1032", "1037", "2001"]);

type TokenCache = { token: string; expiresAt: number };

/**
 * OAuth tokens are cached per (Daraja host, consumer key), never globally: a token minted for the
 * sandbox can never be presented to production, or the reverse, even if the configuration changes
 * inside a long-lived process.
 */
const tokenCache = new Map<string, TokenCache>();

function tokenCacheKey(config: MpesaConfig): string {
  return `${config.baseUrl}|${createHash("sha256").update(config.consumerKey).digest("hex").slice(0, 16)}`;
}

/** The documented identifier type for a reversal (see JATA_AFTERCALL_MPESA_READINESS.md §Reversals). */
export const MPESA_REVERSAL_RECEIVER_IDENTIFIER_TYPE = "11";

/** EAT (UTC+3) timestamp in the format Daraja expects: YYYYMMDDHHmmss. */
export function darajaTimestamp(now: Date): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${eat.getUTCFullYear()}${pad(eat.getUTCMonth() + 1)}${pad(eat.getUTCDate())}${pad(eat.getUTCHours())}${pad(eat.getUTCMinutes())}${pad(eat.getUTCSeconds())}`;
}

function stkPassword(config: MpesaConfig, timestamp: string): string {
  return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64");
}

export function resetMpesaTokenCache(): void {
  tokenCache.clear();
}

/**
 * Fail closed before any network call: the connector must be fully configured and pointed at one
 * of the two official Safaricom hosts for its declared environment. There is no fallback host.
 */
function assertConnectorUsable(config: MpesaConfig): void {
  if (!config.env || !config.ready || config.baseUrl !== MPESA_HOSTS[config.env]) {
    throw new Error("MPESA_NOT_CONFIGURED");
  }
}

async function accessToken(config: MpesaConfig, ctx: AdapterContext, forceRefresh = false): Promise<string> {
  assertConnectorUsable(config);
  const key = tokenCacheKey(config);
  const cached = tokenCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > ctx.now.getTime() + 30_000) return cached.token;
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const response = await ctx.fetchImpl(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (!response.ok || !token) {
    tokenCache.delete(key);
    throw new Error("MPESA_AUTH_FAILED");
  }
  const expiresIn = Number(body?.expires_in);
  tokenCache.set(key, { token, expiresAt: ctx.now.getTime() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_000_000) });
  return token;
}

type DarajaResponse = { ok: boolean; status: number; body: Record<string, unknown> | null };

/** Safaricom answers a stale or revoked OAuth token with 401 / errorCode 404.001.03 before processing anything. */
function isInvalidTokenResponse(result: DarajaResponse): boolean {
  if (result.status === 401) return true;
  return typeof result.body?.errorCode === "string" && result.body.errorCode === "404.001.03";
}

async function darajaPost(
  config: MpesaConfig,
  ctx: AdapterContext,
  path: string,
  body: Record<string, unknown>,
): Promise<DarajaResponse> {
  const send = async (token: string): Promise<DarajaResponse> => {
    const response = await ctx.fetchImpl(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, body: parsed };
  };
  let result = await send(await accessToken(config, ctx));
  if (isInvalidTokenResponse(result)) {
    // The gateway rejected the credential before processing the request, so one retry with a
    // freshly minted token cannot repeat a financial operation. This is the only retry in the
    // adapter: no timeout, 5xx or ambiguous answer is ever re-sent automatically.
    tokenCache.delete(tokenCacheKey(config));
    result = await send(await accessToken(config, ctx, true));
  }
  return result;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Safaricom STK result codes → the plain language a merchant may be shown (§86). Codes follow the
 * documented STK vocabulary (0 success, 1 insufficient balance, 1001 subscriber locked, 1019
 * expired, 1025 push error, 1032 cancelled by the customer, 1037 customer unreachable / timed out,
 * 2001 wrong PIN). Anything else gets a neutral sentence — Safaricom's free text is never echoed to
 * a merchant — and the code itself stays on the audit trail.
 */
export function mpesaFailureMessage(code: string, _description?: string): string {
  switch (code) {
    case "1":
      return "The customer's M-PESA balance was too low for this payment.";
    case "1001":
      return "Another M-PESA request is already open for this customer. Ask them to finish or cancel it, then try again.";
    case "1019":
      return "The M-PESA request expired before the customer approved it. They can try again.";
    case "1025":
      return "M-PESA could not send the prompt to the customer's phone. Try again.";
    case "1032":
      return "The customer cancelled the payment on their phone.";
    case "1037":
      return "The customer did not respond to the M-PESA prompt in time. They can try again.";
    case "2001":
      return "The customer entered the wrong M-PESA PIN. They can try again.";
    default:
      return "M-PESA did not complete this payment. Nothing is marked paid unless M-PESA confirms it.";
  }
}

function mpesaReversalFailureMessage(): string {
  return "M-PESA did not complete the reversal. The provider result has been recorded for review.";
}

/** A transport failure, classified without ever claiming more than JATA knows. */
function classifyTransportError(error: unknown): { code: string; message: string; retryable: boolean; sent: boolean } {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  if (message === "MPESA_NOT_CONFIGURED") {
    return { code: "MPESA_NOT_CONFIGURED", message: "M-PESA is not configured correctly in this deployment, so nothing was sent.", retryable: false, sent: false };
  }
  if (message === "MPESA_AUTH_FAILED") {
    return { code: "MPESA_AUTH_FAILED", message: "JATA could not authenticate with M-PESA, so nothing was sent. JATA's connector credentials need attention.", retryable: false, sent: false };
  }
  if (name === "TimeoutError" || name === "AbortError") {
    return { code: "MPESA_TIMEOUT", message: "M-PESA did not answer in time. If the customer sees a prompt they can still complete it — check before charging again.", retryable: true, sent: true };
  }
  return { code: "MPESA_UNREACHABLE", message: "M-PESA could not be reached. If the customer sees a prompt they can still complete it — check before charging again.", retryable: true, sent: true };
}

/** Daraja STK `AccountReference`: alphanumeric, at most 12 characters (documented limit). */
export const STK_ACCOUNT_REFERENCE_MAX = 12;
/** Daraja STK `TransactionDesc`: at most 13 characters (documented limit). */
export const STK_TRANSACTION_DESC = "JATA payment";

/**
 * The reference shown on the customer's STK prompt. A PayBill's own account number must reach it
 * unchanged, so one that cannot fit the 12-character limit means no STK prompt (null → show the
 * customer how to pay instead) rather than a silently altered account. Otherwise the tail of the
 * JATA payment id is used: it carries the order sequence and the random suffix. The authoritative
 * correlation is the CheckoutRequestID, never this text.
 */
export function stkAccountReference(input: { jataPaymentId: string; destination: { kind: string; providerAccountRef?: string | null } }): string | null {
  const merchantRef = String(input.destination.providerAccountRef ?? "").trim();
  if (input.destination.kind === "MPESA_PAYBILL" && merchantRef) {
    return /^[A-Za-z0-9]{1,12}$/.test(merchantRef) ? merchantRef : null;
  }
  const alphanumeric = String(input.jataPaymentId ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return alphanumeric.slice(-STK_ACCOUNT_REFERENCE_MAX) || "JATA";
}

/** The identity of an asynchronous result or timeout payload (reversals). */
function readResultIdentity(body: Record<string, unknown>) {
  const resultBody = body.Result && typeof body.Result === "object" && !Array.isArray(body.Result)
    ? body.Result as Record<string, unknown>
    : body;
  const parameters = resultBody.ResultParameters as Record<string, unknown> | undefined;
  const items = Array.isArray(parameters?.ResultParameter) ? (parameters.ResultParameter as Record<string, unknown>[]) : [];
  const parameter = (key: string) => items.find((item) => stringField(item, "Key") === key)?.Value;
  return {
    conversationId: stringField(resultBody, "ConversationID") || stringField(resultBody, "OriginatorConversationID"),
    originatorId: stringField(resultBody, "OriginatorConversationID"),
    resultCode: stringField(resultBody, "ResultCode"),
    resultDescription: stringField(resultBody, "ResultDesc").slice(0, 200),
    amountValue: parameter("Amount"),
    // The receipt of the payment that was reversed — how a result is tied back to a refund even if
    // the synchronous response that would have carried the conversation id was lost.
    originalTransactionId: normalizeMpesaReceipt(parameter("OriginalTransactionID")),
  };
}

function normalizeIp(value: string): string {
  return value.trim().toLowerCase().replace(/^::ffff:/, "");
}

/** The M-PESA till/PayBill that a callback's shortcode refers to (§56). */
export function destinationHintForShortcode(shortcode: string, accountRef = ""): DestinationHint {
  const digits = shortcode.replace(/[^0-9]/g, "");
  return {
    kind: accountRef ? "MPESA_PAYBILL" : "MPESA_TILL",
    providerDestinationId: digits || null,
    providerAccountRef: accountRef || null,
  };
}

function stkInstructions(destination: { providerDestinationId: string }, amountMinor: number, currency: string): CustomerInstructions {
  return {
    mode: "PROMPT_ON_PHONE",
    headline: `PAY ${formatMinor(amountMinor, currency)}`,
    body: "Check your phone and approve the payment.",
    steps: ["Keep this screen open.", "We will update it the moment M-PESA confirms."],
    automaticConfirmation: true,
  };
}

export function createMpesaAdapter(): PaymentProviderAdapter {
  return {
    key: "MPESA",
    displayName: "M-PESA",
    supportedKinds: ["MPESA_TILL", "MPESA_PAYBILL", "MPESA_POCHI"],

    declaredCapabilities: () => [...DECLARED_CAPABILITIES],

    connectorReady: () => readMpesaConfig().ready,

    connectorNote: () => {
      const config = readMpesaConfig();
      return config.ready
        ? `Daraja ${config.env} connector configured; JATA registers the callbacks centrally.`
        : "M-PESA central connector credentials are not configured in this deployment.";
    },

    identifyDestination: (input: DestinationInput): IdentificationResult => identifyDestination(input),
    validateDestination: (input: DestinationInput): IdentificationResult => identifyDestination(input),

    /**
     * §13, §52: Safaricom does not expose a public till-ownership lookup, so JATA does not invent
     * one. A well-formed destination is FORMAT_VERIFIED. It only becomes CONNECTED when JATA's
     * central connector is live for the deployment, and the capability list then tells the truth
     * about what can happen next.
     */
    verifyDestination: async (draft: DestinationDraft, _ctx: AdapterContext): Promise<DestinationVerification> => {
      const config = readMpesaConfig();
      if (!config.ready) {
        return {
          level: "FORMAT",
          status: "ACTION_REQUIRED",
          capabilities: ["PAYMENT_INSTRUCTIONS"],
          detail:
            "JATA is completing the M-PESA connection for this destination. You can still show customers where to pay, but confirmation will not be automatic yet.",
          actionRequired: { label: "JATA is finishing this connection", kind: "SUPPORT" },
        };
      }
      return {
        level: "PROVIDER",
        status: "CONNECTED",
        capabilities: DECLARED_CAPABILITIES.filter((capability) => capability !== "REVERSALS" || draft.kind !== "MPESA_POCHI"),
        detail: "Real-time payment confirmation is on. JATA receives the confirmation from M-PESA and updates your POS automatically.",
        providerDestinationId: draft.providerDestinationId,
      };
    },

    getCapabilities: (destination) => {
      const ready = readMpesaConfig().ready;
      if (!ready) return ["PAYMENT_INSTRUCTIONS"];
      if (destination?.kind === "MPESA_POCHI") {
        return DECLARED_CAPABILITIES.filter((capability) => capability !== "REVERSALS" && capability !== "PAYMENT_INITIATION");
      }
      return [...DECLARED_CAPABILITIES];
    },

    getDisplayInstructions: ({ destination, amountMinor, currency }): CustomerInstructions => {
      if (destination.kind === "MPESA_PAYBILL") {
        return {
          mode: "PAYBILL",
          headline: `PAY ${formatMinor(amountMinor, currency)}`,
          body: `M-PESA PayBill ${destination.providerDestinationId}`,
          steps: [`Business number: ${destination.providerDestinationId}`, `Account: ${destination.providerAccountRef || "—"}`, "Approve on your phone."],
          automaticConfirmation: false,
        };
      }
      if (destination.kind === "MPESA_POCHI") {
        return {
          mode: "POCHI",
          headline: `PAY ${formatMinor(amountMinor, currency)}`,
          body: "Send the money on M-PESA to this Pochi number.",
          steps: [destination.providerDestinationId],
          automaticConfirmation: false,
        };
      }
      return {
        mode: "TILL",
        headline: `PAY ${formatMinor(amountMinor, currency)}`,
        body: `Buy Goods / Till ${destination.providerDestinationId}`,
        steps: [`Enter till ${destination.providerDestinationId}`, `Enter amount ${formatMinor(amountMinor, currency)}`, "Approve on your phone."],
        automaticConfirmation: false,
      };
    },

    /**
     * §22, §89: raise the STK prompt on the customer's phone and wait for M-PESA to confirm.
     * JATA never asks the customer for a PIN (§93) — the prompt appears on their own phone.
     */
    createPaymentRequest: async (input: InitiationInput, ctx: AdapterContext) => {
      const config = readMpesaConfig();
      if (!config.ready) {
        return {
          kind: "manual" as const,
          method: `${input.destination.kind}_MANUAL`,
          instructions: {
            ...createMpesaAdapterInstructions(input, ctx),
            automaticConfirmation: false,
          },
        };
      }

      const phone = normalizePhoneKE(input.customer.phone);
      if (input.destination.kind === "MPESA_POCHI" || !phone) {
        // No prompt is possible without a phone number: show where to pay instead of guessing.
        return { kind: "manual" as const, method: `${input.destination.kind}_MANUAL`, instructions: createMpesaAdapterInstructions(input, ctx) };
      }
      const manualInstead = () => ({
        kind: "manual" as const,
        method: `${input.destination.kind}_MANUAL`,
        instructions: createMpesaAdapterInstructions(input, ctx),
      });

      // ── Request validation: every rule Daraja documents is checked before anything is sent ──
      const partyB = String(input.destination.providerDestinationId ?? "").replace(/[^0-9]/g, "");
      if (!/^\d{5,7}$/.test(partyB)) {
        return { kind: "failed" as const, code: "MPESA_DESTINATION_INVALID", message: "This payment destination is not a valid M-PESA till or PayBill number.", retryable: false };
      }
      // For CustomerPayBillOnline Daraja requires PartyB to be the shortcode that receives the
      // money (the BusinessShortCode). A PayBill that is not the connector's own cannot be
      // prompted for: the customer is shown how to pay instead of being sent a doomed request.
      if (input.destination.kind === "MPESA_PAYBILL" && partyB !== config.shortcode) return manualInstead();
      const accountReference = stkAccountReference(input);
      if (!accountReference) return manualInstead();

      // STK Push charges whole shillings. A fractional total is refused, never rounded: rounding
      // would charge the customer a different amount from the sale and the confirmation would
      // then (correctly) fail the exact-amount check.
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor % 100 !== 0) {
        return { kind: "failed" as const, code: "MPESA_AMOUNT_NOT_WHOLE", message: "M-PESA can only charge whole shillings. Adjust the total so it has no cents, or let the customer pay manually.", retryable: false };
      }
      const amount = input.amountMinor / 100;
      if (amount < 1 || amount > MPESA_MAX_TRANSACTION_KES) {
        return { kind: "failed" as const, code: "MPESA_AMOUNT_OUT_OF_RANGE", message: `M-PESA can charge between KES 1 and KES ${MPESA_MAX_TRANSACTION_KES.toLocaleString("en-KE")} in one payment.`, retryable: false };
      }

      const timestamp = darajaTimestamp(ctx.now);
      const transactionType = input.destination.kind === "MPESA_PAYBILL" ? "CustomerPayBillOnline" : "CustomerBuyGoodsOnline";
      const body: Record<string, unknown> = {
        BusinessShortCode: config.shortcode,
        Password: stkPassword(config, timestamp),
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: partyB,
        PhoneNumber: phone,
        CallBackURL: config.stkCallbackUrl,
        AccountReference: accountReference,
        TransactionDesc: STK_TRANSACTION_DESC,
      };

      let response: DarajaResponse;
      try {
        response = await darajaPost(config, ctx, "/mpesa/stkpush/v1/processrequest", body);
      } catch (error) {
        const failure = classifyTransportError(error);
        return { kind: "failed" as const, code: failure.code, message: failure.message, retryable: failure.retryable };
      }
      const payload = response.body ?? {};
      const checkoutRequestId = stringField(payload, "CheckoutRequestID");
      const responseCode = stringField(payload, "ResponseCode");
      const errorCode = stringField(payload, "errorCode");
      const errorMessage = stringField(payload, "errorMessage").slice(0, 200);

      // Acceptance means ResponseCode "0" *and* a CheckoutRequestID — the handle the callback quotes.
      if (!response.ok || responseCode !== "0" || !checkoutRequestId) {
        return {
          kind: "failed" as const,
          code: errorCode || (responseCode ? `MPESA_RESPONSE_${responseCode}` : "MPESA_REQUEST_FAILED"),
          message: errorMessage ? `M-PESA could not start this payment: ${errorMessage}` : "M-PESA could not start this payment. Try again.",
          retryable: response.status >= 500 || response.status === 429,
        };
      }

      return {
        kind: "initiated" as const,
        method: "MPESA_STK",
        providerReference: input.providerReference,
        // The checkout id is what the M-PESA callback will quote: the correlation handle (§64).
        providerTransactionId: checkoutRequestId,
        instructions: stkInstructions(input.destination, input.amountMinor, input.currency),
      };
    },

    /** §24, §68: ask M-PESA what actually happened rather than guessing on a timeout. */
    getPaymentStatus: async (transaction, destination, ctx): Promise<ProviderStatusReport> => {
      const config = readMpesaConfig();
      if (!config.ready) {
        // JATA has no active Daraja connection in this deployment, so it has nothing to ask. Saying
        // so is the honest answer: the payment is not marked failed, and it is not marked paid.
        return {
          status: "UNKNOWN",
          amountMinor: null,
          currency: null,
          providerTransactionId: null,
          message: "JATA's M-PESA connection is not active in this deployment, so this payment cannot be checked with Safaricom.",
        };
      }
      if (!transaction.providerTransactionId || !transaction.method?.startsWith("MPESA_STK")) {
        return {
          status: "UNKNOWN",
          amountMinor: null,
          currency: null,
          providerTransactionId: null,
          message: "JATA has no M-PESA request to check for this payment.",
        };
      }
      const timestamp = darajaTimestamp(ctx.now);
      const unknown = (message: string | null): ProviderStatusReport => ({
        status: "UNKNOWN",
        amountMinor: null,
        currency: null,
        providerTransactionId: transaction.providerTransactionId,
        message,
      });
      let response: DarajaResponse;
      try {
        response = await darajaPost(config, ctx, "/mpesa/stkpushquery/v1/query", {
          BusinessShortCode: config.shortcode,
          Password: stkPassword(config, timestamp),
          Timestamp: timestamp,
          CheckoutRequestID: transaction.providerTransactionId,
        });
      } catch {
        return unknown(null);
      }
      const code = stringField(response.body ?? {}, "ResultCode");

      // Only a *final* answer moves a payment. Safaricom answers an in-flight request with
      // ResultCode 4999 ("still under processing", HTTP 200) or with the non-discriminating error
      // 500.001.1001 — neither is a verdict, and neither may close a payment the customer is still
      // completing. Unrecognised codes are treated the same way: pending, never failed.
      if (response.ok && code === "0") {
        // The query carries no amount and no receipt. The prompt charged exactly what was
        // requested, so that figure is booked — flagged as not independently reported.
        return {
          status: "CONFIRMED",
          amountMinor: transaction.amountMinor,
          currency: transaction.currency,
          providerTransactionId: transaction.providerTransactionId,
          message: "M-PESA confirmed this payment.",
          amountVerified: false,
          providerReceipt: null,
        };
      }
      if (response.ok && FINAL_STK_FAILURE_CODES.has(code)) {
        return { status: "FAILED", amountMinor: null, currency: null, providerTransactionId: transaction.providerTransactionId, message: mpesaFailureMessage(code, "") };
      }
      if (response.ok && code) {
        return {
          status: "PENDING",
          amountMinor: null,
          currency: null,
          providerTransactionId: transaction.providerTransactionId,
          message: "M-PESA has not given a final answer yet. Nothing is marked paid until it does.",
        };
      }
      return unknown("M-PESA could not say yet. Nothing is marked paid until it confirms.");
    },

    /**
     * §35: a callback is only accepted when it carries the token JATA registered with Safaricom
     * (or arrives from an allowed provider address when an allowlist is configured). The token is
     * compared in constant time and never echoed back.
     */
    verifyEvent: async (request: ProviderEventRequest, _ctx: AdapterContext): Promise<EventVerification> => {
      const config = readMpesaConfig();
      const path = request.url.pathname.replace(/\/+$/, "");
      const isStk = path.endsWith("/stk");
      const isValidation = path.endsWith("/validation");
      const isTimeout = path.endsWith("/timeout");
      const isResult = path.endsWith("/result");

      const body = request.payload;
      const resultBody = body.Result && typeof body.Result === "object" && !Array.isArray(body.Result)
        ? body.Result as Record<string, unknown>
        : body;
      const stkCallback = (body.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;
      const checkoutId = stkCallback ? stringField(stkCallback, "CheckoutRequestID") : "";
      const resultCode = stkCallback ? stringField(stkCallback, "ResultCode") : stringField(resultBody, "ResultCode");
      const transId = stringField(body, "TransID") || stringField(resultBody, "TransID");
      const conversationId = stringField(resultBody, "ConversationID") || stringField(resultBody, "OriginatorConversationID");

      // The event id is the idempotency key. A timeout is its own event, never the same as the
      // result that may still follow for the same conversation; a timeout payload that names no
      // conversation is keyed by a digest of its body so it is still acknowledged exactly once.
      const eventId = isStk
        ? checkoutId ? `stk:${checkoutId}:${resultCode}` : ""
        : isValidation
          ? `c2b-validation:${transId || conversationId}`
          : isTimeout
            ? conversationId
              ? `timeout:${conversationId}`
              : `timeout:body:${createHash("sha256").update(request.rawBody).digest("hex").slice(0, 32)}`
            : isResult && conversationId
              ? `result:${conversationId}:${resultCode}`
              : transId
                ? `c2b:${transId}`
                : conversationId
                  ? `result:${conversationId}:${resultCode}`
                  : "";
      const eventType = isStk
        ? "STK_CALLBACK"
        : isValidation
          ? "C2B_VALIDATION"
          : isTimeout
            ? "REVERSAL_TIMEOUT"
            : isResult
              ? "REVERSAL_RESULT"
              : "C2B_CONFIRMATION";

      if (!eventId || eventId.length > 200) {
        return { ok: false, code: "INVALID_EVENT", message: "Unrecognised provider payload.", eventId: null, eventType: null };
      }

      const presented = request.url.searchParams.get("token") ?? "";
      if (config.callbackToken) {
        if (!safeEqual(presented, config.callbackToken)) {
          return { ok: false, code: "CALLBACK_TOKEN_INVALID", message: "Callback token did not match.", eventId, eventType };
        }
      } else if (!readTestMode().explicit) {
        // Without a registered callback token JATA cannot tell a real Daraja callback from a
        // stranger's POST, so it refuses instead of trusting that whoever found the URL is
        // Safaricom. Only a deployment running deliberately in test mode
        // (JATA_PAYMENTS_TEST_MODE=on, which is ignored on any production deployment) may accept
        // them; a production deployment never will (§35, §120).
        return { ok: false, code: "CALLBACK_TOKEN_NOT_CONFIGURED", message: "JATA has not registered a callback token for M-PESA.", eventId, eventType };
      }

      if (config.allowedIps.length) {
        const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
        const clientIp = normalizeIp(forwarded || request.headers.get("x-real-ip") || "");
        if (!clientIp || !config.allowedIps.map(normalizeIp).includes(clientIp)) {
          return { ok: false, code: "CALLBACK_IP_REJECTED", message: "Callback did not come from an allowed M-PESA address.", eventId, eventType };
        }
      }

      return { ok: true, eventId, eventType };
    },

    parseEvent: async (request: ProviderEventRequest, ctx: AdapterContext): Promise<ProviderEventOutcome> => {
      const body = request.payload;
      const path = request.url.pathname.replace(/\/+$/, "");
      const stkCallback = (body.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;

      // ── STK prompt result ────────────────────────────────────────────────────
      if (stkCallback) {
        const checkoutId = stringField(stkCallback, "CheckoutRequestID");
        const resultCode = stringField(stkCallback, "ResultCode");
        const resultDesc = stringField(stkCallback, "ResultDesc");
        const sanitized: Record<string, unknown> = { type: "STK_CALLBACK", checkoutRequestId: checkoutId, resultCode, resultDesc: resultDesc.slice(0, 200) };
        if (resultCode !== "0") {
          return {
            kind: "failure",
            providerReference: null,
            providerTransactionId: checkoutId || null,
            code: `MPESA_${resultCode || "UNKNOWN"}`,
            message: mpesaFailureMessage(resultCode, resultDesc),
            sanitized,
          };
        }
        const metadata = (stkCallback.CallbackMetadata as Record<string, unknown> | undefined)?.Item;
        const items = Array.isArray(metadata) ? (metadata as Record<string, unknown>[]) : [];
        const valueOf = (name: string) => items.find((item) => stringField(item, "Name") === name)?.Value;
        const amountMinor = decimalStringToMinor(valueOf("Amount"));
        const providerReceipt = normalizeMpesaReceipt(valueOf("MpesaReceiptNumber"));
        const phone = valueOf("PhoneNumber");
        if (amountMinor === null || amountMinor <= 0) {
          // ResultCode 0 means the customer PAID. A success whose amount JATA cannot verify is not
          // a failure — closing the payment as FAILED (a terminal state) would hide real money. It
          // goes through the amount-mismatch path instead: nothing is marked paid, the payment stays
          // open for "Check status" (STK Query) to settle, and a reconciliation exception is raised.
          return {
            kind: "confirmation",
            providerReference: "",
            providerTransactionId: checkoutId || null,
            providerReceipt,
            amountMinor: 0,
            currency: "KES",
            destination: { kind: null, providerDestinationId: null, providerAccountRef: null },
            method: "MPESA_STK",
            customerName: null,
            customerPhoneMasked: maskPhone(phone),
            occurredAt: ctx.now,
            sanitized: { ...sanitized, amountStatus: "MISSING_OR_INVALID", ...(providerReceipt ? { receipt: providerReceipt } : {}) },
          };
        }
        return {
          kind: "confirmation",
          providerReference: "", // correlated by CheckoutRequestID (§64)
          // Never fall back to MpesaReceiptNumber: this remains the CheckoutRequestID correlation.
          providerTransactionId: checkoutId || null,
          providerReceipt,
          amountMinor,
          currency: "KES",
          destination: { kind: null, providerDestinationId: null, providerAccountRef: null },
          method: "MPESA_STK",
          customerName: null,
          customerPhoneMasked: maskPhone(phone),
          occurredAt: ctx.now,
          sanitized: {
            ...sanitized,
            ...(providerReceipt ? { receipt: providerReceipt } : { receiptStatus: "MISSING_OR_INVALID" }),
            amountMinor,
          },
        };
      }

      // ── Reversal queue timeout: a notice, never a verdict ────────────────────────────
      // QueueTimeOutURL means Safaricom's queue gave up on the request. The operation may still
      // complete later, so this must not be read as "the reversal failed" (which would release the
      // reserved amount for a second, duplicate payout).
      if (path.endsWith("/timeout")) {
        const identity = readResultIdentity(body);
        return {
          kind: "reversal_timeout",
          providerReference: identity.originatorId || identity.conversationId || null,
          providerTransactionId: identity.conversationId || null,
          originalTransactionId: identity.originalTransactionId,
          sanitized: {
            type: "REVERSAL_TIMEOUT",
            conversationId: identity.conversationId || null,
            originatorConversationId: identity.originatorId || null,
          },
        };
      }

      const transId = stringField(body, "TransID");
      const amountMinor = decimalStringToMinor(stringField(body, "TransAmount") || stringField(body, "TransactionAmount"));
      const shortcode = stringField(body, "BusinessShortCode") || stringField(body, "ShortCode");
      const accountRef = stringField(body, "BillRefNumber");
      const isValidation = path.endsWith("/validation");

      // ── C2B validation: JATA's central endpoint answers the provider (§12, §34) ──
      if (isValidation) {
        if (!transId || amountMinor === null || amountMinor <= 0 || !shortcode) {
          return { kind: "ignored", reason: "VALIDATION_INCOMPLETE", sanitized: { type: "C2B_VALIDATION", transId, rejected: true } };
        }
        return {
          kind: "ignored",
          reason: "VALIDATION_ACCEPTED",
          sanitized: { type: "C2B_VALIDATION", transId, shortcode, amountMinor, accepted: true },
        };
      }

      // ── C2B confirmation: the authoritative "money arrived at this destination" event ──
      if (transId && amountMinor !== null && amountMinor > 0 && shortcode) {
        return {
          kind: "confirmation",
          providerReference: accountRef && /^[A-Za-z]{2,4}-JTP-/.test(accountRef) ? accountRef : "",
          providerTransactionId: transId,
          amountMinor,
          currency: "KES",
          destination: destinationHintForShortcode(shortcode, accountRef),
          method: accountRef ? "MPESA_C2B_PAYBILL" : "MPESA_C2B_TILL",
          customerName: [stringField(body, "FirstName"), stringField(body, "MiddleName"), stringField(body, "LastName")].filter(Boolean).join(" ") || null,
          customerPhoneMasked: maskPhone(stringField(body, "MSISDN")),
          occurredAt: parseMpesaTime(stringField(body, "TransTime")) ?? ctx.now,
          sanitized: { type: "C2B_CONFIRMATION", transId, shortcode, amountMinor, accountRef: accountRef || null, transactionType: stringField(body, "TransactionType") || null },
        };
      }

      // ── Asynchronous result (a reversal) ─────────────────────────────────────
      const identity = readResultIdentity(body);
      const reversalAmountMinor = amountMinor ?? decimalStringToMinor(identity.amountValue);
      if (identity.conversationId && identity.resultCode) {
        const success = identity.resultCode === "0";
        // Daraja's OriginatorConversationID is what the refund reservation persisted.
        const reference = identity.originatorId || identity.conversationId;
        return {
          kind: success ? "reversal" : "failure",
          ...(success
            ? {
                providerReference: reference,
                providerTransactionId: identity.conversationId,
                originalTransactionId: identity.originalTransactionId,
                amountMinor: reversalAmountMinor ?? 0,
                reason: identity.resultDescription || "Provider reversal",
                sanitized: {
                  type: "RESULT",
                  resultCode: identity.resultCode,
                  conversationId: identity.conversationId,
                  resultDesc: identity.resultDescription || null,
                  amountMinor: reversalAmountMinor,
                  originalTransactionId: identity.originalTransactionId,
                },
              }
            : {
                providerReference: reference,
                providerTransactionId: identity.conversationId,
                originalTransactionId: identity.originalTransactionId,
                code: `MPESA_${identity.resultCode}`,
                message: mpesaReversalFailureMessage(),
                sanitized: {
                  type: "RESULT",
                  resultCode: identity.resultCode,
                  conversationId: identity.conversationId,
                  resultDesc: identity.resultDescription || null,
                  originalTransactionId: identity.originalTransactionId,
                },
              }),
        } as ProviderEventOutcome;
      }

      return { kind: "ignored", reason: "UNSUPPORTED_PAYLOAD", sanitized: { type: "UNKNOWN" } };
    },

    refund: async (input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult> => {
      // M-PESA has no separate refund product: returning money is a reversal (§48).
      return createMpesaAdapter().reverse(input, ctx);
    },

    /**
     * §48: a provider-issued reversal, requested through Daraja's Reversal API (the
     * `TransactionReversal` command). It needs the initiator credentials in addition to the
     * collection ones and reverses a payment in full — see `validateRefund`.
     *
     * Money moves out here, so this method never retries and never claims more than it knows:
     * a timeout, a 5xx or an answer without a conversation id is an UNKNOWN outcome (the reversal
     * may still be processed), not a failure, and `retryable` is always false for it.
     */
    reverse: async (input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult> => {
      const isStk = String(input.transaction.method ?? "").startsWith("MPESA_STK") ||
        /^ws_CO_/i.test(String(input.transaction.providerTransactionId ?? ""));
      // STK's providerTransactionId is a CheckoutRequestID, not a TransactionID accepted by
      // Daraja's reversal API. Only the authenticated callback's persisted receipt is valid here.
      const providerTransactionId = isStk
        ? normalizeMpesaReceipt(input.transaction.providerReceipt)
        : input.transaction.providerTransactionId;
      if (!providerTransactionId) {
        return {
          ok: false,
          code: isStk ? "MISSING_MPESA_RECEIPT" : "MISSING_PROVIDER_ID",
          message: isStk
            ? "This STK payment has no valid M-PESA receipt to reverse. JATA has recorded it for review."
            : "This payment has no M-PESA transaction reference to reverse.",
          retryable: false,
        };
      }
      const config = readMpesaConfig();
      if (!config.ready) {
        return {
          ok: false,
          code: "MPESA_NOT_CONNECTED",
          message: "M-PESA reversals are not available in this deployment yet. JATA has recorded the request for review.",
          retryable: false,
        };
      }
      if (!config.reversalReady) {
        // No invented initiator and no empty credential: a reversal is refused locally, with a
        // diagnostic that names the variable, before anything is sent to Safaricom.
        return {
          ok: false,
          code: "MPESA_REVERSAL_NOT_CONFIGURED",
          message: "M-PESA reversals are not set up in this deployment yet (the API initiator is not configured). Nothing was sent.",
          retryable: false,
        };
      }
      const paidMinor = Number(input.transaction.amountPaidMinor || input.transaction.amountMinor || 0);
      if (input.amountMinor !== paidMinor || Number(input.transaction.amountRefundedMinor ?? 0) > 0) {
        return {
          ok: false,
          code: "MPESA_PARTIAL_REVERSAL_UNSUPPORTED",
          message: "M-PESA can only reverse a payment in full, once. Nothing was sent.",
          retryable: false,
        };
      }
      const amount = Math.max(1, Math.round(input.amountMinor / 100));
      const destinationDigits = String(input.destination?.providerDestinationId ?? "").replace(/[^0-9]/g, "");
      let response: DarajaResponse;
      try {
        response = await darajaPost(config, ctx, "/mpesa/reversal/v1/request", {
          Initiator: config.initiatorName,
          SecurityCredential: config.securityCredential,
          CommandID: "TransactionReversal",
          TransactionID: providerTransactionId,
          Amount: amount,
          ReceiverParty: /^\d{5,7}$/.test(destinationDigits) ? destinationDigits : config.shortcode,
          RecieverIdentifierType: MPESA_REVERSAL_RECEIVER_IDENTIFIER_TYPE,
          ResultURL: config.c2bConfirmationUrl.replace("/confirmation", "/result"),
          QueueTimeOutURL: config.c2bValidationUrl.replace("/validation", "/timeout"),
          Remarks: input.reason.slice(0, 100),
          Occasion: "JATA reversal",
        });
      } catch (error) {
        const failure = classifyTransportError(error);
        if (!failure.sent) {
          // Authentication or configuration failed before the request existed: nothing is in flight.
          return { ok: false, code: failure.code, message: failure.message, retryable: false };
        }
        return {
          ok: false,
          code: "MPESA_REVERSAL_RESULT_UNKNOWN",
          message: "M-PESA did not confirm the reversal request. It may still be processed, so JATA keeps the amount reserved and will not send it again. Check the M-PESA portal before trying again.",
          retryable: false,
          outcomeUnknown: true,
        };
      }
      const body = response.body ?? {};
      const errorCode = stringField(body, "errorCode");
      if (response.status >= 500) {
        return {
          ok: false,
          code: "MPESA_REVERSAL_RESULT_UNKNOWN",
          message: "M-PESA answered with a server error. The reversal may still be processed, so JATA keeps the amount reserved and will not send it again. Check the M-PESA portal before trying again.",
          retryable: false,
          outcomeUnknown: true,
        };
      }
      if (!response.ok || errorCode) {
        // A 4xx with an error code is Safaricom refusing the request: nothing was reversed.
        const detail = stringField(body, "errorMessage").slice(0, 200);
        return {
          ok: false,
          code: errorCode || "MPESA_REVERSAL_FAILED",
          message: detail ? `M-PESA refused the reversal: ${detail}` : "M-PESA refused the reversal. Nothing was reversed.",
          retryable: false,
        };
      }
      const conversation = stringField(body, "OriginatorConversationID") || stringField(body, "ConversationID");
      if (stringField(body, "ResponseCode") !== "0" || !conversation) {
        // Accepted, refused or lost? Without ResponseCode 0 and a conversation id JATA cannot tie
        // the later Result callback to this refund, so it is recorded as unknown, not completed.
        return {
          ok: false,
          code: "MPESA_REVERSAL_RESULT_UNKNOWN",
          message: "M-PESA's answer to the reversal request was incomplete. JATA keeps the amount reserved and will not send it again. Check the M-PESA portal before trying again.",
          retryable: false,
          outcomeUnknown: true,
        };
      }
      return {
        ok: true,
        providerReference: conversation,
        message: "M-PESA accepted the reversal; it will confirm shortly.",
      };
    },

    /**
     * Pre-flight for a refund, run while the payment is locked and before any amount is reserved.
     * It refuses only what Daraja's Reversal API makes impossible *by policy*, so nothing is
     * reserved or sent for it: Pochi payments cannot be reversed, and a payment is reversed once
     * and in full (partial reversal is not documented, so it is refused rather than guessed).
     *
     * Data and configuration problems — a missing receipt, an unconfigured initiator — are NOT
     * refused here. They go on to `reverse`, which fails them with a durable refund row, audit event
     * and reconciliation exception, so a person is told which payment needs attention.
     */
    validateRefund: (input: RefundValidationInput): RefundValidation => {
      if (input.destination?.kind === "MPESA_POCHI") {
        return { ok: false, code: "MPESA_NOT_REVERSIBLE", message: "Pochi la Biashara payments cannot be reversed through M-PESA." };
      }
      const paidMinor = Number(input.transaction.amountPaidMinor || input.transaction.amountMinor || 0);
      if (input.alreadyRefundedMinor > 0 || input.outstandingMinor > 0 || input.amountMinor !== paidMinor) {
        return {
          ok: false,
          code: "MPESA_PARTIAL_REVERSAL_UNSUPPORTED",
          message: "M-PESA can only reverse a payment in full, once. Refund the whole amount, or return part of it another way (for example in cash).",
        };
      }
      return { ok: true };
    },

    reconcile: async (transaction, destination, ctx) => createMpesaAdapter().getPaymentStatus(transaction, destination, ctx),

    connectDestination: async (draft, ctx) => createMpesaAdapter().verifyDestination(draft, ctx),

    disconnectDestination: async () => ({
      ok: true,
      detail: "This destination will no longer be used for new payments. Existing records are unchanged.",
    }),

    destinationHintFromEvent: (outcome: ProviderEventOutcome): DestinationHint =>
      outcome.kind === "confirmation" ? outcome.destination : { kind: null, providerDestinationId: null, providerAccountRef: null },
  };
}

function createMpesaAdapterInstructions(input: InitiationInput, _ctx: AdapterContext): CustomerInstructions {
  return createMpesaAdapter().getDisplayInstructions({
    destination: input.destination,
    amountMinor: input.amountMinor,
    currency: input.currency,
    providerReference: input.providerReference,
  });
}

/** `TransTime` is EAT: YYYYMMDDHHmmss. */
export function parseMpesaTime(value: string): Date | null {
  if (!/^\d{14}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - 3 * 60 * 60 * 1000;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Constant-time compare so a wrong token cannot be discovered byte by byte (§35). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export { publicBaseUrl };

/** Used by the wallet screen when the connector is live: the customer's phone is required. */
export function stkNeedsPhone(): boolean {
  return true;
}

export { TransactionRecord as MpesaTransactionRecord };
