/**
 * Bank accounts (§16, §17, §87) — honest by construction.
 *
 * A bank account is a payment destination, not automatically a live connection. Unless JATA has
 * an authorized bank/aggregator connector configured for the deployment *and* that connector can
 * confirm the merchant's account in real time, this adapter advertises exactly one capability:
 * manual payment instructions with automatic confirmation off.
 *
 * JATA never asks a merchant for a bank PIN, a password or any credential (§17), and never claims
 * a bank account is live-connected because the account number was typed correctly (§16, §120).
 */

import { maskDestination } from "../money";
import { identifyDestination, type DestinationDraft, type DestinationInput, type IdentificationResult } from "../destinations";
import { readBankConnectorConfig } from "../config";
import type { CustomerInstructions, DestinationHint, ProviderCapability, ProviderEventOutcome, ProviderStatusReport } from "../types";
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

export function createBankAdapter(): PaymentProviderAdapter {
  return {
    key: "BANK",
    displayName: "Bank",
    supportedKinds: ["BANK_ACCOUNT"],

    // A bank connector, when one is provisioned, would still be outbound: confirmations arrive
    // through that connector, never through a bank pushing an event to JATA.
    declaredCapabilities: () => ["PAYMENT_INSTRUCTIONS", "BANK_TRANSFER"],

    connectorReady: () => readBankConnectorConfig().ready,

    connectorNote: () => {
      const config = readBankConnectorConfig();
      return config.ready
        ? "An authorized bank connector is configured for this deployment."
        : "No authorized bank connector is configured, so bank destinations are instructions-only.";
    },

    identifyDestination: (input: DestinationInput): IdentificationResult => identifyDestination(input),
    validateDestination: (input: DestinationInput): IdentificationResult => identifyDestination(input),

    verifyDestination: async (draft: DestinationDraft, _ctx: AdapterContext): Promise<DestinationVerification> => {
      const config = readBankConnectorConfig();
      if (!config.ready) {
        return {
          level: "FORMAT",
          status: "UNAVAILABLE",
          capabilities: ["PAYMENT_INSTRUCTIONS"],
          detail:
            "Payment destination saved. Automatic confirmation is not currently available for this bank account.",
          actionRequired: null,
        };
      }
      // A connector exists, but confirming a *merchant's* account in real time is a second,
      // provider-specific authorization. Until that is completed the honest answer is unchanged.
      return {
        level: "FORMAT",
        status: "ACTION_REQUIRED",
        capabilities: ["PAYMENT_INSTRUCTIONS"],
        detail:
          "JATA's bank connector is available, but this account is not authorized for automatic confirmation yet.",
        actionRequired: { label: "JATA will contact you to authorize this account", kind: "AUTHORIZE" },
      };
    },

    getCapabilities: () => ["PAYMENT_INSTRUCTIONS"],

    getDisplayInstructions: ({ destination, amountMinor, currency }): CustomerInstructions => ({
      mode: "BANK_TRANSFER",
      headline: `PAY ${currency} ${(amountMinor / 100).toLocaleString("en-KE")}`,
      body: `${destination.bankName ?? "Bank"} — ${destination.accountName ?? ""}`.trim(),
      steps: [
        `Bank: ${destination.bankName ?? "—"}`,
        `Account: ${maskDestination(destination.providerDestinationId)}`,
        "Reference: JATA will add the order reference.",
        "A cashier confirms the payment when it appears in the bank account.",
      ],
      automaticConfirmation: false,
    }),

    createPaymentRequest: async (input: InitiationInput, _ctx: AdapterContext) => ({
      kind: "manual" as const,
      method: "BANK_TRANSFER_MANUAL",
      instructions: createBankAdapter().getDisplayInstructions({
        destination: input.destination,
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerReference: input.providerReference,
      }),
    }),

    getPaymentStatus: async (): Promise<ProviderStatusReport> => ({
      status: "UNKNOWN",
      amountMinor: null,
      currency: null,
      providerTransactionId: null,
      // A bank account JATA is not authorized to read cannot be checked, and JATA says exactly that
      // instead of implying it looked (§16, §120).
      message: "JATA cannot read this bank account, so the payment has to be confirmed from the bank's own record.",
    }),

    /** Nothing arrives at JATA from a bank today: any event claiming to be one is refused (§120). */
    verifyEvent: async (request: ProviderEventRequest, _ctx: AdapterContext): Promise<EventVerification> => ({
      ok: false,
      code: "BANK_EVENTS_UNSUPPORTED",
      message: "JATA does not accept unauthenticated bank events.",
      eventId: null,
      eventType: typeof request.payload?.type === "string" ? request.payload.type : null,
    }),

    parseEvent: async (): Promise<ProviderEventOutcome> => ({ kind: "ignored", reason: "BANK_EVENTS_UNSUPPORTED", sanitized: { type: "BANK" } }),

    refund: async (_input: ReversalInput, _ctx: AdapterContext): Promise<ProviderReversalResult> => ({
      ok: false,
      code: "BANK_REFUNDS_MANUAL",
      message: "Refunds for a bank transfer are made at your bank. JATA has recorded the request so your books stay correct.",
      retryable: false,
    }),

    reverse: async (_input: ReversalInput, _ctx: AdapterContext): Promise<ProviderReversalResult> => ({
      ok: false,
      code: "BANK_REVERSALS_MANUAL",
      message: "Your bank reverses a bank transfer, not JATA. The request has been recorded.",
      retryable: false,
    }),

    reconcile: async (): Promise<ProviderStatusReport> => ({ status: "UNKNOWN", amountMinor: null, currency: null, providerTransactionId: null, message: null }),

    connectDestination: async (draft, ctx) => createBankAdapter().verifyDestination(draft, ctx),

    disconnectDestination: async () => ({
      ok: true,
      detail: "This bank account will no longer be shown to customers. Existing records are unchanged.",
    }),

    destinationHintFromEvent: (_outcome: ProviderEventOutcome): DestinationHint => ({ kind: "BANK_ACCOUNT", providerDestinationId: null, providerAccountRef: null }),
  };
}
