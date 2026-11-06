/**
 * AI Front Desk Voice — shared types for the call pipeline.
 * Everything here is provider-agnostic: the Telnyx adapter maps into these shapes so the
 * application never depends on provider payload details outside `lib/telnyx`.
 */

export type VoiceLanguage = "en" | "sw";

export const VOICE_LANGUAGES: readonly VoiceLanguage[] = ["en", "sw"] as const;

export function isVoiceLanguage(value: string): value is VoiceLanguage {
  return value === "en" || value === "sw";
}

/** Monotonic call lifecycle. Higher rank never regresses. */
export const CALL_STATE_RANK = {
  INITIATED: 0,
  RINGING: 1,
  ANSWERED: 2,
  IN_CALL: 3,
  HANDING_OFF: 4,
  COMPLETED: 5,
  FAILED: 5,
} as const;

export type CallState = keyof typeof CALL_STATE_RANK;

export const CALL_TERMINAL_STATES: readonly CallState[] = ["COMPLETED", "FAILED"];

export function isCallState(value: string): value is CallState {
  return Object.prototype.hasOwnProperty.call(CALL_STATE_RANK, value);
}

export type CallEventStatus = "RECEIVED" | "PROCESSED" | "REJECTED" | "RETRY";

export type CallRejectReason = "UNKNOWN_NUMBER" | "CROSS_TENANT" | "UNROUTABLE" | "UNPARSEABLE";

export type CallCommandStatus = "PENDING" | "SENT" | "SUCCEEDED" | "FAILED";

export type UsageStatus = "OPEN" | "FINALIZED" | "RECONCILED" | "DISPUTED";

export type VoiceCallRow = {
  id: string;
  callControlId: string;
  callSessionId: string | null;
  businessId: string;
  direction: string;
  callerNumber: string;
  calledNumber: string;
  language: string;
  state: string;
  answeredAt: Date | null;
  endedAt: Date | null;
  hangupCause: string | null;
  failoverReason: string | null;
  handoffTarget: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VoiceCallEventRow = {
  id: string;
  providerEventId: string;
  eventType: string;
  callControlId: string | null;
  callSessionId: string | null;
  calledNumber: string | null;
  callingNumber: string | null;
  businessId: string | null;
  status: string;
  rejectReason: string | null;
  sequence: number | null;
  attempts: number;
  payload: string;
  receivedAt: Date;
  processedAt: Date | null;
  lastError: string | null;
};

export type VoiceCallCommandRow = {
  id: string;
  callControlId: string;
  command: string;
  dedupeKey: string;
  status: string;
  attempts: number;
  requestPayload: string | null;
  responsePayload: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A parsed, provider-neutral inbound webhook event. */
export type ParsedVoiceEvent = {
  providerEventId: string;
  eventType: string;
  callControlId: string | null;
  callSessionId: string | null;
  calledNumber: string | null;
  callingNumber: string | null;
  sequence: number | null;
  payload: string;
};

/**
 * Kenyan number canonicalisation for DID routing. Accepts local (07…), national
 * (254…) and E.164 (+254…) forms and returns `+254…`. Non-Kenyan numbers are
 * returned as `+<digits>` when unambiguous, otherwise null.
 */
export function normalizeKenyaE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return null;
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  if (national.startsWith("254") && national.length === 12) return `+${national}`;
  if (national.length === 9 && (national.startsWith("7") || national.startsWith("1"))) {
    return `+254${national}`;
  }
  if (digits.startsWith("+") || national.length >= 10) return `+${national}`;
  return null;
}
