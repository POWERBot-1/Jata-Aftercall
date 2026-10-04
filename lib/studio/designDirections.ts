/**
 * Design directions (§8, §30, §44)
 *
 * Three genuinely different visual directions derived from what the business already is —
 * its category, its name and any brand colours it has — rather than a random theme carousel.
 *
 * A direction is a complete, coherent design system: palette, surfaces, typography treatment,
 * button shape, photography language and tone. Applying one updates the whole website at once,
 * which is what stops a homepage from looking like a different company from the product pages.
 *
 * Every field it produces is an editable token: the owner can change any of it afterwards.
 */

import { getExperienceProfile } from "../experience/categories";
import { resolveExperienceTheme, themesForCategory } from "../experience/themes";
import { defaultStyleForCategory, resolvePhotographyStyle } from "../ai/designContext";
import type { CategoryKey, ExperienceBrand } from "../experience/types";

export type DesignDirection = {
  key: string;
  name: string;
  /** One line an owner would understand. */
  description: string;
  /** What this direction is for. */
  bestFor: string;
  tone: "premium" | "warm" | "modern" | "natural" | "bold";
  themeKey: string;
  brand: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    buttonStyle: "solid" | "soft" | "outline" | "pill";
    fontPairing: string;
  };
  photographyStyle: string;
  /** Swatches for the picker: [background, surface, primary, accent, text]. */
  swatches: string[];
  typography: string;
  toneOfVoice: string;
};

type DirectionRecipe = {
  key: string;
  name: string;
  description: string;
  bestFor: string;
  tone: DesignDirection["tone"];
  /** Preferred theme names in order; the first one this category owns wins. */
  themePriority: string[];
  photographyStyle: string;
  buttonStyle: DesignDirection["brand"]["buttonStyle"];
  fontPairing: string;
  toneOfVoice: string;
};

