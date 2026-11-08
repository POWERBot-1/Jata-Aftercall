/**
 * JATA AFTERCALL public storefront design tokens — the shared source of truth.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The public Business Page did not inherit the JATA AFTERCALL platform identity. It read a legacy
 * business-theme table (`lib/themes.ts`: clean / dark / warm) whose surfaces, text and accents were
 * defined independently of the platform's own product theme (`lib/productThemes.ts`: Lime Spark /
 * Graphite vs Emerald Ink / Champagne) and of the studio's experience theme. The result was a page
 * that looked like a third product: light cards, unrelated accents, no shared vocabulary.
 *
 * This module is the FIX AT THE SOURCE, not a CSS patch on one page. It defines, once:
 *
 *   1. the PLATFORM identity every public surface inherits — graphite structure, lime highlight,
 *      controlled surface steps, radii, shadows and motion;
 *   2. the BUSINESS identity layer — a logo, imagery, copy and an OPTIONAL accent colour, accepted
 *      only when it keeps accessible contrast on the platform's surfaces, and never allowed to
 *      restyle structure (radii, spacing, type scale, layout);
 *   3. the art direction per business category, so a restaurant, a salon and a garage read as
 *      themselves while still belonging to JATA AFTERCALL.
 *
 * Everything here is pure and dependency-free, so it can be unit-tested and imported from a server
 * component, a client component or a checking script without pulling React or Prisma along.
 */

/** The platform palette. These are the JATA AFTERCALL brand constants — a storefront may tint them,
 *  never replace them. */
export const PLATFORM_IDENTITY = {
  /** Deepest graphite: the page canvas. */
  graphite: "#16181d",
  /** First step up: the standard section surface. */
  graphiteRaised: "#1c1f26",
  /** Platform structure colour (the product theme's `--color-structure`). */
  structure: "#23262F",
  /** Raised card surface (the product theme's `--color-surface`). */
  surface: "#2D313B",
  /** Nested surface: rows inside a card (the product theme's `--color-surface-muted`). */
  surfaceMuted: "#383D48",
  /** The lime highlight. Used sparingly — one primary action and small accents per view. */
  lime: "#B6FF2E",
  limeHover: "#C8FF5C",
  /** Primary text on graphite. */
  text: "#F4F6F0",
  /** Secondary text on graphite. */
  muted: "#C2C8D1",
  /** Tertiary text: fine print only, still above 4.5:1 on `surface`. */
  fine: "#A8B0BC",
} as const;

/** Contrast floor for body text (WCAG 2.1 AA). */
export const AA_MINIMUM = 4.5;
/** Contrast floor for large text and non-text UI such as borders and icons (WCAG 2.1 AA). */
export const AA_LARGE_MINIMUM = 3;

export type CategoryArtKey = "restaurant" | "beauty" | "automotive" | "property" | "retail" | "general";

/**
 * Art direction by business category.
 *
 * A restaurant, a beauty studio, an auto garage and a property office must not look identical, but
 * they must all be unmistakably JATA AFTERCALL. The difference is carried by a single controlled
 * tone (used in the fallback composition, in hero scrims and in small accents) over the same
 * graphite structure — never by a different layout, type scale or component shape.
 */
export const CATEGORY_ART: Record<CategoryArtKey, { key: CategoryArtKey; label: string; tone: string; glow: string }> = {
  restaurant: { key: "restaurant", label: "Kitchen & dining", tone: "#F0A04B", glow: "rgba(240, 160, 75, 0.18)" },
  beauty: { key: "beauty", label: "Salon & beauty", tone: "#E9A6B8", glow: "rgba(233, 166, 184, 0.18)" },
  automotive: { key: "automotive", label: "Auto & workshop", tone: "#7FB2E5", glow: "rgba(127, 178, 229, 0.18)" },
  property: { key: "property", label: "Property & rentals", tone: "#79C9A4", glow: "rgba(121, 201, 164, 0.18)" },
  retail: { key: "retail", label: "Shop & retail", tone: "#C9B6FF", glow: "rgba(201, 182, 255, 0.18)" },
  general: { key: "general", label: "Local business", tone: "#B6FF2E", glow: "rgba(182, 255, 46, 0.18)" },
};

/** Maps a stored business category string onto the art-direction keys above. */
export function categoryArt(category?: string | null): (typeof CATEGORY_ART)[CategoryArtKey] {
  const value = (category ?? "").toLowerCase();
  if (/restaurant|food|kitchen|eat|cafe|coffee|butcher|bakery|catering/.test(value)) return CATEGORY_ART.restaurant;
  if (/salon|beauty|barber|spa|hair|nail|massage|cosmetic/.test(value)) return CATEGORY_ART.beauty;
  if (/auto|garage|motor|car|mechanic|tyre|boda|workshop/.test(value)) return CATEGORY_ART.automotive;
  if (/propert|real ?estate|rent|letting|land|apartment|house/.test(value)) return CATEGORY_ART.property;
  if (/retail|shop|general|hardware|supermarket|store|grocery|chemist|pharmacy/.test(value)) return CATEGORY_ART.retail;
  return CATEGORY_ART.general;
}

// ── colour maths ──────────────────────────────────────────────────────────────────────────────

function isHexColour(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function expandHex(hex: string): string {
  const value = hex.trim().replace("#", "");
  if (value.length === 3) {
    return value
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return value;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isHexColour(hex)) return null;
  const value = expandHex(hex);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG 2.1 contrast ratio between two hex colours. `null` when either colour is not a hex value. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type BusinessAccent = {
  /** The colour the storefront will actually use. */
  accent: string;
  /** Whether the business's own value survived validation. */
  accepted: boolean;
  /** Contrast of the accepted accent against the page canvas. */
  ratio: number;
};

/**
 * Two-layer branding: a business may supply its own accent, but it is a GUEST on the platform's
 * structure.
 *
 * The colour is accepted only when it is a well-formed hex value and keeps at least 3:1 against the
 * graphite canvas (the WCAG floor for large text, icons and UI borders). Anything else — a
 * different notation, a colour too dark to see, an arbitrary string — falls back to the platform
 * lime. A business colour never reaches a radius, a spacing step, a type size or a layout rule.
 */
export function businessAccent(raw: string | null | undefined, background: string = PLATFORM_IDENTITY.graphite): BusinessAccent {
  const fallback: BusinessAccent = {
    accent: PLATFORM_IDENTITY.lime,
    accepted: false,
    ratio: contrastRatio(PLATFORM_IDENTITY.lime, PLATFORM_IDENTITY.graphite) ?? 0,
  };
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!isHexColour(value)) return fallback;
  const normalised = `#${expandHex(value).toLowerCase()}`;
  const ratio = contrastRatio(normalised, background);
  if (ratio === null || ratio < AA_LARGE_MINIMUM) return fallback;
  return { accent: normalised, accepted: true, ratio };
}
