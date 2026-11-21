import { describe, expect, it } from "vitest";
import {
  classifyProviderStatus,
  isInProgressPaymentStatus,
  isSettleablePaymentStatus,
  subscriptionWindow,
} from "@/lib/paymentVerification";

describe("provider payment lifecycle contract", () => {
  it("recognizes provider success without treating it as local settlement by itself", () => {
    expect(classifyProviderStatus("success")).toEqual({ kind: "success" });
  });

  it.each(["ongoing", "pending", "processing", "queued"])(
    "keeps provider status %s in progress",
    (status) => {
      expect(isInProgressPaymentStatus(status)).toBe(true);
      expect(classifyProviderStatus(status)).toEqual({ kind: "in_progress", providerStatus: status });
    },
  );

  it.each([
    ["failed", "FAILED"],
    ["abandoned", "CANCELLED"],
    ["expired", "EXPIRED"],
  ] as const)("maps final provider status %s to %s", (providerStatus, status) => {
    expect(classifyProviderStatus(providerStatus)).toEqual({ kind: "final_failure", status });
  });

  it("allows only provider-verifiable pre-settlement local states to be corrected", () => {
    for (const status of ["PENDING", "FAILED", "CANCELLED", "EXPIRED"]) {
      expect(isSettleablePaymentStatus(status), status).toBe(true);
    }
    for (const status of ["PAID", "REFUNDED", "REVIEW_REQUIRED", "UNKNOWN", null, undefined]) {
      expect(isSettleablePaymentStatus(status), String(status)).toBe(false);
    }
  });

  it("does not treat an in-progress provider status as a final failure", () => {
    expect(classifyProviderStatus("processing").kind).toBe("in_progress");
  });
});

describe("subscription period extension contract", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  it("extends an unexpired ACTIVE period from its existing expiry", () => {
    const currentExpiry = new Date(now.getTime() + 5 * day);
    const result = subscriptionWindow(now, 30, {
      status: "ACTIVE",
      startAt: new Date(now.getTime() - 10 * day),
      expiresAt: currentExpiry,
    });
    expect(result.startAt.toISOString()).toBe(new Date(now.getTime() - 10 * day).toISOString());
    expect(result.expiresAt.getTime()).toBe(currentExpiry.getTime() + 30 * day);
  });

  it("extends an unexpired EXPIRING period without creating a gap", () => {
    const currentExpiry = new Date(now.getTime() + 2 * day);
    const result = subscriptionWindow(now, 30, { status: "EXPIRING", expiresAt: currentExpiry });
    expect(result.startAt).toEqual(now);
    expect(result.expiresAt.getTime()).toBe(currentExpiry.getTime() + 30 * day);
  });

  it.each(["EXPIRED", "CANCELLED", "SUSPENDED", "PENDING", "PAST_DUE"])(
    "starts a fresh period for %s rather than extending stale time",
    (status) => {
      const result = subscriptionWindow(now, 30, {
        status,
        startAt: new Date(now.getTime() - 20 * day),
        expiresAt: new Date(now.getTime() + 10 * day),
      });
      expect(result.startAt).toEqual(now);
      expect(result.expiresAt.getTime()).toBe(now.getTime() + 30 * day);
    },
  );

  it("starts a fresh period when an ACTIVE subscription is already expired", () => {
    const result = subscriptionWindow(now, 30, {
      status: "ACTIVE",
      expiresAt: new Date(now.getTime() - day),
    });
    expect(result.startAt).toEqual(now);
    expect(result.expiresAt.getTime()).toBe(now.getTime() + 30 * day);
  });
});