const RECIPES: Record<string, DirectionRecipe[]> = {
  food: [
    {
      key: "kitchen-warm",
      name: "Kitchen warm",
      description: "Deep charcoal, generous portions and warm photography that makes food look freshly cooked.",
      bestFor: "Grills, cafes, takeaways and catering",
      tone: "warm",
      themePriority: ["grill", "bistro", "street"],
      photographyStyle: "warm",
      buttonStyle: "solid",
      fontPairing: "serif-display",
      toneOfVoice: "Friendly, direct and a little hungry",
    },
    {
      key: "street-fresh",
      name: "Street fresh",
      description: "Bright, high-contrast and quick to scan — built for fast ordering on a phone.",
      bestFor: "Fast food, street food and lunch spots",
      tone: "bold",
      themePriority: ["street", "grill", "bistro"],
      photographyStyle: "modern",
      buttonStyle: "pill",
      fontPairing: "grotesk",
      toneOfVoice: "Quick, upbeat, confident",
    },
    {
      key: "bistro-editorial",
      name: "Bistro editorial",
      description: "Restrained typography and quiet photography for a sit-down, higher-bill restaurant.",
      bestFor: "Restaurants with table service",
      tone: "premium",
      themePriority: ["bistro", "grill", "street"],
      photographyStyle: "premium",
      buttonStyle: "outline",
      fontPairing: "editorial-serif",
      toneOfVoice: "Considered and hospitable",
    },
  ],
  beauty: [
    {
      key: "soft-ritual",
      name: "Soft ritual",
      description: "Warm neutrals, rounded cards and gentle product photography that feels tactile.",
      bestFor: "Skincare, cosmetics and beauty retail",
      tone: "warm",
      themePriority: ["editorial", "minimal", "luxury"],
      photographyStyle: "natural",
      buttonStyle: "pill",
      fontPairing: "editorial-serif",
      toneOfVoice: "Warm but assured",
    },
    {
      key: "editorial-beauty",
      name: "Editorial beauty",
      description: "Magazine-style spacing, bold headings and clean studio product light.",
      bestFor: "Brands that want to look established",
      tone: "premium",
      themePriority: ["editorial", "luxury", "minimal"],
      photographyStyle: "clean-studio",
      buttonStyle: "solid",
      fontPairing: "grotesk",
      toneOfVoice: "Confident and precise",
    },
    {
      key: "clean-clinic",
      name: "Clean clinic",
      description: "High-key, minimal and trustworthy — nothing that reads as a medical claim.",
      bestFor: "Skin clinics and treatment rooms",
      tone: "modern",
      themePriority: ["minimal", "editorial", "luxury"],
      photographyStyle: "minimal",
      buttonStyle: "soft",
      fontPairing: "grotesk",
      toneOfVoice: "Calm and factual",
    },
  ],
  salon: [
    {
      key: "chair-confident",
      name: "Chair confident",
      description: "Strong type, dark surfaces and portrait photography that shows the finish.",
      bestFor: "Salons and barbers with a signature look",
      tone: "bold",
      themePriority: ["bold", "studio", "minimal"],
      photographyStyle: "modern",
      buttonStyle: "solid",
      fontPairing: "grotesk",
      toneOfVoice: "Direct and stylish",
    },
    {
      key: "quiet-luxury",
      name: "Quiet luxury",
      description: "Soft neutrals, wide spacing and low-key photography for a premium chair.",
      bestFor: "Premium salons and spas",
      tone: "premium",
      themePriority: ["luxury", "minimal", "studio"],
      photographyStyle: "luxury",
      buttonStyle: "outline",
      fontPairing: "editorial-serif",
      toneOfVoice: "Unhurried and personal",
    },
    {
      key: "friendly-local",
      name: "Friendly local",
      description: "Bright, approachable and quick to book — the salon around the corner.",
      bestFor: "Neighbourhood salons and barbers",
      tone: "warm",
      themePriority: ["studio", "bold", "minimal"],
      photographyStyle: "natural",
      buttonStyle: "pill",
      fontPairing: "grotesk",
      toneOfVoice: "Friendly and welcoming",
    },
  ],
  technical: [
    {
      key: "workshop-trust",
      name: "Workshop trust",
      description: "Solid colours, clear labels and photos of finished work — competence over decoration.",
      bestFor: "Fundis, plumbers, electricians and cleaners",
      tone: "bold",
      themePriority: ["bold", "studio", "minimal"],
      photographyStyle: "clean-studio",
      buttonStyle: "solid",
      fontPairing: "grotesk",
      toneOfVoice: "Plain-spoken and reliable",
    },
    {
      key: "clean-contractor",
      name: "Clean contractor",
      description: "Light, orderly and quote-focused, so a customer sends one enquiry and waits.",
      bestFor: "Contractors who quote before working",
      tone: "modern",
      themePriority: ["minimal", "studio", "bold"],
      photographyStyle: "minimal",
      buttonStyle: "soft",
      fontPairing: "grotesk",
      toneOfVoice: "Professional and clear",
    },
  ],
};

const DEFAULT_RECIPES: DirectionRecipe[] = [
  {
    key: "considered",
    name: "Considered",
    description: "Clean typography, generous spacing and calm colour — credible without effort.",
    bestFor: "Most businesses that want to look established",
    tone: "modern",
    themePriority: ["minimal", "editorial", "studio"],
    photographyStyle: "clean-studio",
    buttonStyle: "soft",
    fontPairing: "grotesk",
    toneOfVoice: "Clear and professional",
  },
  {
    key: "warm-local",
    name: "Warm local",
    description: "Warmer palette, softer cards and photography that feels like a real place.",
    bestFor: "Shops and services with a local customer base",
    tone: "warm",
    themePriority: ["studio", "editorial", "minimal"],
    photographyStyle: "warm",
    buttonStyle: "pill",
    fontPairing: "editorial-serif",
    toneOfVoice: "Friendly and personal",
  },
  {
    key: "premium",
    name: "Premium",
    description: "Dark accents, confident type and restrained photography for higher-value work.",
    bestFor: "Businesses competing on quality rather than price",
    tone: "premium",
    themePriority: ["luxury", "editorial", "bold", "minimal"],
    photographyStyle: "premium",
    buttonStyle: "outline",
    fontPairing: "editorial-serif",
    toneOfVoice: "Assured and understated",
  },
];

