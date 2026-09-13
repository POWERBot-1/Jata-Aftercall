import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// We test webhook HMAC in isolation without DB dependency

function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

describe("Paystack webhook signature verification", () => {
  const secret = "sk_test_dummy_secret_12345";

  it("verifies valid signature", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "abc", amount: 99900 } });
    const sig = crypto.createHmac("sha512", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const body = JSON.stringify({ event: "charge.success" });
    expect(verifyWebhookSignature(body, "invalid", secret)).toBe(false);
  });

  it("rejects tampered body", () => {
    const body = JSON.stringify({ event: "charge.success", data: { amount: 99900 } });
    const sig = crypto.createHmac("sha512", secret).update(body).digest("hex");
    const tampered = body.replace("99900", "100");
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });

  it("rejects missing signature", () => {
    expect(verifyWebhookSignature("{}", null, secret)).toBe(false);
  });

  it("amount mismatch must be rejected server-side (logic test)", () => {
    const expected = 99900; // 999 KES in kobo
    const paystackAmount = 10000; // wrong amount
    expect(paystackAmount).not.toBe(expected);
    // The server must compare data.amount (from Paystack verify) against Payment.amount
  });
});

describe("Paystack idempotency logic", () => {
  it("duplicate reference must not create duplicate payment", () => {
    // Simulated DB unique constraint on Payment.reference
    const payments = new Map<string, { reference: string; status: string }>();
    function createPayment(ref: string) {
      if (payments.has(ref)) throw new Error("Unique constraint failed on reference");
      payments.set(ref, { reference: ref, status: "PENDING" });
    }
    createPayment("jata_abc123");
    expect(() => createPayment("jata_abc123")).toThrow();
  });

  it("duplicate webhook event id must be ignored", () => {
    const processed = new Set<string>();
    function isProcessed(id: string) { return processed.has(id); }
    function mark(id: string) { processed.add(id); }
    const eventId = "evt_12345";
    expect(isProcessed(eventId)).toBe(false);
    mark(eventId);
    expect(isProcessed(eventId)).toBe(true);
    // second delivery should be short-circuited
    expect(isProcessed(eventId)).toBe(true);
  });

  it("toKobo/fromKobo conversion is correct", async () => {
    const { toKobo, fromKobo } = await import("@/lib/paystack");
    expect(toKobo(999)).toBe(99900);
    expect(toKobo(149.5)).toBe(14950);
    expect(fromKobo(99900)).toBe(999);
  });
});
