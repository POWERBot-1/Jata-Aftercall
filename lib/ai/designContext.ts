/**
 * Design context (§8, §44, §30)
 *
 * One description of how a business should *look and sound*, derived from data the business
 * already gave us: its category, its brand colours, its chosen theme and the design direction
 * it picked. Every AI call — copy, alt text, product photo, hero image — is given this context,
 * which is why ten dishes on one menu come back looking like they came from the same kitchen
 * instead of ten different stock libraries.
 *
 * No secrets, no user data, no invented facts: colours, mood words and composition rules only.
 */

import { getExperienceProfile } from "../experience/categories";
import { resolveExperienceTheme } from "../experience/themes";
import { layoutSummaryOf } from "../experience/variant";
import { PHOTOGRAPHY_STYLE_KEYS, type CategoryKey, type ExperienceBrand, type ExperienceDocument } from "../experience/types";

export type PhotographyStyle = {
  key: string;
  label: string;
  /** How the subject is lit. */
  lighting: string;
  /** Where the subject sits. */
  background: string;
  /** How tightly it is framed. */
  composition: string;
  /** Colour treatment of the final image. */
  grade: string;
};

const PHOTOGRAPHY_STYLES: Record<string, PhotographyStyle> = {
  "clean-studio": {
    key: "clean-studio",
    label: "Clean studio",
    lighting: "soft even studio light from the front-left, gentle fill, no harsh shadows",
    background: "seamless neutral seamless backdrop with a subtle contact shadow",
    composition: "centred product shot, generous margin, eye-level",
    grade: "true-to-life colour, clean whites, mild contrast",
  },
  premium: {
    key: "premium",
    label: "Premium",
    lighting: "directional key light with a soft falloff and a subtle rim light",
    background: "deep gradient backdrop with a soft pool of light behind the subject",
    composition: "confident three-quarter angle, subject filling most of the frame",
    grade: "rich shadows, warm highlights, restrained saturation",
  },
  natural: {
    key: "natural",
    label: "Natural",
    lighting: "open daylight, slightly diffused, as it looks in real life",
    background: "honest everyday surface, gently out of focus",
    composition: "relaxed eye-level framing with a little negative space",
    grade: "natural colour, no heavy grading",
  },
  warm: {
    key: "warm",
    label: "Warm & homely",
    lighting: "warm window light with soft shadows",
    background: "timber or linen surface with homely props kept to the edges",
    composition: "close, inviting framing that suggests sharing",
    grade: "warm highlights, soft contrast, cosy feel",
  },
  luxury: {
    key: "luxury",
    label: "Luxury",
    lighting: "single dramatic light source, deep shadows, controlled specular highlights",
    background: "dark textured backdrop, minimal props",
    composition: "cinematic framing with strong negative space",
    grade: "deep blacks, metallic highlights, restrained colour",
  },
  modern: {
    key: "modern",
    label: "Modern",
    lighting: "bright, even, high-key lighting",
    background: "graphic colour block or seamless paper matched to the brand palette",
    composition: "straight-on symmetrical framing",
    grade: "punchy colour, crisp edges, high clarity",
  },
  rustic: {
    key: "rustic",
    label: "Rustic",
    lighting: "moody side light with texture-revealing shadows",
    background: "weathered wood or stone surface",
    composition: "slightly high angle with tactile props",
    grade: "earthy tones, visible texture, muted highlights",
  },
  minimal: {
    key: "minimal",
    label: "Minimal",
    lighting: "broad, soft, shadowless light",
    background: "single flat colour drawn from the brand palette",
    composition: "lots of empty space, subject small and precisely placed",
    grade: "flat, calm, low contrast",
  },
};

export { PHOTOGRAPHY_STYLE_KEYS };

export function resolvePhotographyStyle(key: string | null | undefined): PhotographyStyle {
  return PHOTOGRAPHY_STYLES[String(key || "")] || PHOTOGRAPHY_STYLES["clean-studio"];
}

export function photographyStyleOptions(): PhotographyStyle[] {
  return Object.values(PHOTOGRAPHY_STYLES);
}

/** Per-category art direction: what a good photo of this business actually looks like. */
const CATEGORY_ART_DIRECTION: Record<CategoryKey, { subject: string; mood: string; avoid: string }> = {
  food: { subject: "the prepared dish, plated or packed as it is served to a customer", mood: "appetising, generous, freshly made", avoid: "raw ingredients standing in for the finished dish" },
  beauty: { subject: "the product in its real packaging", mood: "clean, tactile, premium", avoid: "skin close-ups that imply medical results" },
  salon: { subject: "the finished styling result on a real client", mood: "confident, stylish, personal", avoid: "unrealistic hair regrowth claims" },
  fashion: { subject: "the garment worn or neatly presented on a hanger", mood: "considered, current, wearable", avoid: "designer logos that are not the business's own" },
  retail: { subject: "the actual product on a plain surface", mood: "honest, useful, everyday", avoid: "branded packaging the shop does not sell" },
  electronics: { subject: "the device, powered on where appropriate, with its real accessories", mood: "technical, trustworthy", avoid: "spec text or logos the owner did not supply" },
  automotive: { subject: "the vehicle or part being worked on, in a clean workshop", mood: "competent, dependable", avoid: "brand badges that are not on the customer's car" },
  realestate: { subject: "the room or building as it is, wide and well lit", mood: "spacious, truthful, welcoming", avoid: "furniture or features the property does not have" },
  furniture: { subject: "the finished piece in a real room", mood: "crafted, solid, lasting", avoid: "materials the workshop does not work in" },
  fitness: { subject: "the training space or session in progress", mood: "energising, disciplined", avoid: "before/after body imagery" },
  creative: { subject: "the studio at work or a finished portfolio frame", mood: "considered, expressive", avoid: "stock imagery presented as the studio's own work" },
  professional: { subject: "the team or workspace, calm and orderly", mood: "credible, senior, clear", avoid: "certifications or awards not supplied" },
  hospitality: { subject: "the room, the table or the view guests actually get", mood: "calm, comfortable, hosted well", avoid: "facilities the venue does not have" },
  education: { subject: "learners working with a tutor", mood: "focused, encouraging", avoid: "results or pass rates not supplied" },
  technical: { subject: "the completed job or the technician at work", mood: "practical, tidy, reliable", avoid: "industrial safety claims" },
  other: { subject: "the product or service exactly as the owner described it", mood: "clear, professional", avoid: "anything the owner did not supply" },
};

