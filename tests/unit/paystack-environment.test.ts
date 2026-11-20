import { afterEach, describe, expect, it } from "vitest";
import { readPaystackConfig } from "@/lib/payments/config";

const originalSecret = process.env.PAYSTACK_SECRET_KEY;
const originalPublic = process.env.PAYSTACK_PUBLIC_KEY;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  if (originalPublic === undefined) delete process.env.PAYSTACK_PUBLIC_KEY;
  else process.env.PAYSTACK_PUBLIC_KEY = originalPublic;
});

describe("Paystack payment environment classification", () => {
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
