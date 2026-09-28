// 3 premium themes implemented via design tokens + shared components (§13, §23)
// No duplicated page — same BusinessPage component reads `theme` and applies tokens.

export type ThemeKey = "clean" | "dark" | "warm";

export type ThemeTokens = {
  key: ThemeKey;
  name: string;
  description: string;
  colors: {
    bg: string;
    card: string;
    text: string;
    muted: string;
    primary: string;
    primaryText: string;
    accent: string;
    border: string;
    surfaceMuted: string;
  };
  radius: string;
};

export const THEMES: Record<ThemeKey, ThemeTokens> = {
  clean: {
    key: "clean",
    name: "Clean",
    description: "White/light minimal — professional, high-contrast",
    colors: {
      bg: "bg-[#fafaf8]",
      card: "bg-white",
      text: "text-zinc-900",
      muted: "text-zinc-600",
      primary: "bg-zinc-900",
      primaryText: "text-white",
      accent: "bg-amber-500",
      border: "border-zinc-200",
      surfaceMuted: "bg-zinc-50/50",
    },
    radius: "rounded-2xl",
  },
  dark: {
    key: "dark",
    name: "Dark",
    description: "Dark premium — studio-grade contrast",
    colors: {
      bg: "bg-zinc-950",
      card: "bg-zinc-900",
      text: "text-zinc-50",
      muted: "text-zinc-400",
      primary: "bg-white",
      primaryText: "text-zinc-900",
      accent: "bg-emerald-400",
      border: "border-zinc-800",
      // Nested surface inside a card (service rows) — dark so theme text/muted tokens stay readable (D1 fix)
      surfaceMuted: "bg-zinc-800/50",
    },
    radius: "rounded-2xl",
  },
  warm: {
    key: "warm",
    name: "Warm",
    description: "Warm Kenyan SME — inviting, earthy",
    colors: {
      bg: "bg-[#fef7ed]",
      card: "bg-white",
      text: "text-stone-900",
      muted: "text-stone-600",
      primary: "bg-[#c2410c]",
      primaryText: "text-white",
      accent: "bg-amber-500",
      border: "border-stone-200",
      surfaceMuted: "bg-zinc-50/50",
    },
    radius: "rounded-2xl",
  },
};

export const DEFAULT_THEME: ThemeKey = "clean";

export function resolveTheme(key: string | null | undefined): ThemeTokens {
  if (key && key in THEMES) return THEMES[key as ThemeKey];
  return THEMES[DEFAULT_THEME];
}

export const THEME_OPTIONS = Object.values(THEMES).map((t) => ({
  key: t.key,
  name: t.name,
  description: t.description,
}));
