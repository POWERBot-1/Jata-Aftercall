import { describe, expect, it } from "vitest";
import { parseErpSafetyFlags } from "@/lib/erp/safety-config";

describe("ERP safety configuration", () => {
  it("defaults an absent configuration to the existing disabled switches", () => {
    expect(parseErpSafetyFlags(null)).toEqual({
      erpProEnabled: false,
      messagingKillSwitch: false,
      automationKillSwitch: false,
      valid: true,
      state: "DEFAULTED",
    });
  });

  it("parses explicit boolean safety flags", () => {
    expect(parseErpSafetyFlags(JSON.stringify({
      erpProEnabled: true,
      messagingKillSwitch: true,
      automationKillSwitch: false,
    }))).toEqual({
      erpProEnabled: true,
      messagingKillSwitch: true,
      automationKillSwitch: false,
      valid: true,
      state: "VALID",
    });
  });

  it.each(["{", "null", "[]", '"true"', '{"messagingKillSwitch":"false"}', '{"automationKillSwitch":1}'])(
    "fails closed for malformed or non-boolean configuration: %s",
    (value) => {
      const parsed = parseErpSafetyFlags(value);
      expect(parsed.valid).toBe(false);
      expect(parsed.state).toBe("INVALID");
      expect(parsed.messagingKillSwitch).toBe(true);
      expect(parsed.automationKillSwitch).toBe(true);
      expect(parsed.erpProEnabled).toBe(false);
    },
  );

  it("does not turn off one valid kill switch when the other is absent", () => {
    const parsed = parseErpSafetyFlags('{"messagingKillSwitch":true}');
    expect(parsed.messagingKillSwitch).toBe(true);
    expect(parsed.automationKillSwitch).toBe(false);
    expect(parsed.valid).toBe(true);
  });
});
