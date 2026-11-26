import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");

describe("narrow storefront hero/action-bar clearance", () => {
  it("reserves the measured fixed action-bar height plus safe-area and CTA clearance", () => {
    const start = css.lastIndexOf("320px viewport correction");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start);
    expect(rule).toContain("@media (max-width: 360px)");
    expect(rule).toContain(".eb-scope:has(.eb-actionbar) .eb-hero__content");
    expect(rule).toContain(".eb-scope:has(.eb-actionbar) .eb-hero--split .eb-hero__grid");
    expect((rule.match(/padding-top: 0 !important;/g) ?? [])).toHaveLength(2);
    expect((rule.match(/padding-bottom: calc\(var\(--eb-actionbar-h, 10\.5rem\) \+ env\(safe-area-inset-bottom\) \+ 4rem\) !important;/g) ?? [])).toHaveLength(2);
  });
});
