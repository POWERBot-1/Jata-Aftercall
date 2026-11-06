/**
 * Human handoff and failure recovery (§Voice deliverable 5).
 *
 * Transfer targets come from the business record the owner already controls — never from the
 * caller. Every failure class (no configured number, busy, unavailable, provider outage,
 * exhausted retries) converges on one of two safe ends: return to the automated front desk
 * with the failure recorded, or a clear, prompt termination. No call is ever left open after
 * a failed handoff, and no transfer is retried beyond the cap.
 */
import type { TelnyxCallControlClient } from "@/lib/telnyx/call-control";
import type { VoiceEventStore } from "./call-events";
import type { VoiceCallRow } from "./types";

export type HandoffOutcome =
  | { result: "TRANSFERRED"; target: string }
  | { result: "FALLBACK_TO_AGENT"; target: string | null; reason: string }
  | { result: "TERMINATED"; target: string | null; reason: string };

export type HandoffDeps = {
  store: VoiceEventStore;
  client: Pick<TelnyxCallControlClient, "transfer" | "hangup">;
  /** Owner-configured destination, read from Business.phone by the caller. */
  businessPhone: string | null;
  maxAttempts?: number;
  /** Optional farewell playback before a forced termination (media session hook). */
  playFarewell?: (call: VoiceCallRow, reason: string) => Promise<void>;
  isTerminalCall?: (call: VoiceCallRow) => boolean;
};

const HANDOFF_INTENT_PATTERN =
  /\b(human|agent|person|representative|owner|talk to someone|mtu|watu|muongee|afisa|mmiliki|mwakilishi|wakilishi|ni mtu)\b/i;

export function detectHandoffIntent(transcript: string): boolean {
  return HANDOFF_INTENT_PATTERN.test(transcript);
}

/**
 * Attempt a human handoff. Provider errors are classified; unknown numbers never leave the
 * caller ringing: the fallback path terminates with an explicit reason recorded on the call.
 */
export async function attemptHumanHandoff(call: VoiceCallRow, deps: HandoffDeps): Promise<HandoffOutcome> {
  const maxAttempts = deps.maxAttempts ?? 3;
  const target = deps.businessPhone?.trim() || null;

  if (!target) {
    await deps.store.updateCall(call.id, { state: "HANDING_OFF", failoverReason: "NO_HANDOFF_NUMBER" }).catch(() => undefined);
    return finishTerminated(call, deps, null, "NO_HANDOFF_NUMBER");
  }

  await deps.store.updateCall(call.id, { state: "HANDING_OFF", handoffTarget: target }).catch(() => undefined);

  let lastReason = "TRANSFER_FAILED";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const outcome = await deps.client.transfer(deps.store, call.callControlId, target);
      if (outcome.outcome === "SUCCEEDED" || outcome.outcome === "NOOP") {
        return { result: "TRANSFERRED", target };
      }
      lastReason = classifyTransferError(outcome.error ?? "");
      // Busy/unavailable are terminal for this attempt loop: retrying a busy line
      // immediately just burns the caller's time.
      if (lastReason === "RECIPIENT_BUSY" || lastReason === "RECIPIENT_UNAVAILABLE") break;
    } catch (error) {
      lastReason = error instanceof Error && /network|fetch|timeout/i.test(error.message) ? "PROVIDER_OUTAGE" : "TRANSFER_FAILED";
      if (lastReason === "PROVIDER_OUTAGE" && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        continue;
      }
      break;
    }
  }

  if (lastReason === "PROVIDER_OUTAGE" || lastReason === "TRANSFER_FAILED") {
    // Return control to the automated front desk when we still have a media session.
    await deps.store.updateCall(call.id, { state: "IN_CALL", failoverReason: lastReason, handoffTarget: target }).catch(() => undefined);
    return { result: "FALLBACK_TO_AGENT", target, reason: lastReason };
  }

  return finishTerminated(call, deps, target, lastReason);
}

async function finishTerminated(call: VoiceCallRow, deps: HandoffDeps, target: string | null, reason: string): Promise<HandoffOutcome> {
  try {
    await deps.playFarewell?.(call, reason);
  } catch {
    // Farewell is best-effort; termination must still happen.
  }
  await Promise.resolve(
    deps.client.hangup(deps.store, call.callControlId, `jata:handoff:${reason.toLowerCase()}`).catch(() => undefined),
  );
  await deps.store
    .updateCall(call.id, {
      state: "COMPLETED",
      failoverReason: reason,
      handoffTarget: target,
      endedAt: new Date(),
    })
    .catch(() => undefined);
  return { result: "TERMINATED", target, reason };
}

function classifyTransferError(error: string): string {
  const detail = error.toLowerCase();
  if (detail.includes("busy")) return "RECIPIENT_BUSY";
  if (detail.includes("unavailable") || detail.includes("not answer") || detail.includes("no answer") || detail.includes("invalid number")) {
    return "RECIPIENT_UNAVAILABLE";
  }
  if (detail.includes("network") || detail.includes("timeout") || detail.includes("fetch")) return "PROVIDER_OUTAGE";
  return "TRANSFER_FAILED";
}
