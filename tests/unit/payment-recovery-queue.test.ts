import { describe, expect, it } from "vitest";
import { paymentRecoveryRetryDelayMs } from "@/lib/payments/payment-recovery-policy";
import {
  completePaymentRecoveryTask,
  failPaymentRecoveryTask,
  type RecoveryQueueClient,
} from "@/lib/payments/payment-recovery-queue";

describe("durable payment recovery queue retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(paymentRecoveryRetryDelayMs(1)).toBe(30_000);
    expect(paymentRecoveryRetryDelayMs(2)).toBe(60_000);
    expect(paymentRecoveryRetryDelayMs(3)).toBe(120_000);
    expect(paymentRecoveryRetryDelayMs(99)).toBe(6 * 60 * 60 * 1000);
  });
  it("rejects invalid attempt numbers", () => {
    expect(() => paymentRecoveryRetryDelayMs(0)).toThrow("PAYMENT_RECOVERY_ATTEMPT_INVALID");
    expect(() => paymentRecoveryRetryDelayMs(-1)).toThrow("PAYMENT_RECOVERY_ATTEMPT_INVALID");
    expect(() => paymentRecoveryRetryDelayMs(1.5)).toThrow("PAYMENT_RECOVERY_ATTEMPT_INVALID");
  });
});

describe("payment recovery lease fencing", () => {
  it("does not complete a task after its lease expires", async () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    let captured: any;
    const client = {
      paymentRecoveryTask: {
        updateMany: async (args: any) => { captured = args; return { count: 0 }; },
      },
    } as unknown as RecoveryQueueClient;

    const completed = await completePaymentRecoveryTask("task-1", "lease-1", now, client);
    expect(completed).toBe(false);
    expect(captured.where).toEqual({
      id: "task-1",
      leaseToken: "lease-1",
      status: "LEASED",
      leaseUntil: { gt: now },
    });
  });

  it("treats an expired lease as stale before scheduling a retry", async () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    let captured: any;
    const client = {
      paymentRecoveryTask: {
        findFirst: async (args: any) => { captured = args; return null; },
      },
    } as unknown as RecoveryQueueClient;

    const result = await failPaymentRecoveryTask("task-1", "lease-1", "WORKER_FAILED", { now }, client);
    expect(result).toBe("STALE_LEASE");
    expect(captured.where).toEqual({
      id: "task-1",
      leaseToken: "lease-1",
      status: "LEASED",
      leaseUntil: { gt: now },
    });
  });
});
