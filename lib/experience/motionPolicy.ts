/** Hard presentation constraints, not a claimed device benchmark or arbitrary performance score. */
import type { RenderPreference } from "./renderMode";

export type MotionConstraints = {
  reducedMotion: boolean;
  saveData: boolean;
  effectiveType: string | null;
  deviceMemoryGB: number | null;
  cores: number | null;
  hidden: boolean;
  preferencesAvailable: boolean;
};

export function motionEligibility(preference: RenderPreference, signals: MotionConstraints, enabled = true): { allowed: boolean; reason: string } {
  if (!enabled || preference === "lite") return { allowed: false, reason: "owner-lite" };
  if (!signals.preferencesAvailable) return { allowed: false, reason: "preferences-unavailable" };
  if (signals.reducedMotion) return { allowed: false, reason: "reduced-motion" };
  if (signals.saveData) return { allowed: false, reason: "save-data" };
  if (["slow-2g", "2g", "3g"].includes(signals.effectiveType || "")) return { allowed: false, reason: "slow-connection" };
  if (signals.hidden) return { allowed: false, reason: "background" };
  if ((signals.deviceMemoryGB !== null && signals.deviceMemoryGB < 2) || (signals.cores !== null && signals.cores <= 2)) {
    return { allowed: false, reason: "low-resources" };
  }
  return { allowed: true, reason: "eligible" };
}
