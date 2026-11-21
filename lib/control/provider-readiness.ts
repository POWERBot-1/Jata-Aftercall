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
    voice: ProviderConfiguration;
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

function inspect(
  env: Environment,
  required: readonly string[],
): ProviderConfiguration {
  const missingConfiguration = required.filter((key) => !env[key]?.trim());
  return {
    state: missingConfiguration.length ? "AWAITING_CONFIGURATION" : "CONFIGURED_NOT_VERIFIED",
    configured: missingConfiguration.length === 0,
    missingConfiguration,
  };
}

/**
 * Reports only whether server-side configuration keys are present.
 * This is deliberately not a provider health check and never returns secret values.
 * A configured provider remains NOT VERIFIED until a provider-native probe and
 * independent operational evidence are implemented.
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
        state: voice.missingConfiguration.length ? "AWAITING_CONFIGURATION" : "CONFIGURED_NOT_VERIFIED",
        configured: voice.missingConfiguration.length === 0,
        missingConfiguration: voice.missingConfiguration,
      },
    },
  };
}
