import { describe, expect, it } from "vitest";
import { getPlatformProviderInventory } from "@/lib/control/provider-readiness";

const configured = {
  PAYSTACK_SECRET_KEY: "sk_test_do_not_return",
  PAYSTACK_PUBLIC_KEY: "pk_test_do_not_return",
  R2_ACCOUNT_ID: "account-do-not-return",
  R2_ACCESS_KEY_ID: "access-do-not-return",
  R2_SECRET_ACCESS_KEY: "secret-do-not-return",
  R2_BUCKET: "jata-preview",
  R2_PUBLIC_BASE_URL: "https://media.example.invalid",
  TELNYX_PUBLIC_KEY: "public-do-not-return",
  TELNYX_API_KEY: "secret-do-not-return",
  TELNYX_CONNECTION_ID: "connection-do-not-return",
  TELNYX_PHONE_NUMBER: "+254700000000",
  VOICE_MEDIA_STREAM_URL: "wss://voice.example.invalid/media",
  VOICE_MEDIA_STREAM_TOKEN: "token-do-not-return",
  VOICE_AI_PROVIDER: "loopback",
};

describe("platform provider configuration inventory", () => {
  it("fails closed when configuration is absent and reports exact missing key names", () => {
    const result = getPlatformProviderInventory({}, new Date("2026-11-21T10:00:00.000Z"));
    expect(result.asOf).toBe("2026-11-21T10:00:00.000Z");
    expect(result.evidenceLevel).toBe("CONFIGURATION_PRESENCE_ONLY");
    expect(result.providers.paystack.state).toBe("AWAITING_CONFIGURATION");
    expect(result.providers.storage.missingConfiguration).toContain("R2_SECRET_ACCESS_KEY");
    expect(result.providers.voice.state).toBe("AWAITING_CONFIGURATION");
  });

  it("never upgrades configured credentials to verified provider health", () => {
    const result = getPlatformProviderInventory(configured);
    expect(result.providers.paystack).toEqual({
      state: "CONFIGURED_NOT_VERIFIED",
      configured: true,
      missingConfiguration: [],
    });
    expect(result.providers.storage.state).toBe("CONFIGURED_NOT_VERIFIED");
    expect(result.providers.voice.state).toBe("CONFIGURED_NOT_VERIFIED");
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("treats whitespace-only values as missing", () => {
    const result = getPlatformProviderInventory({ PAYSTACK_SECRET_KEY: "  " });
    expect(result.providers.paystack.missingConfiguration).toEqual([
      "PAYSTACK_SECRET_KEY",
      "PAYSTACK_PUBLIC_KEY",
    ]);
  });

  it("does not mark voice as configured without the speech provider credential", () => {
    const result = getPlatformProviderInventory({
      ...configured,
      VOICE_AI_PROVIDER: "openai",
      OPENAI_API_KEY: " ",
    });
    expect(result.providers.voice.missingConfiguration).toContain("OPENAI_API_KEY");
  });
  
  it("exposes voice feature gates without treating them as provider acceptance", () => {
    const result = getPlatformProviderInventory({
      ...configured,
      VOICE_CALLS_ENABLED: "true",
      VOICE_CUSTOMER_BILLING_ENABLED: "true",
      TELNYX_VOICE_LIVE_VERIFIED: "false",
    });
    expect(result.evidenceLevel).toBe("CONFIGURATION_PRESENCE_ONLY");
    expect(result.providers.voice.callGateEnabled).toBe(true);
    expect(result.providers.voice.customerBillingGateEnabled).toBe(true);
    expect(result.providers.voice.canReceiveCalls).toBe(false);
    expect(result.providers.voice.canSell).toBe(false);
    expect(result.providers.voice.state).toBe("CONFIGURED_NOT_VERIFIED");
  });

  it("does not infer enabled voice gates from absent flags", () => {
    const result = getPlatformProviderInventory(configured);
    expect(result.providers.voice.callGateEnabled).toBe(false);
    expect(result.providers.voice.customerBillingGateEnabled).toBe(false);
    expect(result.providers.voice.canReceiveCalls).toBe(false);
    expect(result.providers.voice.canSell).toBe(false);
  });
});
