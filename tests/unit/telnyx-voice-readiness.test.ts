import { describe, expect, it } from "vitest";
import { getVoiceReadiness, JATA_PUBLIC_VOICE_NUMBER } from "@/lib/telnyx/voice-readiness";
const configured = {
  TELNYX_PUBLIC_KEY: "public-key", TELNYX_API_KEY: "api-key",
  TELNYX_CONNECTION_ID: "connection-id", TELNYX_PHONE_NUMBER: "+1-test-number",
  VOICE_MEDIA_STREAM_URL: "wss://voice.example.invalid/media", VOICE_AI_PROVIDER: "configured-provider",
};
describe("Front Desk Voice readiness gates", () => {
  it("remains unavailable when provider configuration is missing", () => {
    const result = getVoiceReadiness({});
    expect(result.state).toBe("AWAITING_PROVIDER");
    expect(result.canReceiveCalls).toBe(false);
    expect(result.canSell).toBe(false);
    expect(result.publicNumber).toBe(JATA_PUBLIC_VOICE_NUMBER);
    expect(result.missingConfiguration).toHaveLength(6);
  });
  it("does not treat credentials alone as live call verification", () => {
    const result = getVoiceReadiness(configured);
    expect(result.state).toBe("CONFIGURED_NOT_VERIFIED");
    expect(result.canReceiveCalls).toBe(false);
    expect(result.canSell).toBe(false);
  });
  it("does not sell while customer billing approval is off", () => {
    const verified = { ...configured, TELNYX_VOICE_LIVE_VERIFIED: "true", VOICE_CALLS_ENABLED: "true" };
    expect(getVoiceReadiness(verified).canReceiveCalls).toBe(true);
    expect(getVoiceReadiness(verified).canSell).toBe(false);
  });
  it("allows service only after all explicit provider, verification and billing gates pass", () => {
    const result = getVoiceReadiness({
      ...configured, TELNYX_VOICE_LIVE_VERIFIED: "true",
      VOICE_CALLS_ENABLED: "true", VOICE_CUSTOMER_BILLING_ENABLED: "true",
    });
    expect(result.state).toBe("READY");
    expect(result.canReceiveCalls).toBe(true);
    expect(result.canSell).toBe(true);
  });
});
