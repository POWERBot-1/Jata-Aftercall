/**
 * Theme engine (§20, §21)
 *
 * Every theme must be readable: the palette is derived, not hand-tuned, and body/primary text
 * combinations are checked against WCAG AA so an owner's brand colour can never make a page
 * unreadable.
 */

import { describe, expect, it } from "vitest";
import { EXPERIENCE_THEMES, isValidThemeKey, resolveExperienceTheme, themeCss, themesForCategory } from "@/lib/experience/themes";
import { contrastRatio, readableTextOn } from "@/lib/experience/color";
import { CATEGORY_KEYS } from "@/lib/experience/categories";

describe("theme engine", () => {
  it("has themes for every category", () => {
    expect(EXPERIENCE_THEMES.length).toBeGreaterThanOrEqual(16);
    for (const key of CATEGORY_KEYS) {
      expect(themesForCategory(key).length).toBeGreaterThan(0);
    }
  });

  it("keeps body text and primary buttons readable in every theme", () => {
    for (const theme of EXPERIENCE_THEMES) {
      const body = contrastRatio(theme.palette.text, theme.palette.bg);
      const primary = contrastRatio(theme.palette.primaryText, theme.palette.primary);
      expect(body, `${theme.key} body text`).not.toBeNull();
      expect(primary, `${theme.key} primary button`).not.toBeNull();
      expect(body as number, `${theme.key} body text ratio`).toBeGreaterThanOrEqual(4.5);
      expect(primary as number, `${theme.key} primary text ratio`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("emits CSS custom properties rather than per-theme stylesheets", () => {
    const { css, warnings } = themeCss(resolveExperienceTheme(EXPERIENCE_THEMES[0].key));
    expect(css).toContain("--eb-bg");
    expect(css).toContain("--eb-primary");
    expect(Array.isArray(warnings)).toBe(true);
    expect(isValidThemeKey(EXPERIENCE_THEMES[0].key)).toBe(true);
    expect(isValidThemeKey("not-a-theme")).toBe(false);
  });

  it("corrects an unreadable brand colour instead of applying it", () => {
    const theme = resolveExperienceTheme(EXPERIENCE_THEMES[0].key);
    const { css } = themeCss(theme, { primaryColor: "#ffffff" });
    // White on white would be invisible; the engine must keep the button text readable.
    const match = css.match(/--eb-primary-text:\s*([^;]+);/);
    expect(match).not.toBeNull();
    const textColour = (match?.[1] || "").trim();
    expect(contrastRatio(textColour, "#ffffff") as number).toBeGreaterThanOrEqual(4.5);
    expect(readableTextOn("#ffffff")).toBe("#121212");
  });

  it("falls back to a known theme for an unknown key", () => {
    expect(resolveExperienceTheme("nope").key).toBe(resolveExperienceTheme(null).key);
  });
});
