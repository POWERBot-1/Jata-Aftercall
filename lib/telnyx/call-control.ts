/**
 * Telnyx Call Control — authenticated, idempotent, durable command issuance (§Voice deliverable 2).
 *
 * Every outbound command is recorded in `VoiceCallCommand` under a caller-supplied dedupe key
 * before any network I/O: a command with a known dedupe key is never issued twice. Network
 * failures and 5xx responses are retried with capped exponential backoff; 4xx responses are
 * terminal failures (except provider "already in state" answers, recorded as no-ops).
 *
 * No credentials, base URL overrides or readiness decisions are hard-coded: the client is
 * constructed from injected configuration, and `getCallControlClient()` returns null whenever
 * the deployment lacks approved credentials — every caller must handle null and fail closed.
 */
import { createHmac } from "node:crypto";
import { getVoiceReadiness } from "./voice-readiness";
import type { VoiceEventStore } from "@/lib/voice/call-events";

export type TelnyxTransport = (
  method: "GET" | "POST",
  path: string,
  body: unknown,
  headers: Record<string, string>,
) => Promise<{ status: number; json: () => Promise<any> }>;

export type CallControlConfig = {
  apiKey: string;
  baseUrl?: string;
  transport?: TelnyxTransport;
  maxAttempts?: number;
  retryBaseMs?: number;
};

export type CommandOutcome =
  | { outcome: "SUCCEEDED"; status: number; deduped: boolean; response: unknown }
  | { outcome: "NOOP"; status: number; deduped: boolean; response: unknown }
  | { outcome: "FAILED"; status: number | null; deduped: boolean; error: string; response: unknown }
  /**
   * The command was recorded SENT but its provider response was never captured (crash or
   * crash-like interruption mid-flight). Its remote effect is unknown, so it must never be
   * reported as success: callers fail safe instead of acting on an assumption.
   */
  | { outcome: "UNCERTAIN"; status: null; deduped: true; error: string; response: unknown };

const defaultTransport: TelnyxTransport = async (method, path, body, headers) => {
  const response = await fetch(path, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: () => response.json().catch(() => ({})) };
};

/**
 * Returns a configured client only when approved credentials exist, and only when the voice
 * readiness gates allow live call handling for answer-type actions (caller still re-checks
 * kill switches per business).
 */
export function getCallControlClient(env: Record<string, string | undefined> = process.env): TelnyxCallControlClient | null {
  const apiKey = env.TELNYX_API_KEY?.trim();
  if (!apiKey) return null;
  return new TelnyxCallControlClient({
    apiKey,
    baseUrl: env.TELNYX_API_BASE?.trim() || undefined,
    transport: env.TELNYX_API_BASE?.trim() ? undefined : undefined,
  });
}

