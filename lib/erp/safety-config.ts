export type ErpSafetyFlags = {
  erpProEnabled: boolean;
  messagingKillSwitch: boolean;
  automationKillSwitch: boolean;
  valid: boolean;
  state: "DEFAULTED" | "VALID" | "INVALID";
};

/**
 * Parse the persisted tenant feature flags used by messaging and automation.
 * A malformed document or non-boolean safety value pauses both execution paths.
 * Missing documents retain the historical explicit default (both switches off);
 * callers must still enforce provider configuration, consent, caps and approvals.
 */
export function parseErpSafetyFlags(value: string | null | undefined): ErpSafetyFlags {
  const defaults = {
    erpProEnabled: false,
    messagingKillSwitch: false,
    automationKillSwitch: false,
  } as const;

  if (value == null || value.trim() === "") {
    return { ...defaults, valid: true, state: "DEFAULTED" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      erpProEnabled: false,
      messagingKillSwitch: true,
      automationKillSwitch: true,
      valid: false,
      state: "INVALID",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      erpProEnabled: false,
      messagingKillSwitch: true,
      automationKillSwitch: true,
      valid: false,
      state: "INVALID",
    };
  }

  const record = parsed as Record<string, unknown>;
  const booleanKeys = ["erpProEnabled", "messagingKillSwitch", "automationKillSwitch"] as const;
  if (booleanKeys.some((key) => key in record && typeof record[key] !== "boolean")) {
    return {
      erpProEnabled: false,
      messagingKillSwitch: true,
      automationKillSwitch: true,
      valid: false,
      state: "INVALID",
    };
  }

  return {
    erpProEnabled: typeof record.erpProEnabled === "boolean" ? record.erpProEnabled : defaults.erpProEnabled,
    messagingKillSwitch: typeof record.messagingKillSwitch === "boolean" ? record.messagingKillSwitch : defaults.messagingKillSwitch,
    automationKillSwitch: typeof record.automationKillSwitch === "boolean" ? record.automationKillSwitch : defaults.automationKillSwitch,
    valid: true,
    state: "VALID",
  };
}
