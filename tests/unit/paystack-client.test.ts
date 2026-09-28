import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { initializeTransaction, verifyTransaction, verifyWebhookSignature } from "@/lib/paystack";

function providerResponse(data: unknown) {
  return { ok: true, json: async () => data } as Response;
}

describe("Paystack server client", () => {
  beforeEach(() => vi.stubEnv("PAYSTACK_SECRET_KEY", "test-only-not-a-credential"));
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("initializes only a matching reference and a hosted Paystack URL", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => providerResponse({ status: true, data: { reference: "jata-ref", authorization_url: "https://checkout.paystack.com/session", access_code: "opaque" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(initializeTransaction({ email: "a@example.test", amount: 14900, currency: "KES", reference: "jata-ref" })).resolves.toMatchObject({ reference: "jata-ref" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/transaction/initialize"), expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ amount: "14900", currency: "KES", reference: "jata-ref" });
  });

  it("rejects provider redirects outside Paystack and mismatched init references", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse({ status: true, data: { reference: "other", authorization_url: "https://attacker.example/steal", access_code: "opaque" } })));
    await expect(initializeTransaction({ email: "a@example.test", amount: 14900, currency: "KES", reference: "jata-ref" })).rejects.toThrow("PAYSTACK_INITIALIZATION_FAILED");
  });

  it("rejects unsupported references and any non-KES initialization currency before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(initializeTransaction({ email: "a@example.test", amount: 14900, currency: "KES", reference: "jata_bad" })).rejects.toThrow("PAYSTACK_INITIALIZATION_INPUT_INVALID");
    await expect(initializeTransaction({ email: "a@example.test", amount: 14900, currency: "USD" as "KES", reference: "jata-valid" })).rejects.toThrow("PAYSTACK_INITIALIZATION_INPUT_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed transaction verification responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse({ status: true, data: { status: "success", reference: "jata-ref", amount: "14900", currency: "KES" } })));
    await expect(verifyTransaction("jata-ref")).rejects.toThrow("PAYSTACK_VERIFICATION_FAILED");
  });

  it("checks the actual webhook signature using a timing-safe comparison", () => {
    const raw = JSON.stringify({ event: "charge.success", data: { reference: "jata-ref" } });
    const signature = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(raw).digest("hex");
    expect(verifyWebhookSignature(raw, signature)).toBe(true);
    expect(verifyWebhookSignature(`${raw} `, signature)).toBe(false);
    expect(verifyWebhookSignature(raw, null)).toBe(false);
  });
});