export type DesignContext = {
  businessName: string;
  categoryKey: CategoryKey;
  categoryLabel: string;
  /** Words the website should evoke, taken from the category profile. */
  mood: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
  };
  themeKey: string;
  /** Typography intent, described for prompts rather than as font files. */
  typography: string;
  photography: PhotographyStyle;
  artDirection: { subject: string; mood: string; avoid: string };
  /** Owner-chosen tone of voice, used for copy. */
  tone: string;
  language: "en" | "sw" | "mixed";
  location?: string | null;
  /** A short, stable fingerprint so providers can key on a consistent style. */
  styleSeed: string;
  /** Structural variation for this generation (Phase 3). Absent when the draft has no seeded variant. */
  variation?: { seed: string; layout: string } | null;
};

function hexOr(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : fallback;
}

function hashSeed(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildDesignContext(input: {
  businessName: string;
  categoryKey?: CategoryKey | string | null;
  brand?: ExperienceBrand | null;
  themeKey?: string | null;
  toneOfVoice?: string | null;
  language?: "en" | "sw" | "mixed" | null;
  location?: string | null;
  photographyStyle?: string | null;
  variation?: { seed: string; layout: string } | null;
}): DesignContext {
  const profile = getExperienceProfile(input.categoryKey);
  const theme = resolveExperienceTheme(input.themeKey || profile.defaultThemeKey);
  const brand = input.brand || {};
  const palette = theme.palette;
  const styleKey = String(input.photographyStyle || "").trim();

  return {
    businessName: String(input.businessName || "").trim().slice(0, 80),
    categoryKey: profile.key,
    categoryLabel: profile.label,
    mood: profile.mood,
    palette: {
      primary: hexOr(brand.primaryColor, palette.primary),
      secondary: hexOr(brand.secondaryColor, palette.surface),
      accent: hexOr(brand.accentColor, palette.accent),
      background: palette.bg,
      surface: palette.surface,
      text: palette.text,
    },
    themeKey: theme.key,
    typography: `${theme.treatment.display} headlines over ${theme.treatment.body} body text, ${theme.treatment.headingWeight >= 700 ? "strong" : "light"} heading weight`,
    photography: resolvePhotographyStyle(styleKey || defaultStyleForCategory(profile.key)),
    artDirection: CATEGORY_ART_DIRECTION[profile.key] || CATEGORY_ART_DIRECTION.other,
    tone: String(input.toneOfVoice || "Friendly").trim().slice(0, 60),
    language: input.language || "en",
    location: input.location ? String(input.location).slice(0, 80) : null,
    styleSeed: hashSeed(`${input.businessName}|${profile.key}|${theme.key}|${styleKey || defaultStyleForCategory(profile.key)}`),
    // Only present when a seeded variant exists, so existing contexts are unchanged.
    ...(input.variation ? { variation: { seed: input.variation.seed, layout: input.variation.layout } } : {}),
  };
}

/** Sensible starting style per category — owners can change it in Design. */
export function defaultStyleForCategory(categoryKey: CategoryKey | string | null | undefined): string {
  switch (getExperienceProfile(categoryKey).key) {
    case "food":
      return "warm";
    case "beauty":
    case "fashion":
      return "premium";
    case "salon":
    case "creative":
      return "modern";
    case "realestate":
    case "hospitality":
      return "natural";
    case "furniture":
      return "rustic";
    case "electronics":
    case "technical":
      return "clean-studio";
    case "professional":
      return "minimal";
    default:
      return "clean-studio";
  }
}

/** Convenience: the design context of a whole website document. */
export function designContextForDocument(document: ExperienceDocument, extras: { businessName?: string; toneOfVoice?: string | null; language?: "en" | "sw" | "mixed" | null } = {}): DesignContext {
  return buildDesignContext({
    businessName: extras.businessName || document.brand.businessName || "",
    categoryKey: document.categoryKey,
    brand: document.brand,
    themeKey: document.themeKey,
    toneOfVoice: extras.toneOfVoice,
    language: extras.language,
    location: document.settings.location ?? null,
    photographyStyle: (document as { photographyStyle?: string }).photographyStyle ?? null,
    // Carry the draft's structural seed into copy and image prompts, so writing varies with the layout.
    variation: document.generation?.seed ? { seed: document.generation.seed, layout: layoutSummaryOf(document) } : null,
  });
}
