/**
 * Incoming-call handling: kill switches, readiness, concurrency and spend caps, answer and
 * media-stream issuance, plus terminal-event usage finalization (§Voice deliverables 5 & 6).
 *
 * Fail-safe defaults: a deployment with no explicit limits answers nothing it should not,
 * and a routed call that cannot be served is terminated with a clear cause instead of ringing
 * forever. Every decision is idempotent — provider webhook retries re-run this safely.
 */
import { callControlMayAnswer, getCallControlClient, type TelnyxCallControlClient } from "@/lib/telnyx/call-control";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";
import type { VoiceEventStore } from "./call-events";
import type { VoiceCallRow } from "./types";
import { finalizeUsageForCall } from "./metering";

export type VoiceLimitEnvironment = {
  VOICE_KILL_SWITCH?: string;
  VOICE_CONCURRENT_CALLS_LIMIT?: string;
  VOICE_DAILY_SPEND_LIMIT_MINOR?: string;
  VOICE_MEDIA_STREAM_URL?: string;
};

export type LimitDecision =
  | { allow: true; reason: "OK" }
  | { allow: false; reason: "GLOBAL_KILL_SWITCH" | "BUSINESS_DISABLED" | "READINESS_GATED" | "CONCURRENCY_LIMIT" | "SPEND_LIMIT" | "NO_CLIENT" | "NO_POLICY" };

export function evaluateIncomingCall(params: {
  env?: VoiceLimitEnvironment & Record<string, string | undefined>;
  policy: { hardDisabled: boolean; concurrencyLimit: number | null; dailySpendLimitMinor: number | null } | null;
  activeCalls: number;
  todaysSpendMinor: number;
}): LimitDecision {
  const env = params.env ?? (process.env as any);
  if (env.VOICE_KILL_SWITCH === "true") return { allow: false, reason: "GLOBAL_KILL_SWITCH" };
  if (params.policy?.hardDisabled) return { allow: false, reason: "BUSINESS_DISABLED" };
  if (!callControlMayAnswer(env)) return { allow: false, reason: "READINESS_GATED" };
  const globalConcurrency = Number(env.VOICE_CONCURRENT_CALLS_LIMIT ?? 2);
  const concurrencyLimit = params.policy?.concurrencyLimit ?? (Number.isFinite(globalConcurrency) && globalConcurrency > 0 ? globalConcurrency : 2);
  if (params.activeCalls >= concurrencyLimit) return { allow: false, reason: "CONCURRENCY_LIMIT" };
  const spendLimit = params.policy?.dailySpendLimitMinor ?? numberOr(env.VOICE_DAILY_SPEND_LIMIT_MINOR, null);
  if (spendLimit !== null && params.todaysSpendMinor >= spendLimit) return { allow: false, reason: "SPEND_LIMIT" };
  return { allow: true, reason: "OK" };
}

export type IncomingCallHooks = {
  store: VoiceEventStore;
  client?: TelnyxCallControlClient | null;
  env?: VoiceLimitEnvironment & Record<string, string | undefined>;
  now?: () => Date;
  /** Test seam: count of currently non-terminal calls for the business. */
  countActiveCalls?: (businessId: string) => Promise<number>;
  /** Test seam: provider-reported spend for this business since local midnight. */
  todaysSpendMinor?: (businessId: string) => Promise<number>;
};

/**
 * Called exactly once per call.initiated event (and safe to re-run on provider retries).
 * Answers when every gate passes; otherwise terminates the call with an explicit cause.
 * A call that is already terminal (late/duplicate initiated events) is skipped entirely —
 * a terminal state is absorbing and must never be overwritten or re-answered.
 */
export async function handleIncomingCall(call: VoiceCallRow, hooks: IncomingCallHooks): Promise<{
  handled: "ANSWERED" | "REFUSED" | "SKIPPED";
  reason: string;
}> {
  if (call.state === "COMPLETED" || call.state === "FAILED") {
    return { handled: "SKIPPED", reason: "ALREADY_TERMINAL" };
  }
  const env = hooks.env ?? (process.env as any);
  const policy = (await (hooks.store as any).findBusinessPolicy?.(call.businessId)) ?? null;
  const activeCalls = hooks.countActiveCalls
    ? await hooks.countActiveCalls(call.businessId)
    : await countNonTerminalCalls(hooks.store, call.businessId);
  const spend = hooks.todaysSpendMinor
    ? await hooks.todaysSpendMinor(call.businessId)
    : await spendForToday(hooks.store, call.businessId, hooks.now?.() ?? new Date());

  const decision = evaluateIncomingCall({ env, policy, activeCalls, todaysSpendMinor: spend });
  const client = hooks.client ?? getCallControlClient(env);

  if (!decision.allow) {
    if (client) {
      await client.hangup(hooks.store, call.callControlId, `jata:${decision.reason.toLowerCase()}`).catch(() => undefined);
    }
    await hooks.store.updateCall(call.id, { state: "FAILED", failoverReason: decision.reason, endedAt: hooks.now?.() ?? new Date() }).catch(() => undefined);
    return { handled: "REFUSED", reason: decision.reason };
  }
  if (!client) {
    await hooks.store.updateCall(call.id, { state: "FAILED", failoverReason: "NO_CLIENT", endedAt: hooks.now?.() ?? new Date() }).catch(() => undefined);
    return { handled: "REFUSED", reason: "NO_CLIENT" };
  }

  const answer = await client.answer(hooks.store, call.callControlId);
  if (answer.outcome === "FAILED") {
    await hooks.store.updateCall(call.id, { state: "FAILED", failoverReason: "ANSWER_FAILED", endedAt: hooks.now?.() ?? new Date() }).catch(() => undefined);
    return { handled: "REFUSED", reason: "ANSWER_FAILED" };
  }
  const streamUrl = env.VOICE_MEDIA_STREAM_URL?.trim();
  if (streamUrl) {
    await client.startMediaStream(hooks.store, call.callControlId, streamUrl).catch(() => undefined);
  }
  await hooks.store.updateCall(call.id, { state: "ANSWERED", answeredAt: hooks.now?.() ?? new Date() }).catch(() => undefined);
  return { handled: "ANSWERED", reason: "OK" };
}

/** Terminal webhook: close the call and finalize its metering row exactly once. */
export async function finalizeCallFromEvent(
  store: VoiceEventStore,
  call: VoiceCallRow,
  eventType: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const terminal = eventType === "call.hangup" || eventType === "call.failed" || eventType === "call.machine.hangup";
  if (!terminal) return;
  if (call.state !== "COMPLETED" && call.state !== "FAILED") {
    await store.updateCall(call.id, {
      state: eventType === "call.hangup" ? "COMPLETED" : "FAILED",
      endedAt: call.endedAt ?? now(),
      hangupCause: eventType,
    }).catch(() => undefined);
  }
  await finalizeUsageForCall(store, call).catch(() => undefined);
}

async function countNonTerminalCalls(store: VoiceEventStore, businessId: string): Promise<number> {
  const fn = (store as any).countActiveCalls;
  if (typeof fn === "function") return fn.call(store, businessId);
  return 0;
}

async function spendForToday(store: VoiceEventStore, businessId: string, now: Date): Promise<number> {
  const fn = (store as any).todaysSpendMinor;
  if (typeof fn === "function") return fn.call(store, businessId, now);
  return 0;
}

function numberOr(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
