/**
 * The payment domain's vocabulary (§6, §7, §8).
 *
 * Everything the POS, the orchestrator, the provider adapters and the merchant screens agree on
 * lives here: providers, destination kinds, capabilities, verification levels and the plain-data
 * shapes that cross the server/client boundary. No provider-specific detail leaks past this
 * module — the POS never learns what an STK push is (§6, §110).
 */

import type { PaymentStatus } from "./states";

// ── Providers (§8) ────────────────────────────────────────────────────────────

export const PAYMENT_PROVIDERS = ["MPESA", "PAYSTACK", "BANK", "AIRTEL_MONEY"] as const;
export type ProviderKey = (typeof PAYMENT_PROVIDERS)[number];

export function isProviderKey(value: unknown): value is ProviderKey {
  return typeof value === "string" && (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  MPESA: "M-PESA",
  PAYSTACK: "Paystack",
  BANK: "Bank",
  AIRTEL_MONEY: "Airtel Money",
};

// ── Destinations (§9, §10) ────────────────────────────────────────────────────

export const DESTINATION_KINDS = ["MPESA_TILL", "MPESA_PAYBILL", "MPESA_POCHI", "BANK_ACCOUNT", "PAYSTACK"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export function isDestinationKind(value: unknown): value is DestinationKind {
  return typeof value === "string" && (DESTINATION_KINDS as readonly string[]).includes(value);
}

export const DESTINATION_PROVIDER: Record<DestinationKind, ProviderKey> = {
  MPESA_TILL: "MPESA",
  MPESA_PAYBILL: "MPESA",
  MPESA_POCHI: "MPESA",
  BANK_ACCOUNT: "BANK",
  PAYSTACK: "PAYSTACK",
};

export const DESTINATION_TITLES: Record<DestinationKind, string> = {
  MPESA_TILL: "M-PESA Till",
  MPESA_PAYBILL: "M-PESA PayBill",
  MPESA_POCHI: "M-PESA Pochi la Biashara",
  BANK_ACCOUNT: "Bank account",
  PAYSTACK: "Paystack online",
};

/** What the merchant is asked for on the till — and nothing else (§10, §14). */
export type DestinationFieldSpec = {
  key: "providerDestinationId" | "providerAccountRef" | "bankName" | "accountName";
  label: string;
  placeholder: string;
  required: boolean;
  kind: "digits" | "text";
};

export const DESTINATION_FIELDS: Record<DestinationKind, DestinationFieldSpec[]> = {
  MPESA_TILL: [
    { key: "providerDestinationId", label: "Till number", placeholder: "1234567", required: true, kind: "digits" },
  ],
  MPESA_PAYBILL: [
    { key: "providerDestinationId", label: "PayBill number", placeholder: "400000", required: true, kind: "digits" },
    { key: "providerAccountRef", label: "Business/payment reference", placeholder: "e.g. order number or JATA reference", required: true, kind: "text" },
  ],
  MPESA_POCHI: [
    { key: "providerDestinationId", label: "Pochi number", placeholder: "0712345678", required: true, kind: "digits" },
  ],
  BANK_ACCOUNT: [
    { key: "bankName", label: "Bank", placeholder: "e.g. Equity", required: true, kind: "text" },
    { key: "accountName", label: "Account name", placeholder: "Business name on the account", required: true, kind: "text" },
    { key: "providerDestinationId", label: "Account number", placeholder: "1234567890", required: true, kind: "digits" },
  ],
  PAYSTACK: [
    { key: "providerDestinationId", label: "Business reference", placeholder: "e.g. your Paystack business name", required: true, kind: "text" },
  ],
};

// ── Capabilities (§8, §88) ────────────────────────────────────────────────────

export const PROVIDER_CAPABILITIES = [
  "PAYMENT_INITIATION",
  "REAL_TIME_CONFIRMATION",
  "WEBHOOKS",
  "STATUS_QUERY",
  "REFUNDS",
  "REVERSALS",
  "QR",
  "MOBILE_MONEY",
  "BANK_TRANSFER",
  "PAYMENT_INSTRUCTIONS",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<ProviderCapability, string> = {
  PAYMENT_INITIATION: "Request payment from the customer",
  REAL_TIME_CONFIRMATION: "Real-time payment confirmation",
  WEBHOOKS: "Automatic provider confirmation",
  STATUS_QUERY: "Payment status check",
  REFUNDS: "Refunds",
  REVERSALS: "Reversals",
  QR: "Pay by QR",
  MOBILE_MONEY: "Mobile money",
  BANK_TRANSFER: "Bank transfer",
  PAYMENT_INSTRUCTIONS: "Payment instructions",
};

/** The four claims shown on the wallet screen (§88). */
export const CAPABILITY_CLAIMS: { key: ProviderCapability[]; label: string }[] = [
  { key: ["PAYMENT_INITIATION"], label: "Payment initiation" },
  { key: ["REAL_TIME_CONFIRMATION", "WEBHOOKS"], label: "Real-time confirmation" },
  { key: ["PAYMENT_INSTRUCTIONS"], label: "Automatic receipts" },
];

export function hasCapability(capabilities: readonly string[] | null | undefined, capability: ProviderCapability): boolean {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

/** Automatic confirmation needs both the provider's event path *and* a status query (§88). */
export function supportsAutomaticConfirmation(capabilities: readonly string[] | null | undefined): boolean {
  return hasCapability(capabilities, "REAL_TIME_CONFIRMATION") && hasCapability(capabilities, "WEBHOOKS");
}

// ── Verification (§52, §53) ───────────────────────────────────────────────────

export const DESTINATION_STATUSES = [
  "UNVERIFIED",
  "FORMAT_VERIFIED",
  "PROVIDER_VERIFIED",
  "CONNECTED",
  "ACTION_REQUIRED",
  "UNAVAILABLE",
  "DISCONNECTED",
] as const;

export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

/** How strong the verification behind a status actually is (§52). */
export type VerificationLevel = "NONE" | "FORMAT" | "PROVIDER" | "LIVE";

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  NONE: "Not verified",
  FORMAT: "Format checked",
  PROVIDER: "Checked with the provider",
  LIVE: "Live connection confirmed",
};

export type DestinationStatusView = {
  key: DestinationStatus;
  label: string;
  tone: "success" | "warn" | "danger" | "neutral";
  /** Plain language for the merchant (§53). */
  detail: string;
};

export function destinationStatusView(status: DestinationStatus, detail?: string | null): DestinationStatusView {
  switch (status) {
    case "CONNECTED":
      return { key: status, label: "READY", tone: "success", detail: detail ?? "Payments are confirmed automatically." };
    case "PROVIDER_VERIFIED":
    case "FORMAT_VERIFIED":
    case "UNVERIFIED":
      return { key: status, label: "ACTION REQUIRED", tone: "warn", detail: detail ?? "JATA is finishing the connection for this destination." };
    case "ACTION_REQUIRED":
      return { key: status, label: "ACTION REQUIRED", tone: "warn", detail: detail ?? "JATA needs authorization to activate this destination." };
    case "UNAVAILABLE":
      return { key: status, label: "NOT AVAILABLE", tone: "danger", detail: detail ?? "Live confirmation is not supported for this destination yet." };
    case "DISCONNECTED":
      return { key: status, label: "DISCONNECTED", tone: "neutral", detail: detail ?? "New payments no longer use this destination." };
    default:
      return { key: "UNVERIFIED", label: "ACTION REQUIRED", tone: "warn", detail: detail ?? "This destination is not connected yet." };
  }
}

// ── Records (the rows the adapters and screens work with) ─────────────────────

export type DestinationRecord = {
  id: string;
  businessId: string;
  kind: DestinationKind;
  provider: ProviderKey;
  label: string | null;
  providerDestinationId: string;
  providerAccountRef: string;
  bankName: string | null;
  accountName: string | null;
  currency: string;
  capabilities: string[];
  status: DestinationStatus;
  verificationSource: string | null;
  isPrimary: boolean;
  isActive: boolean;
  verifiedAt?: Date | string | null;
  connectedAt?: Date | string | null;
  lastEventAt?: Date | string | null;
};

export type TransactionRecord = {
  id: string;
  jataPaymentId: string;
  businessId: string;
  destinationId: string | null;
  provider: ProviderKey;
  status: PaymentStatus;
  providerReference: string | null;
  providerTransactionId: string | null;
  providerReceipt?: string | null;
  method: string | null;
  amountMinor: number;
  amountPaidMinor: number;
  amountRefundedMinor: number;
  currency: string;
  customerName: string | null;
  customerPhoneMasked: string | null;
  posSaleId: string | null;
  orderId: string | null;
  receiptNumber: string | null;
  receiptToken: string | null;
  failureCode: string | null;
  failureReason: string | null;
  expiresAt?: Date | string | null;
  createdAt: Date | string;
  requestedAt?: Date | string | null;
  providerAcceptedAt?: Date | string | null;
  providerConfirmedAt?: Date | string | null;
  jataVerifiedAt?: Date | string | null;
  paidAt?: Date | string | null;
  reconciledAt?: Date | string | null;
};

// ── What the customer is shown (§22, §84, §85, §87) ───────────────────────────

export type InstructionMode =
  | "PROMPT_ON_PHONE"
  | "PAYBILL"
  | "TILL"
  | "POCHI"
  | "QR"
  | "CHECKOUT_LINK"
  | "BANK_TRANSFER"
  | "MANUAL";

export type CustomerInstructions = {
  mode: InstructionMode;
  headline: string;
  body: string;
  steps: string[];
  /** True when JATA will receive the authoritative confirmation for this destination. */
  automaticConfirmation: boolean;
  /** Present when the customer must be sent somewhere secure — never a place to type a PIN. */
  redirectUrl?: string | null;
};

export type InitiationOutcome =
  | {
      kind: "initiated";
      method: string;
      providerReference: string;
      providerTransactionId: string | null;
      instructions: CustomerInstructions;
    }
  | {
      kind: "manual";
      method: string;
      instructions: CustomerInstructions;
    }
  | {
      kind: "unsupported";
      code: string;
      message: string;
    }
  | {
      kind: "failed";
      code: string;
      message: string;
      retryable: boolean;
    };

export type ProviderStatusReport = {
  status: "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";
  amountMinor: number | null;
  currency: string | null;
  providerTransactionId: string | null;
  message: string | null;
  /**
   * False when the provider's answer does not itself carry the paid amount (Daraja's STK Query
   * reports only a result code). The caller then books the amount that was *requested* — which an
   * STK prompt charges exactly — and records that the figure was not independently reported.
   */
  amountVerified?: boolean;
  /** A provider receipt, when the status answer carries one (Daraja's STK Query does not). */
  providerReceipt?: string | null;
};

/** Where a provider event says the money went (used to identify the tenant, §13, §56). */
export type DestinationHint = {
  kind: DestinationKind | null;
  providerDestinationId: string | null;
  providerAccountRef: string | null;
};

export type ProviderEventOutcome =
  | {
      kind: "confirmation";
      providerReference: string;
      providerTransactionId: string | null;
      /** Actual M-PESA receipt; distinct from the STK CheckoutRequestID correlation handle. */
      providerReceipt?: string | null;
      /**
       * True only for a confirmation obtained by asking the provider (a status query) rather than
       * from an authenticated callback: such an answer carries no receipt, so its absence is
       * expected and does not block settlement. A callback without a receipt still does.
       */
      receiptOptional?: boolean;
      amountMinor: number;
      currency: string;
      destination: DestinationHint;
      method: string;
      customerName: string | null;
      customerPhoneMasked: string | null;
      occurredAt: Date | null;
      sanitized: Record<string, unknown>;
    }
  | {
      kind: "reversal";
      providerReference: string;
      providerTransactionId: string | null;
      /** The receipt of the payment that was reversed, when the result names it. */
      originalTransactionId?: string | null;
      amountMinor: number;
      reason: string | null;
      sanitized: Record<string, unknown>;
    }
  | {
      kind: "failure";
      providerReference: string | null;
      /** The provider's handle for the attempt, when the event carries one (§64). */
      providerTransactionId: string | null;
      /** The receipt of the payment a failed reversal referred to, when the result names it. */
      originalTransactionId?: string | null;
      code: string;
      message: string;
      sanitized: Record<string, unknown>;
    }
  | {
      /**
       * The provider's queue gave up on a request before processing it. This is NOT a verdict: the
       * operation may still complete later, so it must never be treated as a failure or released
       * for a retry (M-PESA reversal QueueTimeOutURL).
       */
      kind: "reversal_timeout";
      providerReference: string | null;
      providerTransactionId: string | null;
      originalTransactionId?: string | null;
      sanitized: Record<string, unknown>;
    }
  | { kind: "ignored"; reason: string; sanitized: Record<string, unknown> };
