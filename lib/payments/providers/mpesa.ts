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

import { readMpesaConfig, readTestMode, publicBaseUrl, type MpesaConfig } from "../config";
import { decimalStringToMinor, formatMinor, maskPhone, normalizePhoneKE } from "../money";
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

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

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
  tokenCache = null;
}

async function accessToken(config: MpesaConfig, ctx: AdapterContext): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > ctx.now.getTime() + 30_000) return tokenCache.token;
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const response = await ctx.fetchImpl(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (!response.ok || !token) throw new Error("MPESA_AUTH_FAILED");
  const expiresIn = Number(body?.expires_in);
  tokenCache = { token, expiresAt: ctx.now.getTime() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_000_000) };
  return token;
}

async function darajaPost(
  config: MpesaConfig,
  ctx: AdapterContext,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  const token = await accessToken(config, ctx);
  const response = await ctx.fetchImpl(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, body: parsed };
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Safaricom error codes → the plain language a merchant may be shown (§86). */
export function mpesaFailureMessage(code: string, description: string): string {
  switch (code) {
    case "1032":
    case "1037":
    case "2001":
      return "The customer did not enter their M-PESA PIN in time. They can try again.";
    case "1":
      return "The customer cancelled the payment on their phone.";
    case "1025":
      return "The customer has no money in their M-PESA account.";
    case "1026":
      return "The customer cancelled the payment on their phone.";
    case "1031":
      return "M-PESA is busy right now. Please try again.";
    case "9999":
      return "M-PESA could not complete this payment.";
    case "1001":
      return "Another payment is already in progress for this customer.";
    default:
      return description || "We couldn't confirm this payment yet. It may still be processing.";
  }
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

      const timestamp = darajaTimestamp(ctx.now);
      const transactionType = input.destination.kind === "MPESA_PAYBILL" ? "CustomerPayBillOnline" : "CustomerBuyGoodsOnline";
      const amount = Math.max(1, Math.round(input.amountMinor / 100));

      const body: Record<string, unknown> = {
        BusinessShortCode: config.shortcode,
        Password: stkPassword(config, timestamp),
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: input.destination.providerDestinationId,
        PhoneNumber: phone,
        CallBackURL: config.stkCallbackUrl,
        AccountReference: input.destination.providerAccountRef || input.providerReference,
        TransactionDesc: `JATA ${input.providerReference}`.slice(0, 100),
      };

      const response = await darajaPost(config, ctx, "/mpesa/stkpush/v1/processrequest", body);
      const checkoutRequestId = stringField(response.body ?? {}, "CheckoutRequestID");
      const errorCode = stringField(response.body ?? {}, "errorCode");
      const errorMessage = stringField(response.body ?? {}, "errorMessage");

      if (!response.ok || !checkoutRequestId) {
        return {
          kind: "failed" as const,
          code: errorCode || "MPESA_REQUEST_FAILED",
          message: errorMessage ? `M-PESA could not start this payment: ${errorMessage}` : "M-PESA could not start this payment. Try again.",
          retryable: true,
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
      try {
        const response = await darajaPost(config, ctx, "/mpesa/stkpushquery/v1/query", {
          BusinessShortCode: config.shortcode,
          Password: stkPassword(config, timestamp),
          Timestamp: timestamp,
          CheckoutRequestID: transaction.providerTransactionId,
        });
        const code = stringField(response.body ?? {}, "ResultCode");
        const description = stringField(response.body ?? {}, "ResultDesc");
        if (response.ok && code === "0") {
          return { status: "CONFIRMED", amountMinor: transaction.amountMinor, currency: transaction.currency, providerTransactionId: transaction.providerTransactionId, message: description || null };
        }
        if (response.ok && code && code !== "0") {
          return { status: "FAILED", amountMinor: null, currency: null, providerTransactionId: transaction.providerTransactionId, message: mpesaFailureMessage(code, description) };
        }
        // A query for a payment the customer has not answered yet reports "pending", not "failed".
        return { status: "PENDING", amountMinor: null, currency: null, providerTransactionId: transaction.providerTransactionId, message: description || null };
      } catch {
        return { status: "UNKNOWN", amountMinor: null, currency: null, providerTransactionId: transaction.providerTransactionId, message: null };
      }
    },

    /**
     * §35: a callback is only accepted when it carries the token JATA registered with Safaricom
     * (or arrives from an allowed provider address when an allowlist is configured). The token is
     * compared in constant time and never echoed back.
     */
    verifyEvent: async (request: ProviderEventRequest, ctx: AdapterContext): Promise<EventVerification> => {
      const config = readMpesaConfig();
      const path = request.url.pathname;
      const isStk = path.endsWith("/stk");
      const isValidation = path.endsWith("/validation");

      const body = request.payload;
      const stkCallback = (body.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;
      const checkoutId = stkCallback ? stringField(stkCallback, "CheckoutRequestID") : "";
      const resultCode = stkCallback ? stringField(stkCallback, "ResultCode") : "";
      const transId = stringField(body, "TransID");
      const conversationId = stringField(body, "ConversationID") || stringField(body, "OriginatorConversationID");

      const eventId = isStk
        ? `stk:${checkoutId}:${resultCode}`
        : isValidation
          ? `c2b-validation:${transId || conversationId}`
          : transId
            ? `c2b:${transId}`
            : conversationId
              ? `result:${conversationId}:${stringField(body, "ResultCode")}`
              : "";

      if (!eventId || eventId.length > 200) {
        return { ok: false, code: "INVALID_EVENT", message: "Unrecognised provider payload.", eventId: null, eventType: null };
      }

      const presented = request.url.searchParams.get("token") ?? "";
      if (config.callbackToken) {
        if (!safeEqual(presented, config.callbackToken)) {
          return { ok: false, code: "CALLBACK_TOKEN_INVALID", message: "Callback token did not match.", eventId, eventType: isStk ? "STK_CALLBACK" : "C2B" };
        }
      } else if (config.ready || !readTestMode().explicit) {
        // Without a registered callback token JATA cannot tell a real Daraja callback from a
        // stranger's POST, so it refuses instead of trusting that whoever found the URL is
        // Safaricom. A deployment running deliberately in test mode (JATA_PAYMENTS_TEST_MODE=on)
        // may accept them; a production deployment never will (§35, §120).
        return { ok: false, code: "CALLBACK_TOKEN_NOT_CONFIGURED", message: "JATA has not registered a callback token for M-PESA.", eventId, eventType: isStk ? "STK_CALLBACK" : "C2B" };
      }

      if (config.allowedIps.length) {
        const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
        const clientIp = forwarded || request.headers.get("x-real-ip")?.trim() || "";
        if (!clientIp || !config.allowedIps.includes(clientIp)) {
          return { ok: false, code: "CALLBACK_IP_REJECTED", message: "Callback did not come from an allowed M-PESA address.", eventId, eventType: isStk ? "STK_CALLBACK" : "C2B" };
        }
      }

      return { ok: true, eventId, eventType: isStk ? "STK_CALLBACK" : isValidation ? "C2B_VALIDATION" : "C2B_CONFIRMATION" };
    },

    parseEvent: async (request: ProviderEventRequest, ctx: AdapterContext): Promise<ProviderEventOutcome> => {
      const body = request.payload;
      const path = request.url.pathname;
      const stkCallback = (body.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;

      // ── STK prompt result ────────────────────────────────────────────────────
      if (stkCallback) {
        const checkoutId = stringField(stkCallback, "CheckoutRequestID");
        const resultCode = stringField(stkCallback, "ResultCode");
        const resultDesc = stringField(stkCallback, "ResultDesc");
        const sanitized: Record<string, unknown> = { type: "STK_CALLBACK", checkoutRequestId: checkoutId, resultCode, resultDesc };
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
        const receipt = typeof valueOf("MpesaReceiptNumber") === "string" ? String(valueOf("MpesaReceiptNumber")).trim() : "";
        const phone = valueOf("PhoneNumber");
        if (amountMinor === null || amountMinor <= 0 || !receipt) {
          return {
            kind: "failure",
            providerReference: null,
            providerTransactionId: checkoutId || null,
            code: "MPESA_CONFIRMATION_INCOMPLETE",
            message: "M-PESA's confirmation did not include a verifiable amount.",
            sanitized,
          };
        }
        return {
          kind: "confirmation",
          providerReference: "", // correlated by CheckoutRequestID (§64)
          providerTransactionId: checkoutId || receipt,
          amountMinor,
          currency: "KES",
          destination: { kind: null, providerDestinationId: null, providerAccountRef: null },
          method: "MPESA_STK",
          customerName: null,
          customerPhoneMasked: maskPhone(phone),
          occurredAt: ctx.now,
          sanitized: { ...sanitized, receipt, amountMinor },
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

      // ── Asynchronous result (for example a reversal) ─────────────────────────
      const resultCode = stringField(body, "ResultCode");
      const conversationId = stringField(body, "ConversationID") || stringField(body, "OriginatorConversationID");
      if (conversationId && resultCode) {
        const success = resultCode === "0";
        return {
          kind: success ? "reversal" : "failure",
          ...(success
            ? {
                providerReference: "",
                providerTransactionId: conversationId,
                amountMinor: amountMinor ?? 0,
                reason: stringField(body, "ResultDesc") || "Provider reversal",
                sanitized: { type: "RESULT", resultCode, conversationId, resultDesc: stringField(body, "ResultDesc") },
              }
            : {
                providerReference: "",
                code: `MPESA_${resultCode}`,
                message: mpesaFailureMessage(resultCode, stringField(body, "ResultDesc")),
                sanitized: { type: "RESULT", resultCode, conversationId },
              }),
        } as ProviderEventOutcome;
      }

      return { kind: "ignored", reason: "UNSUPPORTED_PAYLOAD", sanitized: { type: "UNKNOWN" } };
    },

    refund: async (input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult> => {
      // M-PESA has no separate refund product: returning money is a reversal (§48).
      return createMpesaAdapter().reverse(input, ctx);
    },

    /** §48: a provider-issued reversal, requested through Daraja's reversal API. */
    reverse: async (input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult> => {
      const config = readMpesaConfig();
      if (!config.ready) {
        return {
          ok: false,
          code: "MPESA_NOT_CONNECTED",
          message: "M-PESA reversals are not available in this deployment yet. JATA has recorded the request for review.",
          retryable: false,
        };
      }
      const receipt = input.transaction.providerTransactionId ?? "";
      if (!receipt) {
        return { ok: false, code: "MISSING_PROVIDER_ID", message: "This payment has no M-PESA receipt to reverse.", retryable: false };
      }
      const amount = Math.max(1, Math.round(input.amountMinor / 100));
      const response = await darajaPost(config, ctx, "/mpesa/reversal/v1/request", {
        Initiator: process.env.MPESA_INITIATOR_NAME || "JATA",
        SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL || "",
        CommandID: "TransactionReversal",
        TransactionID: receipt,
        Amount: amount,
        ReceiverParty: config.shortcode,
        RecieverIdentifierType: "4",
        ResultURL: config.c2bConfirmationUrl.replace("/confirmation", "/result"),
        QueueTimeOutURL: config.c2bValidationUrl.replace("/validation", "/timeout"),
        Remarks: input.reason.slice(0, 100),
        Occasion: "JATA reversal",
      });
      const body = response.body ?? {};
      const errorCode = stringField(body, "errorCode");
      if (!response.ok || errorCode) {
        return {
          ok: false,
          code: errorCode || "MPESA_REVERSAL_FAILED",
          message: errorCode ? `M-PESA refused the reversal: ${stringField(body, "errorMessage")}` : "M-PESA could not be reached for this reversal.",
          retryable: true,
        };
      }
      return { ok: true, providerReference: stringField(body, "OriginatorConversationID") || null, message: "M-PESA accepted the reversal; it will confirm shortly." };
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
