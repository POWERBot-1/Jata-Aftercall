import { describe, expect, it } from "vitest";
import { mjengoFeatureEnabled } from "@/lib/mjengo/entitlement";

describe("MJENGO production feature gate", () => {
  it("preserves the existing production availability when no disable flag is set", () => {
    expect(mjengoFeatureEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("allows an explicit operator disable", () => {
    expect(mjengoFeatureEnabled({
      NODE_ENV: "production",
      MJENGO_OS_DISABLED: "true",
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("does not disable MJENGO for an explicit false value", () => {
    expect(mjengoFeatureEnabled({
      NODE_ENV: "production",
      MJENGO_OS_DISABLED: "false",
    } as NodeJS.ProcessEnv)).toBe(true);
  });
});
