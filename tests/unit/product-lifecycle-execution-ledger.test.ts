import { describe, expect, it } from "vitest";
import {
  claimLifecycleTask, completeLifecycleTask, failLifecycleTask, isUnsafeObservationState,
  lifecycleIdempotencyKey, moveLifecycleTaskToReview, planLifecycleObservation, retryDelayMs,
} from "@/lib/admin/product-lifecycle-execution-ledger";

const now = new Date("2026-11-22T12:00:00.000Z");
const task = (overrides: Record<string, unknown> = {}) => ({
  state: "READY" as const, attempts: 0, maxAttempts: 5, availableAt: new Date(now.getTime() - 1000),
  leaseToken: null, leaseUntil: null, completedAt: null, ...overrides,
});

describe("product lifecycle durable ledger contract", () => {
  it("derives stable opaque idempotency keys from lifecycle identity", () => {
    const input = { product: "BUSINESS_POS" as const, businessId: "biz-1", subscriptionId: "sub-1", transitionKey: "EXPIRE:v1" };
    expect(lifecycleIdempotencyKey(input)).toBe(lifecycleIdempotencyKey(input));
    expect(lifecycleIdempotencyKey(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(lifecycleIdempotencyKey({ ...input, transitionKey: "EXPIRE:v2" })).not.toBe(lifecycleIdempotencyKey(input));
    expect(() => lifecycleIdempotencyKey({ ...input, businessId: "" })).toThrow("INVALID_IDEMPOTENCY_INPUT");
  });

  it("queues only explicitly expired evidence and sends unknown policy to review", () => {
    expect(planLifecycleObservation({ state: "EXPIRED" })).toBe("ENQUEUE_EXPIRED");
    expect(planLifecycleObservation({ state: "GRACE_POLICY_UNKNOWN" })).toBe("ENQUEUE_REVIEW");
    expect(planLifecycleObservation({ state: "INVALID_GRACE_WINDOW" })).toBe("ENQUEUE_REVIEW");
    expect(planLifecycleObservation({ state: "GRACE" })).toBe("IGNORE");
    expect(isUnsafeObservationState("INVALID_GRACE_WINDOW")).toBe(true);
    expect(isUnsafeObservationState("CURRENT")).toBe(false);
  });

  it("claims eligible tasks with bounded leases and rejects future tasks", () => {
    const result = claimLifecycleTask(task(), { token: "claim-1", now, leaseMs: 60_000 });
    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({ state: "CLAIMED", attempts: 1, leaseToken: "claim-1" });
    expect(result.task.leaseUntil?.getTime()).toBe(now.getTime() + 60_000);
    expect(claimLifecycleTask(task({ availableAt: new Date(now.getTime() + 1000) }), { token: "x", now, leaseMs: 1000 }).ok).toBe(false);
    expect(claimLifecycleTask(task(), { token: "x", now, leaseMs: 16 * 60_000 }).ok).toBe(false);
  });

  it("reclaims expired leases but fences stale completion tokens", () => {
    const expired = task({ state: "CLAIMED", attempts: 1, leaseToken: "old", leaseUntil: new Date(now.getTime() - 1) });
    const reclaimed = claimLifecycleTask(expired, { token: "new", now, leaseMs: 30_000 });
    expect(reclaimed.ok).toBe(true);
    expect(reclaimed.event?.eventType).toBe("LEASE_RECLAIMED");
    expect(completeLifecycleTask(reclaimed.task, "old", now).ok).toBe(false);
    expect(completeLifecycleTask(reclaimed.task, "new", now).task.state).toBe("COMPLETED");
  });

  it("uses capped exponential retries and dead-letters exhausted or non-retryable work", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(60 * 60_000);
    const claimed = claimLifecycleTask(task(), { token: "t", now, leaseMs: 60_000 }).task;
    const retried = failLifecycleTask(claimed, "t", { now, errorCode: "TEMPORARY_FAILURE", retryable: true });
    expect(retried.task.state).toBe("RETRY");
    expect(retried.task.availableAt.getTime()).toBe(now.getTime() + 30_000);
    const permanent = failLifecycleTask(claimed, "t", { now, errorCode: "POLICY_BLOCKED", retryable: false });
    expect(permanent.task.state).toBe("DEAD_LETTER");
    const exhausted = failLifecycleTask({ ...claimed, attempts: 5 }, "t", { now, errorCode: "RETRY_LIMIT", retryable: true });
    expect(exhausted.task.state).toBe("DEAD_LETTER");
  });

  it("moves policy uncertainty to manual review, never to automatic completion", () => {
    const claimed = claimLifecycleTask(task(), { token: "t", now, leaseMs: 60_000 }).task;
    const review = moveLifecycleTaskToReview(claimed, "t", "GRACE_POLICY_UNKNOWN");
    expect(review.task.state).toBe("MANUAL_REVIEW");
    expect(review.task.leaseToken).toBeNull();
    expect(moveLifecycleTaskToReview(claimed, "wrong", "GRACE_POLICY_UNKNOWN").ok).toBe(false);
    expect(completeLifecycleTask(review.task, "t", now).ok).toBe(false);
  });

  it("fences expired leases and rejects malformed error codes", () => {
    const claimed = claimLifecycleTask(task(), { token: "t", now, leaseMs: 10 }).task;
    expect(completeLifecycleTask(claimed, "t", new Date(now.getTime() + 10)).ok).toBe(false);
    expect(failLifecycleTask(claimed, "t", { now, errorCode: "oops private text", retryable: true }).ok).toBe(false);
  });
});
