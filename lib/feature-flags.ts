/**
 * Pure, fail-closed feature-flag policy.
 *
 * Callers must pass an explicit environment map from server-side code. This module
 * never reads process.env, performs I/O, or enables a feature by default.
 * Product integrations must still gate their own server-side actions.
 */
export const FEATURE_FLAG_KEYS = [
  "AI_FRONT_DESK_AUTOPILOT",
  "BOS_AUTOMATIONS",
  "FINANCIAL_COMMISSION_ACCRUAL",
  "FINANCIAL_PAYOUTS",
  "TAPNET_PROVIDER_ACTIVATION",
  "TELNYX_LIVE_CALLS",
  "CONTROL_MUTATIONS",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlagReason =
  | "ENABLED_EXPLICITLY"
  | "GLOBAL_KILL_SWITCH_ACTIVE"
  | "FLAG_NOT_EXPLICITLY_ENABLED"
  | "INVALID_FLAG_VALUE"
  | "UNKNOWN_FLAG";

export type FeatureFlagDecision = {
  key: string;
  enabled: boolean;
  reason: FeatureFlagReason;
};

export type FeatureFlagEnvironment = Readonly<Record<string, string | undefined>>;

const knownFlags = new Set<string>(FEATURE_FLAG_KEYS);

/**
 * The global kill switch is considered active unless the operator explicitly
 * sets JATA_GLOBAL_KILL_SWITCH=false. Per-flag enablement requires exact "true".
 */
export function resolveFeatureFlag(
  key: string,
  environment: FeatureFlagEnvironment,
): FeatureFlagDecision {
  if (!knownFlags.has(key)) {
    return { key, enabled: false, reason: "UNKNOWN_FLAG" };
  }

  if (environment.JATA_GLOBAL_KILL_SWITCH !== "false") {
    return { key, enabled: false, reason: "GLOBAL_KILL_SWITCH_ACTIVE" };
  }

  const value = environment[`JATA_FEATURE_${key}`];
  if (value === "true") {
    return { key, enabled: true, reason: "ENABLED_EXPLICITLY" };
  }
  if (value === undefined || value === "false") {
    return { key, enabled: false, reason: "FLAG_NOT_EXPLICITLY_ENABLED" };
  }
  return { key, enabled: false, reason: "INVALID_FLAG_VALUE" };
}

export function resolveFeatureFlagRegistry(
  environment: FeatureFlagEnvironment,
): Record<FeatureFlagKey, FeatureFlagDecision> {
  return Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, resolveFeatureFlag(key, environment)]),
  ) as Record<FeatureFlagKey, FeatureFlagDecision>;
}
