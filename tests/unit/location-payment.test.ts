import { describe, expect, it } from "vitest";
import { getDirectionsUrl, parseCoordinates } from "@/lib/location";
import { failedPaymentStatus, subscriptionWindow, validatePaymentEvidence } from "@/lib/paymentVerification";

describe("business location validation and directions", () => {
  it("accepts coordinates at geographic bounds and optional blank pair", () => {
    expect(parseCoordinates(-90, 180)).toEqual({ valid: true, lat: -90, lng: 180 });
    expect(parseCoordinates("", "")).toEqual({ valid: true, lat: null, lng: null });
  });
  it("rejects partial, malformed and out-of-range coordinates", () => {
    expect(parseCoordinates(1, "").valid).toBe(false);
    expect(parseCoordinates("north", 36).valid).toBe(false);
    expect(parseCoordinates(90.1, 36).valid).toBe(false);
    expect(parseCoordinates(-1, 180.1).valid).toBe(false);
    expect(parseCoordinates(true, 36).valid).toBe(false);
    expect(parseCoordinates("0x1", 36).valid).toBe(false);
  });
  it("uses exact coordinates when present and saved text when coordinates are absent", () => {
    expect(getDirectionsUrl("Nairobi", -1.286389, 36.817223)).toContain("destination=-1.286389%2C36.817223");
    expect(getDirectionsUrl("Kitengela, Kenya", null, null)).toContain("Kitengela%2C%20Kenya");
  });
  it("does not make a directions link without saved location", () => {
    expect(getDirectionsUrl(null, null, null)).toBeNull();
    expect(getDirectionsUrl("  ", null, null)).toBeNull();
  });
});

describe("authoritative Paystack transaction evidence", () => {
  const payment = { reference: "jata_ref", amount: 99900, currency: "KES" };
  it("requires exact reference, server-stored amount and currency", () => {
    expect(validatePaymentEvidence(payment, { ...payment, status: "success" })).toEqual({ ok: true });
    expect(validatePaymentEvidence(payment, { ...payment, amount: 100, status: "success" })).toEqual({ ok: false, reason: "AMOUNT_MISMATCH" });
    expect(validatePaymentEvidence(payment, { ...payment, currency: "NGN", status: "success" })).toEqual({ ok: false, reason: "CURRENCY_MISMATCH" });
    expect(validatePaymentEvidence(payment, { ...payment, reference: "other", status: "success" })).toEqual({ ok: false, reason: "REFERENCE_MISMATCH" });
  });
  it("calculates activation and renewal expiry from the authoritative plan duration", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = subscriptionWindow(now, 30, null);
    expect(first.startAt).toEqual(now);
    expect(first.expiresAt.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    const renewed = subscriptionWindow(now, 365, { status: "ACTIVE", startAt: new Date("2025-12-01T00:00:00.000Z"), expiresAt: new Date("2026-02-01T00:00:00.000Z") });
    expect(renewed.startAt.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(renewed.expiresAt.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });

  it("maps cancellation and expiration without treating either as success", () => {
    expect(failedPaymentStatus("abandoned")).toBe("CANCELLED");
    expect(failedPaymentStatus("expired")).toBe("EXPIRED");
    expect(failedPaymentStatus("failed")).toBe("FAILED");
  });
});
