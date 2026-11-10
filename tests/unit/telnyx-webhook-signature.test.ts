import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx/webhook-signature";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
const publicKeyBase64 = publicDer.subarray(publicDer.length - 32).toString("base64");

function signed(rawBody: string, timestamp: string) {
  return sign(null, Buffer.from(`${timestamp}|${rawBody}`, "utf8"), privateKey).toString("base64");
}

describe("Telnyx webhook signature verification", () => {
  it("accepts an authentic, fresh signature over the exact raw body", () => {
    const rawBody = '{"data":{"event_type":"call.initiated"}}';
    const timestamp = "1794000000";
    expect(verifyTelnyxWebhookSignature({
      rawBody, signature: signed(rawBody, timestamp), timestamp,
      publicKey: publicKeyBase64, nowSeconds: 1794000000,
    })).toEqual({ valid: true });
  });

  it("rejects a modified body", () => {
    const original = '{"data":{"event_type":"call.initiated"}}';
    const timestamp = "1794000000";
    expect(verifyTelnyxWebhookSignature({
      rawBody: '{"data":{"event_type":"call.hangup"}}',
      signature: signed(original, timestamp), timestamp,
      publicKey: publicKeyBase64, nowSeconds: 1794000000,
    })).toEqual({ valid: false, reason: "INVALID_SIGNATURE" });
  });

  it("rejects stale timestamps", () => {
    expect(verifyTelnyxWebhookSignature({
      rawBody: "{}", signature: "unused", timestamp: "1794000000",
      publicKey: publicKeyBase64, nowSeconds: 1794000301,
    })).toEqual({ valid: false, reason: "STALE_TIMESTAMP" });
  });

  it("fails closed when signing headers or key are absent", () => {
    expect(verifyTelnyxWebhookSignature({
      rawBody: "{}", signature: null, timestamp: null,
      publicKey: undefined, nowSeconds: 1794000000,
    })).toEqual({ valid: false, reason: "MISSING_HEADERS" });
  });
});
