import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Share-edge question: in the 320x568 motion capture the Share control appeared to sit hard
// against the screen edge. Thumbnails cannot settle that, so the measurement was added to the real
// browser checker (scripts/browser/actionbar-layout.check.mjs) instead of guessing at CSS.
// These tests pin the checker's own thresholds so the measurement cannot be quietly loosened into
// agreement with a real defect.
const checker = readFileSync("scripts/browser/actionbar-layout.check.mjs", "utf8");

/** Evaluate the checker's edge criteria against synthetic geometry, mirroring its arithmetic. */
const MIN_EDGE_GUTTER = 8;
const SYMMETRY_TOLERANCE = 1;
function verdict(actions: Array<{ left: number; right: number }>, innerWidth: number) {
  const innermost = Math.min(...actions.map((a) => Math.min(a.left, innerWidth - a.right)));
  const first = actions[0];
  const last = actions[actions.length - 1];
  const screen = Math.abs(first.left - (innerWidth - last.right));
  return { gutterPass: innermost >= MIN_EDGE_GUTTER, symmetryPass: screen <= SYMMETRY_TOLERANCE, innermost, screen };
}

describe("action-bar edge containment", () => {
  it("declares an explicit minimum edge gutter and a symmetry tolerance", () => {
    expect(checker).toContain("const MIN_EDGE_GUTTER = 8;");
    expect(checker).toContain("const SYMMETRY_TOLERANCE = 1;");
    // The thresholds must be used, not merely declared.
    expect(checker).toContain("m.innermostViewportGutter >= MIN_EDGE_GUTTER");
    expect(checker).toContain("m.symmetry.screen <= SYMMETRY_TOLERANCE");
  });

  it("measures the gutter against the viewport, not only against the bar's own content box", () => {
    // "Inside the bar" was already asserted; that is exactly the claim that cannot see this defect.
    expect(checker).toContain("toViewportLeft");
    expect(checker).toContain("toViewportRight");
    expect(checker).toContain("innermostViewportGutter");
    expect(checker).toContain("edgeGutters");
  });

  it("passes a correctly inset bar and fails a bar that touches the screen edge", () => {
    const good = verdict([{ left: 16, right: 76 }, { left: 84, right: 148 }, { left: 156, right: 220 }, { left: 228, right: 304 }], 320);
    expect(good.gutterPass).toBe(true);
    expect(good.symmetryPass).toBe(true);

    // The flagged shape: the last control ends exactly at the viewport edge.
    const flush = verdict([{ left: 12, right: 72 }, { left: 80, right: 140 }, { left: 148, right: 208 }, { left: 216, right: 320 }], 320);
    expect(flush.gutterPass).toBe(false);

    // Asymmetric but inset: still a layout defect worth failing.
    const skew = verdict([{ left: 4, right: 64 }, { left: 72, right: 132 }, { left: 140, right: 200 }, { left: 208, right: 268 }], 320);
    expect(skew.gutterPass).toBe(false);
    expect(skew.symmetryPass).toBe(false);
  });

  it("keeps the existing containment, overlap, touch-target and focus assertions", () => {
    for (const assertion of [
      "outsideBar.length === 0",
      "m.overlaps.length === 0",
      "a.rect.height >= 43.5",
      "focus.focusVisible",
      "m.pageOverflowX <= 0",
      "reduced-motion: labels still contained",
      "expanded label",
    ]) {
      expect(checker, assertion).toContain(assertion);
    }
  });
});
