/**
 * Provider readiness and commercial gates for Front Desk Voice.
 * Environment presence is necessary but never sufficient: live verification and customer
 * billing switches must be enabled only after real inbound call evidence exists.
 */
export type VoiceReadinessState = "AWAITING_PROVIDER" | "CONFIGURED_NOT_VERIFIED" | "READY";
export type VoiceReadiness = {
  state: VoiceReadinessState;
  canReceiveCalls: boolean;
  canSell: boolean;
  publicNumber: string;
  missingConfiguration: string[];
  operatorMessage: string;
};
type VoiceEnvironment = Partial<Record<
  | "TELNYX_PUBLIC_KEY" | "TELNYX_API_KEY" | "TELNYX_CONNECTION_ID"
  | "TELNYX_PHONE_NUMBER" | "VOICE_MEDIA_STREAM_URL" | "VOICE_AI_PROVIDER"
  | "VOICE_MEDIA_STREAM_TOKEN" | "OPENAI_API_KEY"
  | "TELNYX_VOICE_LIVE_VERIFIED" | "VOICE_CALLS_ENABLED" | "VOICE_CUSTOMER_BILLING_ENABLED",
  string
>>;
const REQUIRED_PROVIDER_CONFIG = [
  "TELNYX_PUBLIC_KEY", "TELNYX_API_KEY", "TELNYX_CONNECTION_ID",
  "TELNYX_PHONE_NUMBER", "VOICE_MEDIA_STREAM_URL", "VOICE_AI_PROVIDER",
  // Shared secret that authenticates the media-worker WebSocket handshake (per-call HMAC).
  // Without it the worker refuses every connection, so it must be configured before calls.
  "VOICE_MEDIA_STREAM_TOKEN",
] as const;
export const JATA_PUBLIC_VOICE_NUMBER = "+254724317010";
export function getVoiceReadiness(env: VoiceEnvironment = process.env as VoiceEnvironment): VoiceReadiness {
  const missingConfiguration: string[] = REQUIRED_PROVIDER_CONFIG.filter((key) => !env[key]?.trim());
  // The selected speech provider's own credentials are part of readiness: a configured
  // provider id without its key would refuse every media session after the call was answered.
  if ((env.VOICE_AI_PROVIDER ?? "").trim() === "openai" && !(env.OPENAI_API_KEY ?? "").trim()) {
    missingConfiguration.push("OPENAI_API_KEY");
  }
  const providerConfigured = missingConfiguration.length === 0;
  const liveVerified = env.TELNYX_VOICE_LIVE_VERIFIED === "true";
  const callsEnabled = env.VOICE_CALLS_ENABLED === "true";
  const billingEnabled = env.VOICE_CUSTOMER_BILLING_ENABLED === "true";
  const canReceiveCalls = providerConfigured && liveVerified && callsEnabled;
  const canSell = canReceiveCalls && billingEnabled;
  const state: VoiceReadinessState = canSell ? "READY" : providerConfigured ? "CONFIGURED_NOT_VERIFIED" : "AWAITING_PROVIDER";
  return {
    state, canReceiveCalls, canSell, publicNumber: JATA_PUBLIC_VOICE_NUMBER,
    missingConfiguration: [...missingConfiguration],
    operatorMessage: canSell
      ? "Provider configuration and live verification gates are marked complete."
      : providerConfigured
        ? "Provider configuration is present, but live call verification and/or customer billing approval remains disabled."
        : "Awaiting Telnyx voice credentials, inbound number, media endpoint and speech provider configuration.",
  };
}
