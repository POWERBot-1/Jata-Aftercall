/**
 * Immersive (3D) eligibility policy (Immersive Website Engine, Phase 5)
 *
 * 3D is optional. A visitor gets it only when every condition below holds. Any failed condition
 * leaves them on Motion, and Motion always leaves them with the full content. Nothing here
 * changes what a customer can read, buy or contact.
 *
 * Conditions, in order:
 *   1. The feature is switched on by server configuration AND a durable storage provider is active.
 *   2. The visitor did not ask for less motion, is not on Save-Data, and is not on a slow connection.
 *   3. WebGL works.
 *   4. The device reports at least 4 GB of memory and 4 CPU cores. Unknown memory is NOT treated as
 *      capable: iOS Safari does not report it, so 3D stays off there by design until it can be verified.
 *   5. A validated model exists, is within the size ceiling, and is served over HTTPS.
 */

import type { CapabilitySignals } from "../renderMode";
import { INLINE_PROVIDER_ID } from "@/lib/storage/inline";
import { resolveStorageProvider } from "@/lib/storage";

export const IMMERSIVE_LIMITS = {
  minMemoryGB: 4,
  minCores: 4,
  maxModelBytes: 8 * 1024 * 1024,
} as const;

export type ImmersiveAsset = { url: string; bytes: number };

export type ImmersiveEligibility = { eligible: boolean; reason: string };

/** The feature is off unless the server explicitly enables it AND durable storage is active. */
export function immersiveFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.JATA_IMMERSIVE_ENABLED || "").trim().toLowerCase() !== "true") return false;
  try {
    const provider = resolveStorageProvider(env);
    return provider.id !== INLINE_PROVIDER_ID && provider.capabilities.durable && provider.capabilities.models;
  } catch {
    return false;
  }
}

export function immersiveEligibility(input: {
  enabled: boolean;
  signals: CapabilitySignals;
  asset: ImmersiveAsset | null;
}): ImmersiveEligibility {
  const { signals, asset } = input;
  if (!input.enabled) return { eligible: false, reason: "immersive-disabled" };
  if (signals.reducedMotion) return { eligible: false, reason: "reduced-motion" };
  if (signals.saveData) return { eligible: false, reason: "save-data" };
  if (signals.effectiveType === "slow-2g" || signals.effectiveType === "2g" || signals.effectiveType === "3g") {
    return { eligible: false, reason: "slow-connection" };
  }
  if (!signals.webgl) return { eligible: false, reason: "no-webgl" };
  if (signals.deviceMemoryGB === null) return { eligible: false, reason: "memory-unknown" };
  if (signals.deviceMemoryGB < IMMERSIVE_LIMITS.minMemoryGB) return { eligible: false, reason: "low-memory" };
  if (signals.hardwareConcurrency !== null && signals.hardwareConcurrency < IMMERSIVE_LIMITS.minCores) {
    return { eligible: false, reason: "low-cores" };
  }
  if (!asset) return { eligible: false, reason: "no-model" };
  if (!Number.isFinite(asset.bytes) || asset.bytes > IMMERSIVE_LIMITS.maxModelBytes) {
    return { eligible: false, reason: "model-too-large" };
  }
  if (!/^https:\/\/[^\s]+$/i.test(asset.url)) return { eligible: false, reason: "model-url-not-https" };
  return { eligible: true, reason: "eligible" };
}
