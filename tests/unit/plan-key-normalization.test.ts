/**
 * Plan keys are storage identifiers, not display copy.
 *
 * Regression: the admin plans route validated keys with `sanitizeText(..., 20)`. Two canonical
 * keys are longer than 20 characters, so creating them through `/admin/plans` silently wrote a
 * truncated key — `JATA_AUTOPILOT_ENTER` or `AI_BUSINESS_FRONT_DE` — that no product resolves.
 * These tests pin the round-trip guarantee and the validation that replaced it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePlanKey, PLAN_KEY_MAX_LENGTH } from "@/lib/planKey";
import { FALLBACK_PLANS } from "@/lib/pricing";

const root = path.resolve(__dirname, "../..");

/** Every plan key the repository ships as a product (FALLBACK_PLANS plus the ERP/Oro product). */
const CANONICAL_KEYS = [...FALLBACK_PLANS.map((plan) => plan.key), "ERP_PRO"];

describe("normalizePlanKey", () => {
  it("returns every canonical plan key exactly, including the two longer than the old 20-character limit", () => {
    for (const key of CANONICAL_KEYS) {
      expect(normalizePlanKey(key), key).toBe(key);
    }
    expect(normalizePlanKey("AI_BUSINESS_FRONT_DESK")).toHaveLength(22);
    expect(normalizePlanKey("JATA_AUTOPILOT_ENTERPRISE")).toHaveLength(25);
    expect(normalizePlanKey("JATA_AUTOPILOT_ENTERPRISE")).not.toBe("JATA_AUTOPILOT_ENTER");
  });

  it("normalises operator input to the stored form without changing its characters", () => {
    expect(normalizePlanKey("  jata_autopilot_pro  ")).toBe("JATA_AUTOPILOT_PRO");
    expect(normalizePlanKey("monthly")).toBe("MONTHLY");
  });

  it("rejects anything that is not a plan identifier instead of silently shortening it", () => {
    for (const input of ["", " ", "A", "MONTHLY PLAN", "MONTHLY-PLAN", "MONTHLY.PLAN", "MONTHLY<", "PLAN/1", null, undefined, 42, {}]) {
      expect(normalizePlanKey(input), String(input)).toBeNull();
    }
  });

  it("rejects a key longer than the documented maximum rather than truncating it", () => {
    const tooLong = `A${"B".repeat(PLAN_KEY_MAX_LENGTH)}`;
    expect(tooLong).toHaveLength(PLAN_KEY_MAX_LENGTH + 1);
    expect(normalizePlanKey(tooLong)).toBeNull();
    expect(normalizePlanKey(`A${"B".repeat(PLAN_KEY_MAX_LENGTH - 1)}`)).toHaveLength(PLAN_KEY_MAX_LENGTH);
  });

  it("accepts every exported canonical key at or below the maximum", () => {
    for (const key of CANONICAL_KEYS) {
      expect(key.length, key).toBeLessThanOrEqual(PLAN_KEY_MAX_LENGTH);
    }
  });
});

describe("admin plans route", () => {
  const source = readFileSync(path.join(root, "app/api/admin/plans/route.ts"), "utf8");

  it("validates keys with normalizePlanKey on both create and update", () => {
    expect(source).toContain('import { normalizePlanKey } from "@/lib/planKey"');
    expect(source.match(/normalizePlanKey\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("no longer truncates a key to 20 characters", () => {
    expect(source).not.toContain('sanitizeText((body.key || "").toUpperCase(), 20)');
    expect(source).not.toContain('sanitizeText(String(body.key).toUpperCase(), 20)');
    expect(source).not.toMatch(/body\.key[\s\S]{0,80},\s*20\)/);
  });
});
