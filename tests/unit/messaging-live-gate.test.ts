/**
 * Live messaging is fail-closed (release blocker E5).
 *
 * E5 says no live provider is connected in this release. The code says the same thing, but until
 * this file existed nothing asserted it: `UnconfiguredLiveProvider` and `liveProviderReady` were
 * exported and used by the dispatch route without a single test. A reader could only take the
 * comment's word for it.
 *
 * What is proven here is deliberately narrow: an unknown provider key resolves to a live adapter
 * that reports `configured: false`, refuses every send with `PROVIDER_NOT_CONFIGURED`, refuses
 * callbacks, and never reports healthy. It is not a claim that a real provider would work — no real
 * provider exists to test (E5 stays open) — it is a claim that the product cannot pretend to send.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  MockMessagingProvider,
  getMessagingProvider,
  liveProviderReady,
  registerProvider,
  resetProviderRegistry,
  verifyHmacSignature,
  signCallback,
  type MessagingProviderAdapter,
  type SendRequest,
} from "@/lib/messaging/providers";

const request: SendRequest = {
  to: "+254700000000",
  body: "Hello",
  senderId: "JATA",
  idempotencyKey: "idem-live-gate-1",
  channel: "SMS",
};

function configuredLiveAdapter(): MessagingProviderAdapter {
  return {
    key: "configured-live",
    channel: "SMS",
    live: true,
    configured: true,
    send: async () => ({ outcome: "SENT", providerMessageId: "real-1" }),
    status: async () => ({ status: "DELIVERED" }),
    health: async () => ({ ok: true, state: "HEALTHY", checkedAt: new Date(), message: "ok" }),
    verifyCallback: () => ({ ok: true, reason: "signed" }),
    parseCallbacks: () => [],
  };
}

describe("live messaging gate", () => {
  beforeEach(() => {
    resetProviderRegistry();
    delete process.env.MESSAGING_LIVE_ENABLED;
  });

  it("resolves an unknown provider key to a live adapter that is NOT configured", () => {
    const provider = getMessagingProvider("africastalking");
    expect(provider.live).toBe(true);
    expect(provider.configured).toBe(false);
  });

  it("refuses the send with PROVIDER_NOT_CONFIGURED and says nothing was sent", async () => {
    const result = await getMessagingProvider("africastalking").send(request);
    expect(result.outcome).toBe("FAILED");
    expect(result.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.retryable).toBe(false);
    expect(String(result.message)).toMatch(/nothing was sent/i);
    // The dangerous outcome would be a fake id that later looks like a delivery.
    expect(result.providerMessageId ?? null).toBeNull();
  });

  it("refuses provider callbacks when nothing is connected", () => {
    const verdict = getMessagingProvider("africastalking").verifyCallback("{}", {});
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/cannot be verified/i);
    expect(getMessagingProvider("africastalking").parseCallbacks("{}", {})).toEqual([]);
  });

  it("reports NOT_CONFIGURED health rather than healthy", async () => {
    const health = await getMessagingProvider("africastalking").health();
    expect(health.ok).toBe(false);
    expect(health.state).toBe("NOT_CONFIGURED");
  });

  it("keeps liveProviderReady false for every unregistered key, and true only for a configured live adapter", () => {
    expect(liveProviderReady("africastalking")).toBe(false);
    expect(liveProviderReady("mock")).toBe(false);
    expect(liveProviderReady("live-unconfigured")).toBe(false);
    registerProvider(configuredLiveAdapter());
    expect(liveProviderReady("configured-live")).toBe(true);
    // Registering one adapter must not make another key look ready.
    expect(liveProviderReady("africastalking")).toBe(false);
  });

  it("the sandbox provider is not live, so a test campaign can never be read as a real send", async () => {
    const sandbox = getMessagingProvider("sandbox");
    expect(sandbox.live).toBe(false);
    expect(sandbox instanceof MockMessagingProvider).toBe(true);
    // The registry hands back the same key it was asked for, and the sandbox is registered as such.
    expect(getMessagingProvider("mock").key).toBe("mock");
  });

  it("accepts only a complete SHA-256 HMAC, rejecting malformed hex and replay over changed bytes", () => {
    const secret = "fixture-secret-not-a-production-credential";
    const body = '{"events":[{"id":"fixture"}]}';
    const signature = signCallback(body, secret);
    for (const valid of [signature, signature.toUpperCase(), `sha256=${signature}`]) {
      expect(verifyHmacSignature(body, { "x-signature": valid }, secret).ok).toBe(true);
    }
    for (const invalid of [signature + "zz", signature + "0", signature + "00", signature.slice(0, -1), "0" + signature.slice(1), `sha256=${signature}garbage`, ` ${signature}`, `${signature}\n`]) {
      expect(verifyHmacSignature(body, { "x-signature": invalid }, secret).ok).toBe(false);
    }
    expect(verifyHmacSignature(body, { "x-jata-signature": signature }, secret).ok).toBe(true);
    expect(verifyHmacSignature(body, { "x-hub-signature-256": `sha256=${signature}` }, secret).ok).toBe(true);
    expect(verifyHmacSignature(body, { "x-jata-signature": signature + "zz" }, secret).ok).toBe(false);
    expect(verifyHmacSignature(body, { "x-hub-signature-256": `sha256=${signature}0` }, secret).ok).toBe(false);
    expect(verifyHmacSignature(body + " ", { "x-signature": signature }, secret).ok).toBe(false);
    expect(verifyHmacSignature(body, { "x-signature": signature }, "different-key").ok).toBe(false);
  });

  it("a callback with no secret is rejected even when a live adapter claims to verify it", () => {
    // verifyHmacSignature is the shared HMAC gate; an unset secret must never mean "trust".
    const verdict = verifyHmacSignature("{}", {}, "");
    expect(verdict.ok).toBe(false);
  });
});
