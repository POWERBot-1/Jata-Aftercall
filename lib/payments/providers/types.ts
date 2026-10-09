/**
 * The provider abstraction (§7, §8, §91).
 *
 * Every provider JATA supports implements this one interface. The POS, the orchestrator, the
 * webhook pipeline, reconciliation and the wallet screens all speak to *this*, never to a
 * provider SDK, URL or payload shape. That is what makes "the merchant does not integrate with
 * the payment provider" true in code and not only in the product story (§1, §55, §91).
 */

import type {
  CustomerInstructions,
  DestinationHint,
  DestinationKind,
  DestinationStatus,
  DestinationRecord,
  InitiationOutcome,
  ProviderCapability,
  ProviderEventOutcome,
  ProviderKey,
  ProviderStatusReport,
  TransactionRecord,
  VerificationLevel,
} from "../types";
import type { DestinationDraft, IdentificationResult, DestinationInput } from "../destinations";

/** Everything an adapter may need that is not the payload itself. */
export type AdapterContext = {
  now: Date;
  /** Injected in tests; production passes `fetch`. */
  fetchImpl: typeof fetch;
  /** JATA's public base URL — callbacks always point at JATA, never at a merchant (§14). */
  baseUrl: string;
  /** Server-side verification of the payment after a provider event (§30, §90). */
  verifyWithProvider: boolean;
};

export type DestinationVerification = {
  level: VerificationLevel;
  status: DestinationStatus;
  capabilities: ProviderCapability[];
  /** Plain language for the merchant (§53, §86). */
  detail: string;
  /** Canonical provider-side identity when the provider confirmed it. */
  providerDestinationId?: string | null;
  /** Set when the provider requires a merchant action (§3, §18, §53). */
  actionRequired?: { label: string; kind: "AUTHORIZE" | "CONFIRM" | "SUPPORT" } | null;
};

export type InitiationInput = {
  jataPaymentId: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
  destination: DestinationRecord;
  customer: { name?: string | null; phone?: string | null; emailHint?: string | null };
  description?: string | null;
  /** Per-tenant authorization JATA holds (Paystack authorization, shortcode registration…). */
  connection: { providerConnectionId: string | null } | null;
};

export type ReversalInput = {
  transaction: TransactionRecord;
  destination: DestinationRecord | null;
  amountMinor: number;
  reason: string;
};

export type ProviderReversalResult =
  | { ok: true; providerReference: string | null; message: string }
  | { ok: false; code: string; message: string; retryable: boolean; outcomeUnknown?: boolean };

/** What an adapter needs to say whether a refund may be attempted at all, before any money is reserved. */
export type RefundValidationInput = {
  transaction: TransactionRecord;
  destination: DestinationRecord | null;
  amountMinor: number;
  /** Completed refunds so far. */
  alreadyRefundedMinor: number;
  /** Refunds reserved or awaiting the provider. */
  outstandingMinor: number;
};

export type RefundValidation = { ok: boolean; code?: string; message?: string };

export type ProviderEventRequest = {
  rawBody: string;
  headers: Headers;
  payload: Record<string, unknown>;
  url: URL;
};

export type EventVerification =
  | { ok: true; eventId: string; eventType: string }
  | { ok: false; code: string; message: string; eventId: string | null; eventType: string | null };

/** Reduces a payload to what may be stored and audited — no PINs, no secrets, no raw identities. */
export type SanitizedPayload = Record<string, unknown>;

export interface PaymentProviderAdapter {
  readonly key: ProviderKey;
  readonly displayName: string;
  readonly supportedKinds: DestinationKind[];

  /** The provider's ceiling — what it can do when JATA's connector is fully configured. */
  declaredCapabilities(): ProviderCapability[];

  /** Is JATA's central connector for this provider configured *and* usable in this deployment? */
  connectorReady(): boolean;

  /** Human-facing state of JATA's connector for internal administration (§73). */
  connectorNote(): string;

  identifyDestination(input: DestinationInput): IdentificationResult;
  validateDestination(input: DestinationInput): IdentificationResult;

  /**
   * The strongest verification the provider legitimately supports (§13, §52). Never invents an
   * ownership lookup the provider does not expose.
   */
  verifyDestination(draft: DestinationDraft, ctx: AdapterContext): Promise<DestinationVerification>;

  getCapabilities(destination?: Pick<DestinationRecord, "kind"> | null): ProviderCapability[];

  getDisplayInstructions(input: {
    destination: DestinationRecord;
    amountMinor: number;
    currency: string;
    providerReference?: string | null;
  }): CustomerInstructions;

  createPaymentRequest(input: InitiationInput, ctx: AdapterContext): Promise<InitiationOutcome>;

  getPaymentStatus(
    transaction: TransactionRecord,
    destination: DestinationRecord | null,
    ctx: AdapterContext,
  ): Promise<ProviderStatusReport>;

  /** Authenticate a provider callback: signature, token, IP allowlist — never "it looks right" (§35). */
  verifyEvent(request: ProviderEventRequest, ctx: AdapterContext): Promise<EventVerification>;

  /** Normalize a verified callback into the domain's vocabulary (§24, §34). */
  parseEvent(request: ProviderEventRequest, ctx: AdapterContext): Promise<ProviderEventOutcome>;

  /** Refund through the provider (§47) — where the provider offers refunds at all. */
  refund(input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult>;
  /**
   * Optional pre-flight for a refund: a provider whose reversal product has limits (full amount
   * only, a receipt required, an initiator that must be configured) says so *before* an amount is
   * reserved, so an impossible refund never creates a reservation or a provider call.
   */
  validateRefund?(input: RefundValidationInput): RefundValidation;

  /** Reverse a payment the provider can reverse (§48). */
  reverse(input: ReversalInput, ctx: AdapterContext): Promise<ProviderReversalResult>;

  /** §7 `reconcile` — the provider's own view of a transaction, for the reconciliation job. */
  reconcile(
    transaction: TransactionRecord,
    destination: DestinationRecord | null,
    ctx: AdapterContext,
  ): Promise<ProviderStatusReport>;

  /** §7 `connectDestination` / `disconnectDestination`: what JATA does provider-side. */
  connectDestination(draft: DestinationDraft, ctx: AdapterContext): Promise<DestinationVerification>;

  disconnectDestination(destination: DestinationRecord, ctx: AdapterContext): Promise<{ ok: boolean; detail: string }>;

  /** Which destination a payload appears to be for, used when no reference matches (§42, §44). */
  destinationHintFromEvent(outcome: ProviderEventOutcome): DestinationHint;
}

export type { DestinationDraft, IdentificationResult, DestinationInput };
