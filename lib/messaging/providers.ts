/**
 * Provider adapters
 *
 * One interface, several adapters. The sandbox and mock adapters make the whole pipeline testable
 * without a live account or a shilling of spend. A live adapter exists only when its credentials
 * are configured server-side; when they are not, sending fails closed with a plain explanation
 * rather than pretending a message went out.
 *
 * Callbacks are verified with an HMAC over the raw body and deduplicated by a stable event key.
 * A missing webhook secret means "reject", never "trust".
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type MessagingChannel = "SMS" | "WHATSAPP" | "EMAIL";

export type SendRequest = {
  to: string;
  body: string;
  senderId: string;
  idempotencyKey: string;
  campaignId?: string;
  channel: MessagingChannel;
  metadata?: Record<string, string>;
  /** WhatsApp authentication templates are passed only to explicitly capable adapters. Values may
   * contain OTPs: adapters MUST NOT persist or log parameters or raw requests. */
  authenticationTemplate?: { name: string; language: string; code: string };
};

export type SendOutcome = "ACCEPTED" | "SENT" | "FAILED" | "UNKNOWN";

export type SendResult = {
  outcome: SendOutcome;
  providerMessageId?: string | null;
  code?: string | null;
  message?: string | null;
  retryable?: boolean;
  /** True only for a provider-confirmed rejection that definitely created no message. */
  safeToFallback?: boolean;
};

export type ProviderDeliveryStatus = {
  status: "DELIVERED" | "FAILED" | "PENDING" | "UNKNOWN";
  detail?: string | null;
};

export type ProviderHealth = {
  ok: boolean;
  state: "HEALTHY" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED";
  checkedAt: Date;
  message: string;
};

export type ParsedProviderEvent = {
  providerMessageId: string | null;
  eventType: "ACCEPTED" | "SENT" | "DELIVERED" | "FAILED" | "READ" | "UNKNOWN";
  eventId: string;
  occurredAt?: Date | null;
  reason?: string | null;
  raw: Record<string, unknown>;
};

export type MessagingProviderAdapter = {
  key: string;
  channel: MessagingChannel;
  /** False for mock/sandbox adapters and for a live adapter without credentials. */
  live: boolean;
  configured: boolean;
  /** Explicit opt-in by an approved adapter that enforces WhatsApp authentication templates. */
  supportsWhatsAppAuthenticationTemplates?: boolean;
  send(request: SendRequest): Promise<SendResult>;
  status(providerMessageId: string): Promise<ProviderDeliveryStatus>;
  health(): Promise<ProviderHealth>;
  verifyCallback(rawBody: string, headers: Record<string, string | undefined>): { ok: boolean; reason: string };
  parseCallbacks(rawBody: string, headers: Record<string, string | undefined>): ParsedProviderEvent[];
};

/** Deterministic sandbox behaviour, controlled by the test or preview. No network calls. */
export type MockBehaviour = {
  /** Default outcome for a send. */
  outcome?: SendOutcome;
  /** Fail the first N sends, e.g. to exercise retries. */
  failFirst?: number;
  /** Return UNKNOWN for the first N sends, e.g. to exercise reconciliation. */
  unknownFirst?: number;
  statusLookup?: Record<string, ProviderDeliveryStatus>;
  health?: ProviderHealth;
};

export class MockMessagingProvider implements MessagingProviderAdapter {
  key = "mock";
  channel: MessagingChannel = "SMS";
  live = false;
  configured = true;
  sent: SendRequest[] = [];
  private behaviour: MockBehaviour;
  private sends = 0;

  constructor(behaviour: MockBehaviour = {}) {
    this.behaviour = behaviour;
  }

  configure(behaviour: MockBehaviour) {
    this.behaviour = behaviour;
    this.sends = 0;
  }

  async send(request: SendRequest): Promise<SendResult> {
    this.sent.push(request);
    this.sends += 1;
    this.channel = request.channel;
    if (this.behaviour.failFirst && this.sends <= this.behaviour.failFirst) {
      return { outcome: "FAILED", code: "PROVIDER_TEMPORARY", message: "Provider unavailable (sandbox)", retryable: true };
    }
    if (this.behaviour.unknownFirst && this.sends <= this.behaviour.unknownFirst) {
      return { outcome: "UNKNOWN", code: "TIMEOUT", message: "Provider did not answer in time (sandbox)" };
    }
    const outcome = this.behaviour.outcome ?? "ACCEPTED";
    return {
      outcome,
      providerMessageId: `mock_${request.idempotencyKey}_${this.sends}`,
      code: outcome === "FAILED" ? "PROVIDER_REJECTED" : null,
      message: outcome === "FAILED" ? "Rejected in sandbox" : "Accepted by sandbox provider",
      retryable: false,
    };
  }

  async status(providerMessageId: string): Promise<ProviderDeliveryStatus> {
    return this.behaviour.statusLookup?.[providerMessageId] ?? { status: "UNKNOWN", detail: "Sandbox has no record of that message." };
  }

