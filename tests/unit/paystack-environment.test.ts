import { afterEach, describe, expect, it } from "vitest";
import { getPaystackSecretKey, readPaystackConfig } from "@/lib/payments/config";

const originalSecret = process.env.PAYSTACK_SECRET_KEY;
const originalPublic = process.env.PAYSTACK_PUBLIC_KEY;
const originalTestSecret = process.env.PAYSTACK_TEST_SECRET_KEY;
const originalTestPublic = process.env.PAYSTACK_TEST_PUBLIC_KEY;
const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  if (originalPublic === undefined) delete process.env.PAYSTACK_PUBLIC_KEY;
  else process.env.PAYSTACK_PUBLIC_KEY = originalPublic;
  if (originalTestSecret === undefined) delete process.env.PAYSTACK_TEST_SECRET_KEY;
  else process.env.PAYSTACK_TEST_SECRET_KEY = originalTestSecret;
  if (originalTestPublic === undefined) delete process.env.PAYSTACK_TEST_PUBLIC_KEY;
  else process.env.PAYSTACK_TEST_PUBLIC_KEY = originalTestPublic;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("Paystack payment environment classification", () => {
  it("selects the test secret for Preview runtime API calls", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    process.env.PAYSTACK_TEST_SECRET_KEY = "sk_test_fixture";
    expect(getPaystackSecretKey()).toBe("sk_test_fixture");
  });

  it("returns no secret for Preview when only the shared live key exists", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    delete process.env.PAYSTACK_TEST_SECRET_KEY;
    expect(getPaystackSecretKey()).toBe("");
  });

  it("never lets Preview fall back to the shared live credential pair", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_live_fixture";
    delete process.env.PAYSTACK_TEST_SECRET_KEY;
    delete process.env.PAYSTACK_TEST_PUBLIC_KEY;
    expect(readPaystackConfig()).toMatchObject({
      mode: "NONE",
      ready: false,
      missing: ["PAYSTACK_TEST_SECRET_KEY"],
      webhookConfigured: false,
    });
  });

  it("uses only the dedicated test key pair in Preview", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_live_fixture";
    process.env.PAYSTACK_TEST_SECRET_KEY = "sk_test_fixture";
    process.env.PAYSTACK_TEST_PUBLIC_KEY = "pk_test_fixture";
    expect(readPaystackConfig()).toMatchObject({ mode: "TEST", ready: true, webhookConfigured: true });
  });

  it("refuses test credentials in Production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_test_fixture";
    expect(readPaystackConfig()).toMatchObject({
      mode: "NONE",
      ready: false,
      missing: ["PAYSTACK_LIVE_SECRET_KEY_REQUIRED"],
      webhookConfigured: false,
    });
  });

  it("requires a live secret in Production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_live_fixture";
    expect(readPaystackConfig()).toMatchObject({ mode: "LIVE", ready: true, webhookConfigured: true });
  });

  it("classifies only an explicit test secret prefix as TEST", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
    expect(readPaystackConfig()).toMatchObject({ mode: "TEST", ready: true });
  });

  it("classifies only an explicit live secret prefix as LIVE", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    expect(readPaystackConfig()).toMatchObject({ mode: "LIVE", ready: true });
  });

  it("refuses an unrecognized non-empty key instead of silently calling it TEST", () => {
    process.env.PAYSTACK_SECRET_KEY = "fixture-secret-without-provider-prefix";
    expect(readPaystackConfig()).toMatchObject({
      mode: "NONE",
      ready: false,
      missing: ["PAYSTACK_SECRET_KEY_PREFIX"],
    });
  });

  it("accepts a matching test secret/public key pair", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_test_fixture";
    expect(readPaystackConfig()).toMatchObject({ mode: "TEST", ready: true, webhookConfigured: true });
  });

  it("accepts a matching live secret/public key pair", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_live_fixture";
    expect(readPaystackConfig()).toMatchObject({ mode: "LIVE", ready: true, webhookConfigured: true });
  });

  it("rejects a test secret paired with a live public key", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_live_fixture";
    expect(readPaystackConfig()).toMatchObject({
      mode: "NONE",
      ready: false,
      missing: ["PAYSTACK_KEY_MODE_MISMATCH"],
      webhookConfigured: false,
    });
  });

  it("rejects a live secret paired with a test public key", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_test_fixture";
    expect(readPaystackConfig()).toMatchObject({
      mode: "NONE",
      ready: false,
      missing: ["PAYSTACK_KEY_MODE_MISMATCH"],
    });
  });

  it("does not infer mode from a public key or from an absent secret", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_PUBLIC_KEY = "pk_test_fixture";
    expect(readPaystackConfig()).toMatchObject({
      mode: "NONE",
      ready: false,
      missing: ["PAYSTACK_SECRET_KEY"],
    });
  });
});
