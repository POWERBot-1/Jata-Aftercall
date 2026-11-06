/**
 * Durable call-state transitions with ordering guarantees.
 *
 * Telnyx delivers webhooks that can arrive duplicated, delayed or out of order.
 * Every transition is evaluated against a monotonic rank: a late `call.initiated`
 * arriving after `call.hangup` can never resurrect the call, and replays are
 * no-ops. Terminal states are absorbing.
 */
import { CALL_STATE_RANK, CALL_TERMINAL_STATES, type CallState, isCallState } from "./types";

export type TransitionResult = {
  applied: boolean;
  reason: "APPLIED" | "DUPLICATE" | "IGNORED_REGRESSION" | "TERMINAL" | "UNKNOWN_STATE";
  next: CallState;
};

export function transitionCallState(current: string, incoming: string): TransitionResult {
  if (!isCallState(incoming)) {
    return { applied: false, reason: "UNKNOWN_STATE", next: toState(current) };
  }
  const now = toState(current);
  if (CALL_TERMINAL_STATES.includes(now)) {
    // Terminal states absorb everything, including their own duplicate.
    return { applied: false, reason: "TERMINAL", next: now };
  }
  if (incoming === now) {
    return { applied: false, reason: "DUPLICATE", next: now };
  }
  if (CALL_STATE_RANK[incoming] < CALL_STATE_RANK[now]) {
    return { applied: false, reason: "IGNORED_REGRESSION", next: now };
  }
  return { applied: true, reason: "APPLIED", next: incoming };
}

function toState(value: string): CallState {
  return isCallState(value) ? value : "INITIATED";
}

/** Map a provider event type onto our state vocabulary. Unknown types return null. */
export function callStateForEventType(eventType: string): CallState | null {
  switch (eventType) {
    case "call.initiated":
      return "INITIATED";
    case "call.ringing":
      return "RINGING";
    case "call.answered":
      return "ANSWERED";
    case "call.hangup":
      return "COMPLETED";
    case "call.failed":
    case "call.machine.hangup":
      return "FAILED";
    case "call.hold.updated": // no state change; presence of hold is an in-call detail
      return null;
    default:
      return null;
  }
}
