import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/lib/themes";

// D1 regression coverage (G4 Evidence Report 2026-09-28): the public BusinessPage
// Services list must draw its nested surfaces — service row backgrounds and price
// pill backgrounds — from theme tokens so that every theme, including dark, keeps
// its own text tokens readable. The original defect hard-coded light surfaces
// (`bg-zinc-50/50` rows, `bg-white` pills) which rendered dark-theme text
// effectively invisible (contrast well under the WCAG AA 4.5:1 threshold).

const root = path.resolve(__dirname, "../..");
const AA_MINIMUM = 4.5;

// Hex values for the Tailwind v3 default palette shades used by theme tokens.
const PALETTES: Record<string, Record<string, string>> = {
  zinc: {
    "50": "#fafafa",
    "100": "#f4f4f5",
    "200": "#e4e4e7",
    "400": "#a1a1aa",
    "600": "#52525b",
    "700": "#3f3f46",
    "800": "#27272a",
    "900": "#18181b",
    "950": "#09090b",
  },
  stone: {
    "600": "#57534e",
    "900": "#1c1917",
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  expect(value).toMatch(/^[0-9a-fA-F]{6}$/);
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function blendOver(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
}

function luminance(rgb: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolves a theme token utility class to its effective hex color.
 * Translucent background utilities (e.g. `bg-zinc-800/50`) are composited over
 * `over` — the surface they sit on (the card, matching how the Services list nests).
 * Throws on unknown classes so the contract fails loudly rather than silently skipping.
 */
function effectiveColor(token: string, over?: string): string {
  const asHex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  const arbitrary = /^bg-\[#([0-9a-fA-F]{6})\]$/.exec(token);
  if (arbitrary) return `#${arbitrary[1]}`;

  if (token === "bg-white" || token === "text-white") return "#ffffff";
  if (token === "bg-black") return "#000000";

  const palette = /^(?:bg|text|border)-(zinc|stone)-(\d+)(?:\/(\d+))?$/.exec(token);
  if (!palette) throw new Error(`business-page-contrast: unresolvable theme token "${token}"`);
  const [, scale, shade, alpha] = palette;
  const hex = PALETTES[scale]?.[shade];
  if (!hex) throw new Error(`business-page-contrast: unknown ${scale}-${shade} shade in token "${token}"`);
  if (alpha !== undefined && over !== undefined) {
    return asHex(blendOver(hexToRgb(hex), hexToRgb(over), Number(alpha) / 100));
  }
  if (alpha !== undefined) throw new Error(`business-page-contrast: translucent token "${token}" needs a base surface`);
  return hex;
}

describe("business page services theme/contrast contract (D1)", () => {
  it("every theme provides the nested-surface tokens the Services list consumes", () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.colors.card).toBeTruthy();
      expect(theme.colors.surfaceMuted).toBeTruthy();
      expect(theme.colors.text).toBeTruthy();
      expect(theme.colors.muted).toBeTruthy();
    }
  });

  it("preserves the exact pre-fix light-theme rendering of service rows and price pills", () => {
    // Before the fix, light themes rendered rows as `bg-zinc-50/50` and pills as `bg-white`.
    expect(THEMES.clean.colors.surfaceMuted).toBe("bg-zinc-50/50");
    expect(THEMES.warm.colors.surfaceMuted).toBe("bg-zinc-50/50");
    expect(THEMES.clean.colors.card).toBe("bg-white");
    expect(THEMES.warm.colors.card).toBe("bg-white");
  });

  it("the dark theme does not reuse the light hard-coded surfaces", () => {
    expect(THEMES.dark.colors.surfaceMuted).not.toBe("bg-zinc-50/50");
    expect(THEMES.dark.colors.card).not.toBe("bg-white");
    expect(THEMES.dark.colors.surfaceMuted).not.toBe(THEMES.clean.colors.surfaceMuted);
  });

  it("service titles, descriptions and price pills meet WCAG AA in every theme", () => {
    for (const theme of Object.values(THEMES)) {
      // Price pills use the card surface; service rows use surfaceMuted, composited
      // over the card section they sit inside. Text tokens come from the same theme.
      const card = effectiveColor(theme.colors.card);
      const row = effectiveColor(theme.colors.surfaceMuted, card);
      const title = effectiveColor(theme.colors.text);
      const description = effectiveColor(theme.colors.muted);

      // Worst case first: muted description text on the service row.
      expect(contrastRatio(description, row), `${theme.key}: description on service row`).toBeGreaterThanOrEqual(AA_MINIMUM);
      // Service title on the service row.
      expect(contrastRatio(title, row), `${theme.key}: title on service row`).toBeGreaterThanOrEqual(AA_MINIMUM);
      // Price pill text on the pill surface.
      expect(contrastRatio(title, card), `${theme.key}: price pill text`).toBeGreaterThanOrEqual(AA_MINIMUM);
    }
  });

  it("BusinessPage renders the Services list from theme tokens, not hard-coded light surfaces", () => {
    const source = readFileSync(path.join(root, "components/BusinessPage.tsx"), "utf8");
    const start = source.indexOf("{/* Services */}");
    const end = source.indexOf("{/* About */}");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const servicesSection = source.slice(start, end);

    // The D1 defect literals must not return to the Services list.
    expect(servicesSection).not.toContain("bg-zinc-50/50");
    expect(servicesSection).not.toContain("bg-white");
    // Row background and price pill must consume the theme tokens.
    expect(servicesSection).toContain("${t.colors.surfaceMuted}");
    expect(servicesSection).toContain("border ${t.colors.border} ${t.colors.card} px-2.5 py-1 text-xs font-medium");
  });
});
