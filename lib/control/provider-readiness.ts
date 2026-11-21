import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";

export type ProviderConfigurationState = "AWAITING_CONFIGURATION" | "CONFIGURED_NOT_VERIFIED";
export type ProviderConfiguration = {
  state: ProviderConfigurationState;
  configured: boolean;
  missingConfiguration: string[];
};
export type PlatformProviderInventory = {
  asOf: string;
  evidenceLevel: "CONFIGURATION_PRESENCE_ONLY";
  providers: {
    paystack: ProviderConfiguration;
    storage: ProviderConfiguration;
    voice: ProviderConfiguration & {
      /** Derived from explicit feature-gate flags; not proof of a successful call. */
      callGateEnabled: boolean;
      /** Derived from explicit billing-gate flags; not proof of payment settlement. */
      customerBillingGateEnabled: boolean;
      canReceiveCalls: boolean;
      canSell: boolean;
    };
  };
};

type Environment = Record<string, string | undefined>;

const PAYSTACK_REQUIRED = ["PAYSTACK_SECRET_KEY", "PAYSTACK_PUBLIC_KEY"] as const;
const R2_REQUIRED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const;

function inspect(env: Environment, required: readonly string[]): ProviderConfiguration {
  const missingConfiguration = required.filter((key) => !env[key]?.trim());
  return {
    state: missingConfiguration.length ? "AWAITING_CONFIGURATION" : "CONFIGURED_NOT_VERIFIED",
    configured: missingConfiguration.length === 0,
    missingConfiguration,
  };
}

/**
 * Reports only whether server-side configuration keys are present and which
 * explicit voice feature gates are enabled. It never reports provider health:
 * successful connectivity, call acceptance, delivery and settlement require
 * separate provider-native evidence.
 */
export function getPlatformProviderInventory(
  env: Environment = process.env,
  now: Date = new Date(),
): PlatformProviderInventory {
  const voice = getVoiceReadiness(env);
  return {
    asOf: now.toISOString(),
    evidenceLevel: "CONFIGURATION_PRESENCE_ONLY",
    providers: {
      paystack: inspect(env, PAYSTACK_REQUIRED),
      storage: inspect(env, R2_REQUIRED),
      voice: {
        ...inspect(env, [
          "TELNYX_PUBLIC_KEY",
          "TELNYX_API_KEY",
          "TELNYX_CONNECTION_ID",
          "TELNYX_PHONE_NUMBER",
          "VOICE_MEDIA_STREAM_URL",
          "VOICE_MEDIA_STREAM_TOKEN",
          "VOICE_AI_PROVIDER",
          ...(env.VOICE_AI_PROVIDER?.trim() === "openai" ? ["OPENAI_API_KEY"] : []),
        ]),
        callGateEnabled: env.VOICE_CALLS_ENABLED === "true",
        customerBillingGateEnabled: env.VOICE_CUSTOMER_BILLING_ENABLED === "true",
        canReceiveCalls: voice.canReceiveCalls,
        canSell: voice.canSell,
      },
    },
  };
}
