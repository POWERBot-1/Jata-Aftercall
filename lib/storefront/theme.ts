/**
 * Public storefront theme resolution — the bridge from platform identity to the page.
 *
 * The classic public page is driven by a `ThemeTokens` object (see `lib/themes.ts`). Rather than
 * rewriting every consumer, this module RESOLVES the platform identity into that shape, so the
 * whole page inherits one design language from one place:
 *
 *   platform identity (graphite + lime)  →  storefront tokens  →  every public section
 *                                                ↑
 *                                     business accent (validated)
 *
 * A business keeps its own identity through its logo, its name, its imagery, its copy and — where it
 * has one — a validated accent colour. Structure is never negotiable: the surface steps, radii,
 * spacing, type scale and component shapes come from the platform.
 */

import { PLATFORM_IDENTITY, businessAccent, categoryArt, type CategoryArtKey } from "./tokens";

/** The token shape the public page and its panels consume (identical to `lib/themes.ts`). */
export type StorefrontTokens = {
  key: string;
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

export type StorefrontTheme = {
  tokens: StorefrontTokens;
  /** The accent in use: the business's own when it passed validation, otherwise the platform lime. */
  accent: string;
  accentIsBusinessOwn: boolean;
  /** Art direction chosen from the business's category. */
  art: ReturnType<typeof categoryArt>;
  /**
   * True when the business's own accent could not be used and the platform lime took its place.
   * Surfaced so a page can say so honestly instead of silently re-colouring the business.
   */
  accentFallbackReason: "none" | "absent" | "invalid" | "low-contrast";
};

function reasonFor(raw: string | null | undefined): StorefrontTheme["accentFallbackReason"] {
  if (raw === null || raw === undefined || raw.trim() === "") return "absent";
  const resolved = businessAccent(raw);
  if (resolved.accepted) return "none";
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.trim()) ? "low-contrast" : "invalid";
}

/**
 * The business's own accent, when the platform already stores a theme choice for it.
 *
 * The legacy public themes (clean / dark / warm) are the only per-business colour choice the
 * platform holds today. Their accent is carried forward — `warm` kept an amber highlight — and
 * every value is still validated by `businessAccent`, so a business can influence the highlight
 * colour and nothing else. Structure, type, spacing and shape remain the platform's.
 */
export function accentForLegacyTheme(theme: string | null | undefined): string | null {
  switch ((theme ?? "").toLowerCase()) {
    case "warm":
      return "#F0A04B";
    case "clean":
    case "dark":
    default:
      // Graphite-on-graphite: the platform lime is the correct highlight for the graphite themes.
      return null;
  }
}

/**
 * Resolves the public theme for one business.
 *
 * `accentHex` is the business's own accent when the platform stores one for it (a brand colour the
 * owner chose). It is validated, never trusted, and never allowed to restyle structure.
 */
export function storefrontThemeFor(options: {
  businessName?: string | null;
  category?: string | null;
  accentHex?: string | null;
} = {}): StorefrontTheme {
  const { accent, accepted } = businessAccent(options.accentHex);
  const art = categoryArt(options.category);
  const tokens: StorefrontTokens = {
    key: "jata-storefront",
    name: "JATA AFTERCALL storefront",
    description: "Graphite structure with a controlled lime highlight, inherited from the platform.",
    colors: {
      bg: `bg-[${PLATFORM_IDENTITY.graphite}]`,
      card: `bg-[${PLATFORM_IDENTITY.structure}]`,
      text: `text-[${PLATFORM_IDENTITY.text}]`,
      muted: `text-[${PLATFORM_IDENTITY.muted}]`,
      primary: `bg-[${accent}]`,
      primaryText: `text-[${PLATFORM_IDENTITY.graphite}]`,
      accent: `bg-[${accent}]`,
      // A hairline that reads on graphite without becoming a stripe.
      border: `border-[rgba(244,246,240,0.14)]`,
      surfaceMuted: `bg-[${PLATFORM_IDENTITY.surfaceMuted}]`,
    },
    radius: "rounded-2xl",
  };
  return {
    tokens,
    accent,
    accentIsBusinessOwn: accepted,
    art,
    accentFallbackReason: reasonFor(options.accentHex),
  };
}

/**
 * The hero image for a public page, or nothing at all.
 *
 * IMAGE IS EVERYTHING — but never at the cost of truth. Only images the platform actually holds for
 * this business are used: an uploaded cover, or the verified demo fixture's own illustrative
 * photograph. Nothing is generated, and nothing is presented as the business's own photography
 * unless it is: `isIllustrative` travels with the result so the alt text and the visible caption can
 * say so. When there is no image, the caller renders the intentional fallback composition rather
 * than a stock photograph standing in for a business that never supplied one.
 */
export function resolveHeroImage(options: {
  coverUrl?: string | null;
  demoImage?: { path: string; alt: string } | null;
}): { kind: "business" | "illustrative"; path: string; alt: string } | null {
  const cover = typeof options.coverUrl === "string" ? options.coverUrl.trim() : "";
  // Only same-origin paths and https URLs: the same rule the dashboard uses for workspace imagery.
  const safe = cover && (cover.startsWith("/") && !cover.startsWith("//") ? cover : /^https:\/\/[^\s"'<>]+$/i.test(cover) ? cover : null);
  if (safe) {
    return { kind: "business", path: safe, alt: "" };
  }
  const demo = options.demoImage;
  if (demo && typeof demo.path === "string" && demo.path.startsWith("/")) {
    return { kind: "illustrative", path: demo.path, alt: demo.alt };
  }
  return null;
}
