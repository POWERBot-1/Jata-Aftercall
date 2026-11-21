import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAG_KEYS,
  resolveFeatureFlag,
  resolveFeatureFlagRegistry,
} from "@/lib/feature-flags";

describe("fail-closed feature flag registry", () => {
  it("keeps every registered feature disabled when no operator configuration is supplied", () => {
    const decisions = resolveFeatureFlagRegistry({});
    expect(Object.keys(decisions)).toEqual([...FEATURE_FLAG_KEYS]);
    expect(Object.values(decisions).every((decision) =>
      decision.enabled === false && decision.reason === "GLOBAL_KILL_SWITCH_ACTIVE")).toBe(true);
  });

  it("requires the global kill switch to be explicitly cleared and a feature to be exactly true", () => {
    expect(resolveFeatureFlag("AI_FRONT_DESK_AUTOPILOT", {
      JATA_GLOBAL_KILL_SWITCH: "false",
      JATA_FEATURE_AI_FRONT_DESK_AUTOPILOT: "true",
    })).toMatchObject({ enabled: true, reason: "ENABLED_EXPLICITLY" });
  });

  it("lets the global kill switch override an explicitly enabled feature", () => {
    expect(resolveFeatureFlag("BOS_AUTOMATIONS", {
      JATA_GLOBAL_KILL_SWITCH: "true",
      JATA_FEATURE_BOS_AUTOMATIONS: "true",
    })).toMatchObject({ enabled: false, reason: "GLOBAL_KILL_SWITCH_ACTIVE" });
  });

  it("rejects truthy-looking, malformed and case-variant values", () => {
    for (const value of ["1", "yes", "TRUE", " true ", "on", ""]) {
      expect(resolveFeatureFlag("TAPNET_PROVIDER_ACTIVATION", {
        JATA_GLOBAL_KILL_SWITCH: "false",
        JATA_FEATURE_TAPNET_PROVIDER_ACTIVATION: value,
      })).toMatchObject({ enabled: false, reason: "INVALID_FLAG_VALUE" });
    }
  });

  it("keeps an unset or explicitly false feature disabled after the global switch is cleared", () => {
    expect(resolveFeatureFlag("TELNYX_LIVE_CALLS", { JATA_GLOBAL_KILL_SWITCH: "false" }))
      .toMatchObject({ enabled: false, reason: "FLAG_NOT_EXPLICITLY_ENABLED" });
    expect(resolveFeatureFlag("TELNYX_LIVE_CALLS", {
      JATA_GLOBAL_KILL_SWITCH: "false",
      JATA_FEATURE_TELNYX_LIVE_CALLS: "false",
    })).toMatchObject({ enabled: false, reason: "FLAG_NOT_EXPLICITLY_ENABLED" });
  });

  it("fails closed for unregistered keys", () => {
    expect(resolveFeatureFlag("UNRECOGNIZED_FEATURE", {
      JATA_GLOBAL_KILL_SWITCH: "false",
      JATA_FEATURE_UNRECOGNIZED_FEATURE: "true",
    })).toMatchObject({ enabled: false, reason: "UNKNOWN_FLAG" });
  });

  it("does not enable financial or control mutation flags by implication", () => {
    const decisions = resolveFeatureFlagRegistry({
      JATA_GLOBAL_KILL_SWITCH: "false",
      JATA_FEATURE_AI_FRONT_DESK_AUTOPILOT: "true",
    });
    expect(decisions.FINANCIAL_COMMISSION_ACCRUAL.enabled).toBe(false);
    expect(decisions.FINANCIAL_PAYOUTS.enabled).toBe(false);
    expect(decisions.CONTROL_MUTATIONS.enabled).toBe(false);
  });
});
