import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductThemeSelector } from "@/components/ProductThemeProvider";
import { resolveTheme, THEME_OPTIONS } from "@/lib/themes";
import {
  DEFAULT_PRODUCT_THEME,
  PRODUCT_THEMES,
  PRODUCT_THEME_STORAGE_KEY,
  readProductThemePreference,
  saveProductThemePreference,
} from "@/lib/productThemes";

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255);
  const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

describe("JATA product UI themes", () => {
  it("defines both separate product themes with the exact approved brand colors and semantic tokens", () => {
    expect(Object.keys(PRODUCT_THEMES).sort()).toEqual(["emerald-ink", "lime-spark"]);
    expect(PRODUCT_THEMES["lime-spark"].tokens["--color-brand-primary"]).toBe("#B6FF2E");
    expect(PRODUCT_THEMES["lime-spark"].tokens["--color-brand-structure"]).toBe("#23262F");
    expect(PRODUCT_THEMES["emerald-ink"].tokens["--color-brand-primary"]).toBe("#064E3B");
    expect(PRODUCT_THEMES["emerald-ink"].tokens["--color-brand-secondary"]).toBe("#F8E7C9");
    for (const theme of Object.values(PRODUCT_THEMES)) {
      for (const token of ["--color-background", "--color-surface", "--color-surface-muted", "--color-text", "--color-text-muted", "--color-primary", "--color-primary-hover", "--color-primary-active", "--color-secondary", "--color-border", "--color-focus", "--color-success", "--color-warning", "--color-error"]) {
        expect(theme.tokens).toHaveProperty(token);
      }
      expect(contrast(theme.tokens["--color-text"], theme.tokens["--color-background"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-text"], theme.tokens["--color-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-text-muted"], theme.tokens["--color-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-primary"], theme.tokens["--color-background"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-primary-contrast"], theme.tokens["--color-primary"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-primary"], theme.tokens["--color-surface-muted"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-border"], theme.tokens["--color-surface"])).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.tokens["--color-border"], theme.tokens["--color-surface-muted"])).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.tokens["--color-placeholder"], theme.tokens["--color-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-disabled"], theme.tokens["--color-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-success"], theme.tokens["--color-success-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-warning"], theme.tokens["--color-warning-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-error"], theme.tokens["--color-error-surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.tokens["--color-focus"], theme.tokens["--color-surface"])).toBeGreaterThanOrEqual(3);
    }
  });

  it("renders an accessible named selector, visual swatches, descriptions, and selected state", () => {
    const html = renderToStaticMarkup(
      createElement(ProductThemeSelector, { selected: "lime-spark", onSelect: () => undefined }),
    );
    expect(html).toContain("Choose JATA appearance");
    expect(html).toContain("Lime Spark / Graphite");
    expect(html).toContain("Emerald Ink / Champagne");
    expect(html).toContain("Energetic, modern, and action-oriented");
    expect(html).toContain("Sophisticated, warm, and trustworthy");
    expect(html).toContain('aria-label="Lime Spark / Graphite — Energetic, modern, and action-oriented');
    expect(html).toContain('value="lime-spark"');
    expect(html).toContain('checked=""');
    expect(html).toContain('data-selected="true"');
  });

  it("persists a valid choice across reloads and ignores invalid or unavailable storage", () => {
    const storage = memoryStorage();
    expect(DEFAULT_PRODUCT_THEME).toBe("lime-spark");
    expect(readProductThemePreference(storage)).toBeNull();
    expect(saveProductThemePreference("emerald-ink", storage)).toBe(true);
    expect(storage.values.get(PRODUCT_THEME_STORAGE_KEY)).toBe("emerald-ink");
    expect(readProductThemePreference(storage)).toBe("emerald-ink");
    storage.values.set(PRODUCT_THEME_STORAGE_KEY, "dark");
    expect(readProductThemePreference(storage)).toBeNull();
    expect(readProductThemePreference({ getItem: () => { throw new Error("storage blocked"); } })).toBeNull();
    expect(saveProductThemePreference("lime-spark", { setItem: () => { throw new Error("storage blocked"); } })).toBe(false);
  });

  it("scopes product-wide controls and accessibility treatments without theming public pages", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const provider = readFileSync("components/ProductThemeProvider.tsx", "utf8");
    expect(css).toContain(".product-theme-root");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("::placeholder");
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":disabled");
    expect(css).toContain('[aria-invalid="true"]');
    expect(css).toContain('[role="dialog"]');
    expect(css).toContain("alert-warning");
    expect(provider).toContain('pathname?.startsWith("/b/")');
    expect(provider).toContain("business-route-root");
  });

  it("keeps the independent clean, dark, and warm public business themes", () => {
    expect(THEME_OPTIONS.map(({ key }) => key).sort()).toEqual(["clean", "dark", "warm"]);
    for (const key of ["clean", "dark", "warm"] as const) {
      expect(resolveTheme(key).key).toBe(key);
    }
  });
});