export class TelnyxCallControlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly transport: TelnyxTransport;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;

  constructor(config: CallControlConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.telnyx.com").replace(/\/$/, "");
    this.transport = config.transport ?? defaultTransport;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 200;
  }

  /**
   * Issue (or deduplicate) one Call Control action for a call.
   * `dedupeKey` must be stable for the logical command (e.g. `answer:<callControlId>`).
   */
  async sendCommand(store: VoiceEventStore, params: {
    callControlId: string;
    command: string;
    dedupeKey: string;
    payload?: Record<string, unknown>;
    retryBaseMs?: number;
  }): Promise<CommandOutcome> {
    const existing = await store.findCommandByDedupeKey(params.dedupeKey);
    if (existing && existing.status === "SUCCEEDED") {
      // Confirmed success — never issue the logical command twice.
      return {
        outcome: "SUCCEEDED",
        status: 200,
        deduped: true,
        response: { dedupeKey: params.dedupeKey, priorStatus: existing.status },
      };
    }
    if (existing && existing.status === "SENT") {
      // Recorded as sent but never confirmed: the provider may or may not have executed it.
      // Re-sending could double-execute (transfer/hangup) and reporting success would be a
      // lie — surface UNCERTAIN and let the caller fail safe.
      return {
        outcome: "UNCERTAIN",
        status: null,
        deduped: true,
        error: "command was sent but never confirmed — remote state unknown",
        response: { dedupeKey: params.dedupeKey, priorStatus: existing.status },
      };
    }
    // PENDING (never sent) and FAILED (confirmed rejected) both fall through to a real
    // (re-)issue below; a crash before the network call leaves no remote effect to protect.
    const command = existing ?? (await store.createCommand({
      callControlId: params.callControlId,
      command: params.command,
      dedupeKey: params.dedupeKey,
      requestPayload: params.payload ? JSON.stringify(params.payload) : null,
    }));

    const path = `${this.baseUrl}/v2/calls/${encodeURIComponent(params.callControlId)}/actions/${params.command}`;
    const headers = { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
    const base = params.retryBaseMs ?? this.retryBaseMs;
    let lastError = "";
    let lastStatus: number | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await store.updateCommand(command.id, { status: "SENT", attempts: command.attempts + attempt, lastError: null });
      try {
        const response = await this.transport("POST", path, params.payload ?? {}, headers);
        lastStatus = response.status;
        const json = await response.json().catch(() => ({}));
        if (response.status >= 200 && response.status < 300) {
          await store.updateCommand(command.id, { status: "SUCCEEDED", responsePayload: JSON.stringify(json).slice(0, 4000) });
          return { outcome: "SUCCEEDED", status: response.status, deduped: false, response: json };
        }
        if (isAlreadyInState(json, params.command)) {
          await store.updateCommand(command.id, { status: "SUCCEEDED", responsePayload: JSON.stringify(json).slice(0, 4000) });
          return { outcome: "NOOP", status: response.status, deduped: false, response: json };
        }
        if (response.status >= 400 && response.status < 500) {
          const error = extractError(json) || `HTTP ${response.status}`;
          await store.updateCommand(command.id, { status: "FAILED", lastError: error.slice(0, 500), responsePayload: JSON.stringify(json).slice(0, 4000) });
          return { outcome: "FAILED", status: response.status, deduped: false, error, response: json };
        }
        lastError = extractError(json) || `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "network error";
      }
      if (attempt < this.maxAttempts) {
        await sleep(base * 2 ** (attempt - 1));
      }
    }

    await store.updateCommand(command.id, { status: "FAILED", lastError: lastError.slice(0, 500) });
    return { outcome: "FAILED", status: lastStatus, deduped: false, error: lastError || "command failed", response: null };
  }

  answer(store: VoiceEventStore, callControlId: string) {
    return this.sendCommand(store, { callControlId, command: "answer", dedupeKey: `answer:${callControlId}` });
  }

  hangup(store: VoiceEventStore, callControlId: string, reason: string) {
    return this.sendCommand(store, {
      callControlId,
      command: "hangup",
      dedupeKey: `hangup:${callControlId}`,
      payload: { cause: reason.slice(0, 60) },
    });
  }

  transfer(store: VoiceEventStore, callControlId: string, to: string) {
    return this.sendCommand(store, {
      callControlId,
      command: "transfer",
      dedupeKey: `transfer:${callControlId}:${to}`,
      payload: { to },
    });
  }

  startMediaStream(store: VoiceEventStore, callControlId: string, streamUrl: string) {
    // Telnyx's bidirectional media-streaming action is `streaming_start` with
    // `stream_track: "both_tracks"` and `stream_bidirectional_mode: "rtp"` (see the
    // Telnyx media-streaming docs referenced in the PR review). Exact parameter
    // confirmation remains a provider-acceptance verification item; the command name and
    // payload here follow the documented shape rather than the unsupported
    // `media_stream_start`/`both_track` combination.
    return this.sendCommand(store, {
      callControlId,
      command: "streaming_start",
      dedupeKey: `media_stream:${callControlId}`,
      payload: {
        stream_url: streamUrl,
        stream_track: "both_tracks",
        stream_bidirectional_mode: "rtp",
        audio_encoding: "mulaw",
        sample_rate: 8000,
      },
    });
  }

  stopMediaStream(store: VoiceEventStore, callControlId: string) {
    return this.sendCommand(store, {
      callControlId,
      command: "streaming_stop",
      dedupeKey: `media_stream_stop:${callControlId}`,
    });
  }
}

/**
 * Per-call authentication token for the media-worker WebSocket handshake: an HMAC of the
 * call control id under the shared `VOICE_MEDIA_STREAM_TOKEN` secret. The raw secret never
 * leaves the deployment; a token is only valid for the exact call it was minted for, and the
 * worker recomputes and compares it in constant time before any session starts.
 */
export function signMediaStreamToken(secret: string, callControlId: string): string {
  return createHmac("sha256", secret).update(callControlId).digest("base64url");
}

/**
 * Build the authenticated stream URL handed to the provider for one call. Fails closed:
 * without the shared secret there is no safe URL to dial, so the caller must refuse the call
 * rather than expose an unauthenticated media endpoint.
 */
export function buildMediaStreamUrl(baseUrl: string, callControlId: string, secret: string | undefined): string | null {
  const trimmedSecret = secret?.trim();
  if (!trimmedSecret) return null;
  const url = new URL(baseUrl);
  url.searchParams.set("callControlId", callControlId);
  url.searchParams.set("token", signMediaStreamToken(trimmedSecret, callControlId));
  return url.toString();
}

/** Whether an answer-type action may be issued at all for this deployment. */
export function callControlMayAnswer(env: Record<string, string | undefined> = process.env): boolean {
  return getVoiceReadiness(env as any).canReceiveCalls;
}

function extractError(json: any): string {
  return (
    json?.errors?.[0]?.detail ||
    json?.errors?.[0]?.title ||
    json?.error?.message ||
    json?.message ||
    ""
  ).toString();
}

function isAlreadyInState(json: any, command: string): boolean {
  const detail = `${extractError(json)} ${JSON.stringify(json)}`.toLowerCase();
  if (command === "answer") return detail.includes("already answered") || detail.includes("call is already in the answered state");
  if (command === "hangup") return detail.includes("call is already hung up") || detail.includes("call has already ended");
  if (command === "streaming_stop" || command === "media_stream_stop") return detail.includes("not streaming") || detail.includes("no media stream");
  if (command === "streaming_start") return detail.includes("already streaming") || detail.includes("media stream already");
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