function recipesFor(categoryKey: CategoryKey | string | null | undefined): DirectionRecipe[] {
  const profile = getExperienceProfile(categoryKey);
  const specific = RECIPES[profile.key] || [];
  const merged = [...specific];
  for (const fallback of DEFAULT_RECIPES) {
    if (merged.length >= 3) break;
    if (!merged.some((recipe) => recipe.key === fallback.key)) merged.push(fallback);
  }
  return merged.slice(0, 3);
}

function pickTheme(categoryKey: CategoryKey | string | null | undefined, priority: string[]): string {
  const available = themesForCategory(categoryKey);
  for (const keyword of priority) {
    const match = available.find((theme) => theme.key.toLowerCase().includes(keyword) || theme.name.toLowerCase().includes(keyword));
    if (match) return match.key;
  }
  if (available[0]) return available[0].key;
  return resolveExperienceTheme(getExperienceProfile(categoryKey).defaultThemeKey).key;
}

/**
 * Produces three differentiated directions. Brand colours already chosen by the owner are kept:
 * a direction changes *how* they are used, never which colour the business is known by.
 */
export function designDirections(input: {
  categoryKey: CategoryKey | string | null | undefined;
  businessName: string;
  brand?: ExperienceBrand | null;
  themeKey?: string | null;
}): DesignDirection[] {
  const profile = getExperienceProfile(input.categoryKey);
  const brand = input.brand || {};

  return recipesFor(input.categoryKey).map((recipe) => {
    const themeKey = pickTheme(input.categoryKey, recipe.themePriority);
    const theme = resolveExperienceTheme(themeKey);
    const photography = resolvePhotographyStyle(recipe.photographyStyle);
    const primary = /^#[0-9a-fA-F]{6}$/.test(String(brand.primaryColor || "")) ? String(brand.primaryColor).toUpperCase() : theme.palette.primary;
    const accent = /^#[0-9a-fA-F]{6}$/.test(String(brand.accentColor || "")) ? String(brand.accentColor).toUpperCase() : theme.palette.accent;
    const secondary = /^#[0-9a-fA-F]{6}$/.test(String(brand.secondaryColor || "")) ? String(brand.secondaryColor).toUpperCase() : theme.palette.surface;

    return {
      key: recipe.key,
      name: recipe.name,
      description: recipe.description,
      bestFor: recipe.bestFor,
      tone: recipe.tone,
      themeKey,
      brand: {
        primaryColor: primary,
        secondaryColor: secondary,
        accentColor: accent,
        buttonStyle: recipe.buttonStyle,
        fontPairing: recipe.fontPairing,
      },
      photographyStyle: photography.key,
      swatches: [theme.palette.bg, theme.palette.surface, primary, accent, theme.palette.text],
      typography: `${theme.treatment.display} headlines, ${theme.treatment.body} body`,
      toneOfVoice: recipe.toneOfVoice,
    };
  });
}

/** The direction that best matches what the site already uses, for the "current" badge. */
export function currentDirection(input: { categoryKey: CategoryKey | string | null | undefined; businessName: string; brand?: ExperienceBrand | null; themeKey?: string | null }): DesignDirection {
  const directions = designDirections(input);
  return directions.find((direction) => direction.themeKey === input.themeKey) || directions[0];
}

/** Default photography style for a category, used when a direction has not been chosen yet. */
export function initialPhotographyStyle(categoryKey: CategoryKey | string | null | undefined): string {
  void getExperienceProfile(categoryKey);
  return defaultStyleForCategory(categoryKey);
}
