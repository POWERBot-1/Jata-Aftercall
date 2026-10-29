/**
 * The premium motion system — regression guards.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Motion is the easiest thing in a design system to get wrong in ways nobody notices until a
 * customer does: a transition that re-introduces a withdrawn palette, a keyframe that ignores
 * `prefers-reduced-motion`, a duration hard-coded in milliseconds instead of a token, or a
 * "success" message that appears before the server confirmed anything.
 *
 * These tests are written against the real stylesheet and the real modules, not against a copy of
 * them, and they are deliberately about *identity* first: the espresso/cream/amber brand, the plan
 * icons and their order, and the accessibility fallback. A motion patch that disturbs any of those
 * fails here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_ICONS, POS_PLAN_CARD } from "@/lib/landing";
import { HOMEPAGE_PLAN_ORDER } from "@/lib/pricing";

const css = readFileSync("app/globals.css", "utf8");

/** Every `@keyframes name` declared in the stylesheet. */
function keyframeNames(source: string): string[] {
  return Array.from(source.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)).map((match) => match[1]);
}

/** Collect the text of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = "@media (prefers-reduced-motion: reduce)";
  let cursor = source.indexOf(marker);
  while (cursor !== -1) {
    const open = source.indexOf("{", cursor);
    let depth = 0;
    let index = open;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(open, index + 1));
    cursor = source.indexOf(marker, index);
  }
  return blocks;
}

describe("brand identity survives the motion work", () => {
  it("keeps the espresso / cream / amber palette exactly as it was", () => {
    // The workspace/landing brand tokens. If a motion patch repoints any of these, the product has
    // been rebranded, which this work is explicitly forbidden from doing.
    const brand = {
      "--ws-ink": "#14110f",
      "--ws-cream": "#f7f2e8",
      "--ws-amber": "#f0a03c",
      "--ws-amber-deep": "#b45309",
      "--ws-text": "#171310",
      "--ws-paper": "#fffdf8",
    };
    for (const [token, hex] of Object.entries(brand)) {
      expect(css, `${token} must still be ${hex}`).toContain(`${token}: ${hex};`);
    }
  });

  it("keeps the platform accent amber and the ink espresso, not a neon accent", () => {
    expect(css).toMatch(/--jata-accent:\s*#d97706;/);
    expect(css).toMatch(/--jata-ink:\s*#18181b;/);
  });

  it("introduces no new colour token from the motion patch", () => {
    // Motion is timing and easing. Any *colour* token added under the motion heading means the
    // patch drifted into a redesign.
    const reduced = reducedMotionBlocks(css).join("\n");
    expect(reduced).not.toMatch(/--(jata|ws)-[a-z-]*colou?r:/);
    expect(css).not.toMatch(/--jata-motion-[a-z-]*:\s*#/);
  });
});

describe("plan icons and order are untouched", () => {
  it("maps each page plan to the same icon", () => {
    expect(PLAN_ICONS).toEqual({
      MONTHLY: "phone",
      ANNUAL: "calendar",
      AI_BUSINESS_FRONT_DESK: "bot",
      INTERACTIVE_BUSINESS: "wand",
    });
  });

  it("keeps the POS card on the storefront glyph", () => {
    expect(POS_PLAN_CARD.icon).toBe("store");
  });

  it("keeps the homepage plan order", () => {
    expect([...HOMEPAGE_PLAN_ORDER]).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
      "ERP_PRO",
      "JATA_AUTOPILOT",
    ]);
  });
});

describe("motion tokens", () => {
  it("defines the durations and easings the motion layer uses", () => {
    for (const token of ["--jata-dur-fast", "--jata-dur-base", "--jata-dur-slow", "--jata-dur-state"]) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:\\s*\\d+ms;`));
    }
    for (const token of ["--jata-ease-out", "--jata-ease-in-out"]) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:\\s*cubic-bezier\\(`));
    }
  });

  it("keeps every motion duration short enough for a till", () => {
    // A POS transaction must never wait on an animation.
    for (const token of ["--jata-dur-fast", "--jata-dur-base", "--jata-dur-slow", "--jata-dur-state"]) {
      const value = css.match(new RegExp(`${token}\\s*:\\s*(\\d+)ms;`));
      expect(value, token).not.toBeNull();
      expect(Number(value![1]), token).toBeLessThanOrEqual(320);
    }
  });

  it("drives the shared primitives from tokens, not literal milliseconds", () => {
    // Hover/state primitives transition; an entrance primitive animates. Both must read their
    // timing from the token scale, or one screen will drift out of the product's tempo.
    const transitioned = [".jata-nav-link", ".jata-pill", ".jata-table tbody tr"];
    for (const selector of transitioned) {
      const rule = css.match(new RegExp(`\\${selector}[^{]*\\{[^}]*transition:[^}]*\\}`));
      expect(rule, `${selector} must declare a transition`).not.toBeNull();
      expect(rule![0], `${selector} must use a duration token`).toMatch(/var\(--jata-dur-/);
      expect(rule![0], `${selector} must not hard-code a time`).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    }
    for (const selector of [".jata-dialog-in", ".jata-chart-shell"]) {
      const rule = css.match(new RegExp(`\\${selector}[^{]*\\{[^}]*animation:[^}]*\\}`));
      expect(rule, `${selector} must declare an animation`).not.toBeNull();
      expect(rule![0], `${selector} must use a duration token`).toMatch(/var\(--jata-dur-/);
      expect(rule![0], `${selector} must not hard-code a time`).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    }
  });
});

describe("reduced motion is complete, not decorative", () => {
  const blocks = reducedMotionBlocks(css);

  it("has a reduced-motion block at all", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("neutralises every keyframe the stylesheet declares", () => {
    const reduced = blocks.join("\n");
    const names = [...new Set(keyframeNames(css))];
    expect(names.length).toBeGreaterThan(10);
    // A keyframe that no reduced-motion block can reach would keep moving for a customer who
    // asked the operating system for stillness. The global rule at the end of the stylesheet is
    // what makes every one of them reachable.
    const unreachable = names.filter((name) => !reduced.includes(name));
    const blanket = /\*\s*,?[^{]*\{[^}]*animation-duration:\s*0\.0*1m?s\s*!important/.test(reduced);
    expect(blanket || unreachable.length === 0, `unreachable keyframes: ${unreachable.join(", ")}`).toBe(true);
  });

  it("disables the motion added by this patch under reduced motion", () => {
    const reduced = blocks.join("\n");
    for (const selector of [".jata-nav-link", ".jata-pill", ".jata-dialog-in"]) {
      expect(reduced, `${selector} must be neutralised`).toContain(selector);
    }
  });

  it("never hides content while motion is off", () => {
    // Motion being unavailable must not mean content being unavailable. Nothing reduced may be
    // removed from the page or taken out of the accessibility tree.
    const reduced = blocks.join("\n");
    expect(reduced).not.toMatch(/visibility:\s*hidden/);
    expect(reduced).not.toMatch(/display:\s*none/);

    // `opacity: 0` is allowed only for a decorative cross-fade frame, where the *other* frame is
    // the one that is shown. Anything else would be content that disappears when motion is off.
    const hidden = Array.from(reduced.matchAll(/([^{}]+)\{[^}]*opacity:\s*0\s*[;}]/g)).map((m) => m[1].trim());
    for (const selector of hidden) {
      expect(selector, `reduced motion must not hide ${selector}`).toMatch(/jata-showcase__frame[0-9]/);
    }
  });

  it("guarantees stillness globally, not only inside a scoped surface", () => {
    // The scoped blocks cover the landing, a customer product, the storefront and the workspace.
    // A primitive outside those scopes would otherwise keep animating, so the last rule in the
    // stylesheet must apply to everything.
    const tail = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(tail).toMatch(/\*,\s*\n?\s*\*::before,\s*\n?\s*\*::after\s*\{/);
    expect(tail).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(tail).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});
