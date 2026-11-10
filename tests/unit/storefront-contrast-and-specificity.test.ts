/**
 * Storefront contrast and cascade regressions (Website Studio 2.0 acceptance).
 *
 * These were found by measuring rendered pages in a real browser across all seven
 * business verticals, not by reading the stylesheet. 19 elements were below the
 * WCAG 2.1 AA floor; this file pins the three distinct root causes so a later
 * stylesheet edit cannot quietly bring them back.
 *
 *   1. A specificity inversion made every anchor-styled button unreadable. The rule
 *      `.eb-scope a` (0,1,1) out-ranked `.eb-btn` (0,1,0), so a solid button drawn as
 *      an <a> painted its brand background but inherited the page's dark text —
 *      measured 2.03:1 on the primary call-to-action of every storefront.
 *
 *   2. Two solid contact buttons carried white text on surfaces that were too light:
 *      amber-600 Call measured 3.19:1.
 *
 *   3. `--eb-muted` is tuned against the theme's `surface`, but the lede and card
 *      descriptions paint on different surfaces, measuring 4.32:1 and 4.05:1.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
const AA_NORMAL = 4.5;

type Rgb = { r: number; g: number; b: number };

function parseRgb(value: string): Rgb | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The declaration block for a selector that appears exactly once. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in app/globals.css: ${selector}`);
  return match[1];
}

describe("anchor-styled buttons keep their own colour (specificity)", () => {
  it("scopes the blanket link colour so it cannot out-rank a button's colour", () => {
    // `.eb-scope a` is (0,1,1) and would beat `.eb-btn` at (0,1,0). `:where()` zeroes the
    // anchor's contribution, dropping the rule to (0,1,0) so source order and the button's
    // own rule decide. If this ever reverts, solid CTAs silently paint dark-on-brand again.
    expect(css).toContain(".eb-scope :where(a) {");
    expect(css).not.toMatch(/^\.eb-scope a \{/m);
  });

  it("still lets ordinary storefront links inherit their surroundings' colour", () => {
    const body = ruleBody(".eb-scope :where(a)");
    expect(body).toContain("color: inherit");
    expect(body).toContain("text-decoration: none");
  });

  it("keeps the solid button foreground tied to the theme token, not inherited text", () => {
    const body = ruleBody(".eb-btn");
    expect(body).toContain("color: var(--eb-primary-text)");
    expect(body).not.toMatch(/color:\s*inherit/);
  });
});

describe("solid contact buttons meet WCAG AA with white text", () => {
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const cases: Array<[string, string]> = [
    [".jata-contact-action--call", "Call"],
    [".jata-contact-action--whatsapp", "WhatsApp"],
  ];

  it.each(cases)("%s clears %.1f:1 against its white label", (selector, label) => {
    const body = ruleBody(selector);
    const colour = parseRgb(body);
    expect(colour, `${selector} should declare an explicit background`).not.toBeNull();
    expect(body).toContain("color: rgb(255 255 255)");
    const ratio = contrastRatio(colour!, white);
    expect(ratio, `${label} label contrast was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("no longer uses the amber-600 shade that measured 3.19:1", () => {
    // 217 119 6 was the original Call background. Kept as an explicit guard.
    expect(ruleBody(".jata-contact-action--call")).not.toContain("217 119 6");
  });
});

describe("muted text is darkened on the surface it actually paints on", () => {
  it("the lede does not rely on the bare --eb-muted token", () => {
    // --eb-muted is tuned for --eb-surface; the lede sits on the page background,
    // where the bare token measured 4.32:1.
    const body = ruleBody(".eb-lede");
    expect(body).not.toMatch(/color:\s*var\(--eb-muted\)\s*;/);
    expect(body).toContain("color-mix(");
  });

  it("card descriptions do not rely on the bare --eb-muted token", () => {
    // Card bodies paint on --eb-card (white here), where the bare token measured 4.05:1.
    const body = ruleBody(".eb-card__desc");
    expect(body).not.toMatch(/color:\s*var\(--eb-muted\)\s*;/);
    expect(body).toContain("color-mix(");
  });
});

describe("the action bar's primary CTA clears AA", () => {
  it("darkens the brand fill enough for its cream label", () => {
    // The shipped brand #C24A27 with cream text measured 4.40:1 — just under AA on the
    // most-tapped control on the page.
    expect(css).toContain(".eb-actionbar .eb-btn:not(.eb-btn--outline) {");
    const body = ruleBody(".eb-actionbar .eb-btn:not(.eb-btn--outline)");
    expect(body).toContain("color-mix(");
    const brand = parseRgb("rgb(194, 74, 39)")!;
    const darkened = {
      r: brand.r * 0.86,
      g: brand.g * 0.86,
      b: brand.b * 0.86,
    };
    const cream = { r: 245, g: 243, b: 238 };
    expect(contrastRatio(darkened, cream)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
