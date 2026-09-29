import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_THEMES, productThemeBootScript, productThemeCss, type ProductThemeKey } from "@/lib/productThemes";

// Regression for the Lime Spark contrast defect found in the rendered audit of current main:
// text rendered at 1.04–1.09:1 because the shared layout primitives (.jata-page, .jata-card,
// .jata-nav, labels, titles) read the legacy light --jata-* palette while the text colour came
// from the dark Lime Spark theme. This test resolves the CSS variable cascade the browser
// applies and checks the resulting foreground/background pairs.
// The rendered (headless Chromium) audit of every page is recorded in the PR evidence.

const css = readFileSync("app/globals.css", "utf8");

function luminance(hex: string): number {
  const rgb = hex.replace("#", "").match(/.{2}/g)!.map((c) => parseInt(c, 16) / 255);
  const lin = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Declarations of every rule whose selector exactly matches, merged in source order (later wins, as in the cascade). */
function rule(selector: string, source = css): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g");
  const merged: Record<string, string> = {};
  let found = false;
  for (const match of source.matchAll(re)) {
    found = true;
    for (const d of match[2].split(";").map((x) => x.trim()).filter(Boolean)) {
      const i = d.indexOf(":");
      merged[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  expect(found, `missing CSS rule ${selector}`).toBe(true);
  return merged;
}

/** Resolves var(--x) chains against a variable scope. */
function resolve(value: string, scope: Record<string, string>): string {
  let out = value.trim();
  for (let i = 0; i < 10 && out.startsWith("var("); i++) {
    const name = /^var\((--[\w-]+)\)$/.exec(out)?.[1];
    expect(name, `unresolvable ${out}`).toBeTruthy();
    out = scope[name!];
    expect(out, `undefined variable ${name}`).toBeTruthy();
  }
  return out;
}

function themeScope(key: ProductThemeKey): Record<string, string> {
  const scope: Record<string, string> = { ...rule(":root"), ...PRODUCT_THEMES[key].tokens };
  // The .product-theme-root remapping of the legacy palette, evaluated against this theme's tokens.
  const remap = rule(".product-theme-root");
  for (const [name, value] of Object.entries(remap)) if (name.startsWith("--jata-")) scope[name] = resolve(value, scope);
  return scope;
}

const AA = 4.5;

describe("Lime Spark rendered contrast (CSS cascade)", () => {
  it("re-points every legacy --jata-* colour at the active product theme", () => {
    const remap = rule(".product-theme-root");
    for (const name of ["--jata-ink", "--jata-paper", "--jata-card", "--jata-line", "--jata-muted", "--jata-focus"]) {
      expect(remap[name], name).toMatch(/^var\(--color-/);
    }
  });

  it.each(["lime-spark", "emerald-ink"] as ProductThemeKey[])("%s: page, card, nav, label, title and muted text meet WCAG AA", (key) => {
    const s = themeScope(key);
    const page = resolve(rule(".product-theme-root .jata-page").background, s);
    const landing = resolve(rule(".product-theme-root .jata-landing").background, s);
    const nav = resolve(rule(".product-theme-root .jata-nav").background, s);
    const card = resolve(rule(".jata-card").background, s);
    const input = resolve(rule(".product-theme-root .jata-input").background, s);
    const ink = s["--jata-ink"];
    const muted = s["--jata-muted"];
    const pairs: [string, string, string][] = [
      ["title/body text on page", ink, page],
      ["headline on landing", ink, landing],
      ["nav text on nav", ink, nav],
      ["label on card", ink, card],
      ["input text on input", resolve(rule(".product-theme-root .jata-input").color, s), input],
      ["muted/subtitle on page", muted, page],
      ["muted/hint on card", muted, card],
      ["muted nav link on nav", muted, nav],
      ["brand mark", resolve(rule(".product-theme-root .jata-brand-mark").color, s), resolve(rule(".product-theme-root .jata-brand-mark").background, s)],
      ["draft chip", resolve(rule(".product-theme-root .jata-draft").color, s), resolve(rule(".product-theme-root .jata-draft").background, s)],
      ["live chip", resolve(rule(".product-theme-root .jata-live").color, s), resolve(rule(".product-theme-root .jata-live").background, s)],
      ["primary button", s["--color-primary-contrast"], s["--color-primary"]],
      ["skip link", s["--jata-card"], s["--jata-ink"]],
      ["muted text in warning surface", s["--color-warning"], s["--color-warning-surface"]],
      ["neutral status chip", s["--color-text-muted"], s["--color-surface-muted"]],
    ];
    for (const [label, fg, bg] of pairs) {
      expect(contrast(fg, bg), `${key}: ${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the exact failing pairs from the audit can no longer occur under Lime Spark", () => {
    const s = themeScope("lime-spark");
    const text = s["--color-text"]; // #F4F6F0
    // Before: #f4f6f0 text on #ffffff/#fafaf8/#fefefe surfaces (1.04–1.09:1).
    for (const surface of [s["--jata-card"], s["--jata-paper"], resolve(rule(".product-theme-root .jata-nav").background, s)]) {
      expect(surface.toLowerCase()).not.toMatch(/^#f[a-f0-9]{5}$/);
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("previews of the customer page stay light and readable inside any theme (light island)", () => {
    const island = rule(".product-theme-root .jata-light-island");
    expect(contrast(island["--color-text"], island["--color-surface"])).toBeGreaterThanOrEqual(AA);
    expect(contrast(island["--color-text-muted"], island["--color-surface"])).toBeGreaterThanOrEqual(AA);
    expect(contrast(island["--color-text-muted"], island["--color-surface-muted"])).toBeGreaterThanOrEqual(AA);
    expect(contrast(island["--color-primary-contrast"], island["--color-primary"])).toBeGreaterThanOrEqual(AA);
    expect(contrast(island["--color-warning"], island["--color-warning-surface"])).toBeGreaterThanOrEqual(AA);
    expect(contrast(island["--jata-ink"], island["--jata-card"])).toBeGreaterThanOrEqual(AA);
  });

  it("filled primary controls force primary-contrast text on nested text utilities", () => {
    expect(css).toContain('.product-theme-root button.bg-zinc-900 [class*="text-"]');
    const s = themeScope("lime-spark");
    expect(contrast(s["--color-primary-contrast"], s["--color-primary"])).toBeGreaterThanOrEqual(AA);
  });

  it("WhatsApp CTA colour (emerald-700 #047857 with white) meets AA; the old emerald-500 did not", () => {
    expect(contrast("#ffffff", "#047857")).toBeGreaterThanOrEqual(AA);
    expect(contrast("#ffffff", "#10b981")).toBeLessThan(3);
  });
});

describe("product theme first paint", () => {
  it("emits CSS for every theme keyed on the provider attribute and on <html data-jata-theme>", () => {
    const out = productThemeCss();
    for (const key of Object.keys(PRODUCT_THEMES)) {
      expect(out).toContain(`.product-theme-root[data-product-theme="${key}"]`);
      expect(out).toContain(`html[data-jata-theme="${key}"] .product-theme-root`);
    }
    expect(out).toContain("--color-brand-primary:#064E3B");
    expect(out).not.toMatch(/<\/?script/i);
  });

  it("boot script only accepts known theme keys and tolerates blocked storage", () => {
    const script = productThemeBootScript();
    expect(script).toContain("jata-product-theme");
    expect(script).toContain('["lime-spark","emerald-ink"]');
    expect(script).toContain("catch(e)");
    const provider = readFileSync("components/ProductThemeProvider.tsx", "utf8");
    expect(provider).not.toContain("style={activeTheme.tokens");
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("productThemeBootScript()");
  });
});