  async health(): Promise<ProviderHealth> {
    return this.behaviour.health ?? { ok: true, state: "HEALTHY", checkedAt: new Date(), message: "Sandbox provider is available. No messages leave this environment." };
  }

  verifyCallback(rawBody: string, headers: Record<string, string | undefined>) {
    return verifyHmacSignature(rawBody, headers, process.env.MESSAGING_WEBHOOK_SECRET);
  }

  parseCallbacks(rawBody: string): ParsedProviderEvent[] {
    return parseGenericCallbacks(rawBody);
  }
}

/**
 * A live adapter that fails closed until a real provider integration is configured. It deliberately
 * does not contain invented endpoints or credentials.
 */
export class UnconfiguredLiveProvider implements MessagingProviderAdapter {
  key = "live-unconfigured";
  live = true;
  configured = false;
  channel: MessagingChannel;
  constructor(channel: MessagingChannel) {
    this.channel = channel;
  }
  async send(): Promise<SendResult> {
    return {
      outcome: "FAILED",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "No approved messaging provider is connected yet, so nothing was sent.",
      retryable: false,
    };
  }
  async status(): Promise<ProviderDeliveryStatus> {
    return { status: "UNKNOWN", detail: "No provider connection." };
  }
  async health(): Promise<ProviderHealth> {
    return { ok: false, state: "NOT_CONFIGURED", checkedAt: new Date(), message: "Connect an approved SMS or WhatsApp provider in Integrations to send live messages." };
  }
  verifyCallback(): { ok: boolean; reason: string } {
    return { ok: false, reason: "No provider is connected, so callbacks cannot be verified." };
  }
  parseCallbacks(): ParsedProviderEvent[] {
    return [];
  }
}

const registry = new Map<string, MessagingProviderAdapter>();

export function registerProvider(adapter: MessagingProviderAdapter): void {
  registry.set(adapter.key, adapter);
}

export function getMessagingProvider(key = "mock"): MessagingProviderAdapter {
  const found = registry.get(key);
  if (found) return found;
  if (key === "mock" || key === "sandbox") {
    const mock = new MockMessagingProvider();
    mock.key = key;
    registry.set(key, mock);
    return mock;
  }
  return new UnconfiguredLiveProvider("SMS");
}

/** True only when a live adapter key is present in the registry and reports configured. */
export function liveProviderReady(key: string): boolean {
  const provider = registry.get(key);
  return Boolean(provider && provider.live && provider.configured);
}

export function resetProviderRegistry(): void {
  registry.clear();
}

/** HMAC verification with a constant-time comparison. Missing secret or header always fails. */
export function verifyHmacSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string | undefined,
): { ok: boolean; reason: string } {
  if (!secret) return { ok: false, reason: "No webhook secret is configured, so unsigned callbacks are refused." };
  const provided = headers["x-signature"] ?? headers["x-jata-signature"] ?? headers["x-hub-signature-256"];
  if (!provided) return { ok: false, reason: "The callback has no signature." };
  const value = provided.startsWith("sha256=") ? provided.slice(7) : provided;
  // Buffer.from(value, "hex") silently truncates at invalid characters and ignores odd nibbles.
  // Validate the complete wire value before decoding; never accept a valid prefix plus junk.
  if (value.length !== 64 || !/^[0-9a-f]{64}$/i.test(value)) return { ok: false, reason: "The callback signature is malformed." };
  const a = Buffer.from(value, "hex");
  const b = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  if (a.length !== b.length) return { ok: false, reason: "The callback signature does not match." };
  return timingSafeEqual(a, b) ? { ok: true, reason: "Verified." } : { ok: false, reason: "The callback signature does not match." };
}

export function signCallback(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Generic callback shape used by the sandbox and by the internal event bridge:
 * `{ events: [{ id, messageId, status, at, reason }] }`. A real provider adapter maps its own
 * payload into this shape before anything touches the database.
 */
export function parseGenericCallbacks(rawBody: string): ParsedProviderEvent[] {
  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const events = Array.isArray(parsed?.events) ? parsed.events : Array.isArray(parsed) ? parsed : [parsed];
  const known = new Set(["ACCEPTED", "SENT", "DELIVERED", "FAILED", "READ", "UNKNOWN"]);
  return events
    .filter((event: any) => event && typeof event === "object")
    .map((event: any, index: number): ParsedProviderEvent => {
      const status = String(event.status ?? event.eventType ?? "UNKNOWN").toUpperCase();
      return {
        providerMessageId: event.messageId ? String(event.messageId) : event.providerMessageId ? String(event.providerMessageId) : null,
        eventType: (known.has(status) ? status : "UNKNOWN") as ParsedProviderEvent["eventType"],
        eventId: String(event.id ?? event.eventId ?? `${event.messageId ?? "unknown"}:${status}:${index}`),
        occurredAt: event.at ? new Date(event.at) : null,
        reason: event.reason ? String(event.reason) : null,
        raw: event,
      };
    });
}
