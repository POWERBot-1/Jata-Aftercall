/**
 * Bridge between OpenPage's ten theme presets and JATA's approved category themes.
 *
 * JATA's renderer is driven by real category themes, not by arbitrary CSS custom
 * properties. A preset therefore selects the *closest approved JATA theme* rather than
 * injecting unvalidated colours/fonts into the storefront. The owner still sees the
 * OpenPage palette that informed the choice.
 */

import { themesForCategory } from "@/lib/experience/themes";
import { themePresets } from "./themePresets";

function luminance(hex: string): number {
  const raw = String(hex || "").replace("#", "");
  if (raw.length !== 6) return 0;
  const channels = [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16) / 255);
  return channels.reduce((sum, value) => sum + value, 0) / 3;
}

function rgb(hex: string): [number, number, number] {
  const raw = String(hex || "").replace("#", "");
  if (raw.length !== 6) return [0, 0, 0];
  return [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16)) as [number, number, number];
}

function distance(a: string, b: string): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

export type ThemeBridgeOption = {
  presetId: string;
  presetName: string;
  jataThemeKey: string;
  jataThemeName: string;
  swatches: string[];
};

/** For each OpenPage palette, the closest approved JATA theme in this category. */
export function themeBridgeForCategory(categoryKey: string): ThemeBridgeOption[] {
  const jataThemes = themesForCategory(categoryKey);
  if (jataThemes.length === 0) return [];
  return themePresets.map((preset) => {
    const targetLight = luminance(preset.theme.bg0) > 0.5;
    const scored = jataThemes
      .map((theme) => {
        const light = luminance(theme.palette.bg) > 0.5;
        const lightnessPenalty = light === targetLight ? 0 : 120;
        return {
          theme,
          score: distance(preset.theme.accent, theme.palette.primary) + lightnessPenalty + distance(preset.theme.bg0, theme.palette.bg) * 0.15,
        };
      })
      .sort((a, b) => a.score - b.score);
    const chosen = scored[0].theme;
    return {
      presetId: preset.id,
      presetName: preset.name,
      jataThemeKey: chosen.key,
      jataThemeName: chosen.name,
      swatches: [preset.theme.bg0, preset.theme.bg1, preset.theme.text0, preset.theme.accent, preset.theme.borderDefault],
    };
  });
}

/** The OpenPage preset closest to a JATA theme, for displaying the current direction. */
export function presetForJataTheme(themeKey: string, categoryKey: string): { presetId: string; presetName: string } | null {
  const options = themeBridgeForCategory(categoryKey);
  return options.find((option) => option.jataThemeKey === themeKey) || null;
}
