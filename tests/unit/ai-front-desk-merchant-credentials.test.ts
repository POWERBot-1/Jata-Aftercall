/**
 * Merchant payment credential protection (§10, §14).
 *
 * Merchant provider credentials are stored as an AES-256-GCM envelope and are never returned to
 * the browser, the AI context, or an API response. The key must come from the environment: a
 * key published in the repository would not protect anything, so production fails closed when
 * none is configured.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

/** `NODE_ENV` is typed as read-only by Next's environment types; tests may still set it. */
function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/merchant-payment");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("Merchant payment credentials (§10, §14)", () => {
  it("fails closed in production when no credential key is configured", async () => {
    delete process.env.MERCHANT_CREDENTIAL_KEY;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    setNodeEnv("production");

    const { encryptMerchantCredentials } = await loadModule();
    expect(() => encryptMerchantCredentials({ consumerSecret: "top_secret" })).toThrow(
      /MERCHANT_CREDENTIAL_KEY/,
    );
  });

  it("encrypts credentials into a versioned envelope that never contains the plaintext", async () => {
    process.env.MERCHANT_CREDENTIAL_KEY = "unit-test-merchant-key";
    setNodeEnv("test");

    const { encryptMerchantCredentials } = await loadModule();
    const envelope = encryptMerchantCredentials({ consumerSecret: "top_secret_value" });

    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope).not.toContain("top_secret_value");
    // v1 envelope: v1:<iv base64>:<auth tag base64>:<ciphertext base64>
    expect(envelope.split(":").length).toBe(4);
  });

  it("a configured key produces a different envelope than the shared development default", async () => {
    const plaintext = { consumerSecret: "same_secret" };

    delete process.env.MERCHANT_CREDENTIAL_KEY;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    setNodeEnv("development");
    const dev = await loadModule();
    const devEnvelope = dev.encryptMerchantCredentials(plaintext);

    process.env.MERCHANT_CREDENTIAL_KEY = "a-different-production-key";
    const prod = await loadModule();
    const prodEnvelope = prod.encryptMerchantCredentials(plaintext);

    expect(devEnvelope).not.toBe(prodEnvelope);
  });
});
