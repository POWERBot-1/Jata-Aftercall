import { describe, expect, it } from "vitest";
import { paymentRecoveryRetryDelayMs } from "@/lib/payments/payment-recovery-policy";

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
