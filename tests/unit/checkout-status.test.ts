import { describe, expect, it } from "vitest";
import { classifyProviderStatus, failedPaymentStatus, isInProgressPaymentStatus } from "@/lib/paymentVerification";
import { CHECKOUT_POLL_INTERVALS_MS, interpretVerifyResponse } from "@/lib/checkoutStatus";

describe("Paystack provider status classification", () => {
  it.each(["ongoing", "pending", "processing", "queued"])("'%s' is in progress", (status) => {
    expect(isInProgressPaymentStatus(status)).toBe(true);
    expect(classifyProviderStatus(status)).toEqual({ kind: "in_progress", providerStatus: status });
  });

  it("success, final failures and unknown values are classified without treating them as in progress", () => {
    expect(classifyProviderStatus("success")).toEqual({ kind: "success" });
    expect(classifyProviderStatus("abandoned")).toEqual({ kind: "final_failure", status: "CANCELLED" });
    expect(classifyProviderStatus("failed")).toEqual({ kind: "final_failure", status: "FAILED" });
    expect(classifyProviderStatus("reversed")).toEqual({ kind: "final_failure", status: "FAILED" });
    for (const odd of ["PENDING", "Processing", "", null, undefined, 1]) expect(isInProgressPaymentStatus(odd)).toBe(false);
    expect(failedPaymentStatus("expired")).toBe("EXPIRED");
  });
});

describe("checkout callback view state", () => {
  it("shows success only for a server-confirmed PAID payment with an ACTIVE subscription", () => {
    expect(interpretVerifyResponse(200, { status: "PAID", subscriptionStatus: "ACTIVE" }).state).toBe("paid");
    expect(interpretVerifyResponse(200, { status: "PAID", subscriptionStatus: null }).state).toBe("activating");
    expect(interpretVerifyResponse(200, {}).state).not.toBe("paid");
    expect(interpretVerifyResponse(200, { status: "success" }).state).not.toBe("paid");
  });

  it("represents a still-processing payment and keeps polling it", () => {
    const view = interpretVerifyResponse(200, { status: "PENDING" });
    expect(view.state).toBe("processing");
    expect(view.poll).toBe(true);
    expect(view.message).toMatch(/not active yet/i);
    expect(CHECKOUT_POLL_INTERVALS_MS.length).toBeGreaterThan(0);
  });

  it("maps final and error outcomes to distinct, non-success states", () => {
    expect(interpretVerifyResponse(200, { status: "CANCELLED" }).state).toBe("cancelled");
    expect(interpretVerifyResponse(200, { status: "EXPIRED" }).state).toBe("expired");
    expect(interpretVerifyResponse(200, { status: "FAILED" }).state).toBe("failed");
    expect(interpretVerifyResponse(400, { status: "FAILED", error: "Paystack verification did not match this payment." }).message).toMatch(/did not match/);
    expect(interpretVerifyResponse(401, { error: "Please sign in" }).state).toBe("signin");
    const unavailable = interpretVerifyResponse(502, { error: "Payment verification is temporarily unavailable." });
    expect(unavailable.state).toBe("error");
    expect(unavailable.poll).toBe(true);
    expect(interpretVerifyResponse(404, { error: "Payment not found." }).poll).toBe(false);
  });
});
