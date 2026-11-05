import "server-only";

import { createPublicKey, verify as verifySignature } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEFAULT_TOLERANCE_SECONDS = 300;

export type TelnyxSignatureResult =
  | { valid: true }
  | { valid: false; reason: "MISSING_HEADERS" | "INVALID_TIMESTAMP" | "STALE_TIMESTAMP" | "INVALID_KEY" | "INVALID_SIGNATURE" };

/** Verify the exact raw HTTP body before JSON parsing. Telnyx signs timestamp|rawBody using Ed25519. */
export function verifyTelnyxWebhookSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): TelnyxSignatureResult {
  const { rawBody, signature, timestamp, publicKey } = input;
  if (!signature || !timestamp || !publicKey) return { valid: false, reason: "MISSING_HEADERS" };
  if (!/^\d{1,12}$/.test(timestamp)) return { valid: false, reason: "INVALID_TIMESTAMP" };

  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    return { valid: false, reason: "STALE_TIMESTAMP" };
  }

  try {
    const rawPublicKey = Buffer.from(publicKey.trim(), "base64");
    const signatureBytes = Buffer.from(signature.trim(), "base64");
    if (rawPublicKey.length !== 32 || signatureBytes.length !== 64) return { valid: false, reason: "INVALID_KEY" };
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: "der",
      type: "spki",
    });
    const signedPayload = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    return verifySignature(null, signedPayload, key, signatureBytes)
      ? { valid: true }
      : { valid: false, reason: "INVALID_SIGNATURE" };
  } catch {
    return { valid: false, reason: "INVALID_KEY" };
  }
}
