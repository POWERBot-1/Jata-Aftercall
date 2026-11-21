import { createHash } from "node:crypto";
import type { ExpiryObservation, ExpiryObservationState, LifecycleProduct } from "@/lib/admin/product-expiry-grace-observation";

export type LifecycleTaskState = "READY" | "CLAIMED" | "RETRY" | "COMPLETED" | "DEAD_LETTER" | "MANUAL_REVIEW";
export type LifecycleTask = {
  state: LifecycleTaskState;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  completedAt: Date | null;
};
export type LifecycleTransition = {
  ok: boolean;
  task: LifecycleTask;
  event?: { eventType: string; fromState: LifecycleTaskState; toState: LifecycleTaskState; reasonCode: string };
};

const MAX_ATTEMPTS = 20;
const MAX_RETRY_MS = 60 * 60 * 1000;

export function lifecycleIdempotencyKey(input: {
  product: LifecycleProduct; businessId: string; subscriptionId: string; transitionKey: string;
}): string {
  for (const value of Object.values(input)) {
    if (typeof value !== "string" || value.length < 1 || value.length > 256) throw new Error("INVALID_IDEMPOTENCY_INPUT");
  }
  const canonical = [input.product, input.businessId, input.subscriptionId, input.transitionKey].join("\u001f");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function planLifecycleObservation(observation: Pick<ExpiryObservation, "state">): "ENQUEUE_REVIEW" | "ENQUEUE_EXPIRED" | "IGNORE" {
  if (observation.state === "EXPIRED") return "ENQUEUE_EXPIRED";
  if (observation.state === "GRACE_POLICY_UNKNOWN" || observation.state === "INVALID_GRACE_WINDOW") return "ENQUEUE_REVIEW";
  return "IGNORE";
}

export function retryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("INVALID_ATTEMPT");
  return Math.min(30_000 * (2 ** Math.min(attempt - 1, 16)), MAX_RETRY_MS);
}

export function claimLifecycleTask(task: LifecycleTask, input: {
  token: string; now: Date; leaseMs: number;
}): LifecycleTransition {
  if (!input.token || input.token.length > 256 || !Number.isInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 15 * 60_000) {
    return { ok: false, task };
  }
  const eligible = (task.state === "READY" || task.state === "RETRY") && task.availableAt <= input.now;
  const expiredLease = task.state === "CLAIMED" && task.leaseUntil !== null && task.leaseUntil <= input.now;
  if (!eligible && !expiredLease) return { ok: false, task };
  if (task.attempts >= Math.min(task.maxAttempts, MAX_ATTEMPTS)) {
    const next = { ...task, state: "DEAD_LETTER" as const, leaseToken: null, leaseUntil: null };
    return { ok: true, task: next, event: { eventType: "DEAD_LETTERED", fromState: task.state, toState: next.state, reasonCode: "ATTEMPT_LIMIT_REACHED" } };
  }
  const next = {
    ...task, state: "CLAIMED" as const, attempts: task.attempts + 1,
    leaseToken: input.token, leaseUntil: new Date(input.now.getTime() + input.leaseMs),
  };
  return { ok: true, task: next, event: { eventType: expiredLease ? "LEASE_RECLAIMED" : "CLAIMED", fromState: task.state, toState: next.state, reasonCode: expiredLease ? "EXPIRED_LEASE" : "READY_WORK" } };
}

export function completeLifecycleTask(task: LifecycleTask, token: string, now: Date): LifecycleTransition {
  if (task.state !== "CLAIMED" || !token || task.leaseToken !== token || !task.leaseUntil || task.leaseUntil <= now) return { ok: false, task };
  const next = { ...task, state: "COMPLETED" as const, leaseToken: null, leaseUntil: null, completedAt: now };
  return { ok: true, task: next, event: { eventType: "COMPLETED", fromState: task.state, toState: next.state, reasonCode: "CLAIMED_WORK_COMPLETED" } };
}

export function failLifecycleTask(task: LifecycleTask, token: string, input: {
  now: Date; errorCode: string; retryable: boolean;
}): LifecycleTransition {
  if (task.state !== "CLAIMED" || !token || task.leaseToken !== token || !task.leaseUntil || task.leaseUntil <= input.now) return { ok: false, task };
  if (!/^[A-Z0-9_]{1,64}$/.test(input.errorCode)) return { ok: false, task };
  const exhausted = task.attempts >= Math.min(task.maxAttempts, MAX_ATTEMPTS);
  const state: LifecycleTaskState = !input.retryable || exhausted ? "DEAD_LETTER" : "RETRY";
  const next = {
    ...task, state, availableAt: state === "RETRY" ? new Date(input.now.getTime() + retryDelayMs(task.attempts)) : task.availableAt,
    leaseToken: null, leaseUntil: null,
  };
  return {
    ok: true, task: next,
    event: { eventType: state === "RETRY" ? "RETRY_SCHEDULED" : "DEAD_LETTERED", fromState: task.state, toState: state, reasonCode: input.errorCode },
  };
}

export function moveLifecycleTaskToReview(task: LifecycleTask, token: string, reasonCode: string): LifecycleTransition {
  if (task.state !== "CLAIMED" || !token || task.leaseToken !== token || !/^[A-Z0-9_]{1,64}$/.test(reasonCode)) return { ok: false, task };
  const next = { ...task, state: "MANUAL_REVIEW" as const, leaseToken: null, leaseUntil: null };
  return { ok: true, task: next, event: { eventType: "MANUAL_REVIEW_REQUIRED", fromState: task.state, toState: next.state, reasonCode } };
}

export function isUnsafeObservationState(state: ExpiryObservationState): boolean {
  return state === "GRACE_POLICY_UNKNOWN" || state === "INVALID_GRACE_WINDOW";
}
