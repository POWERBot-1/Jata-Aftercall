// Future InteractionEvent abstraction (§21, §48) — V1 records as AnalyticsEvent
// but exposes typed interface for V2 (CALL_COMPLETED, CALL_MISSED, etc.)

export type InteractionEventType =
  | "CALL_COMPLETED"
  | "CALL_MISSED"
  | "WHATSAPP_CLICK"
  | "QR_SCAN"
  | "SOCIAL_CLICK"
  | "DIRECT_VISIT";

export type InteractionEvent = {
  businessId: string;
  eventType: InteractionEventType;
  timestamp: string; // ISO
  source: string; // e.g. "telco:providerA", "qr", "whatsapp", "social:instagram"
  destinationPage: string; // e.g. "/b/marys-beauty"
  metadata?: Record<string, unknown>;
};

// V1: no telephony integration — stub that validates shape but does not emit fake events
export function validateInteractionEvent(ev: InteractionEvent): boolean {
  return !!ev.businessId && !!ev.eventType && !!ev.timestamp;
}
