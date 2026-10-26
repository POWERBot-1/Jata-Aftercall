/**
 * Workspace imagery.
 *
 * The authenticated workspace is image-first: every business card, studio door, POS
 * door and empty state carries a photograph that matches what the business actually
 * does. Photographs are only ever *category* illustrations — never a photograph of the
 * owner's business, never a stock "performance" chart, never a claim about results. Each
 * one therefore ships with an honest alt text that says it is illustrative.
 *
 * Everything here is a static string table (no imports, no client code), so a server
 * component can pick the image for a business without shipping a data bundle to the
 * browser. The chosen URL is stable per category, so repeat visits hit the HTTP cache
 * and the browser only downloads a new photograph when the category differs.
 *
 * The two file sizes per photograph (~1200px and 720px wide, WebP + JPEG) keep the
 * dashboard inside a mobile data budget: a phone picks the 720px WebP (~25–90 KB),
 * a desktop picks the wide file. Dimensions are declared so the image reserves its box
 * and never shifts the layout while it loads.
 */

import { CATEGORY_IMAGES, EXPERIENCE_CATEGORY_IMAGE, imageForCategoryText } from "@/lib/categoryImagery";

export type WorkspacePhoto = {
  /** Fallback JPEG. Always present: WebP can be unsupported and the page still renders. */
  src: string;
  /** `srcSet` for the fallback JPEG, smallest first. */
  srcSet?: string;
  /** WebP source. Served first when the browser advertises support. */
  webp?: string;
  webpSrcSet?: string;
  /** Honest description of what the reader will actually see. */
  alt: string;
  width: number;
  height: number;
};

const WORKSPACE = "/workspace";

/** The photograph behind the dashboard hero: Nairobi at dusk, graphite and amber. */
export const WORKSPACE_HERO_PHOTO: WorkspacePhoto = {
  src: `${WORKSPACE}/hero-workspace.jpg`,
  srcSet: `${WORKSPACE}/hero-workspace-900.jpg 900w, ${WORKSPACE}/hero-workspace.jpg 1600w`,
  webp: `${WORKSPACE}/hero-workspace-1600.webp`,
  webpSrcSet: `${WORKSPACE}/hero-workspace-900.webp 900w, ${WORKSPACE}/hero-workspace-1600.webp 1600w`,
  alt: "Nairobi at dusk, seen from above, with warm street lights across the city.",
  width: 1600,
  height: 679,
};

/**
 * Category → photograph.
 *
 * Keys are the profile keys of the shared category engine (`lib/experience/categories`).
 * A business stores its category as free text, so lookups go through
 * `resolveExperienceProfile()` first; anything unrecognised lands on the produce-market
 * photograph rather than a broken image or a generic grey box.
 */
/**
 * Derived from the shared category imagery registry (`lib/categoryImagery`), so the
 * dashboard, Website Studio and POS can never drift onto different pictures for the same
 * trade — and unrelated trades no longer share one generic photo (electronics, fashion,
 * furniture, education and creative each have their own since the 2026-10-26 pass).
 */
export const CATEGORY_PHOTOS: Record<string, WorkspacePhoto> = Object.fromEntries(
  Object.entries(EXPERIENCE_CATEGORY_IMAGE).map(([key, imageId]) => [key, CATEGORY_IMAGES[imageId]]),
);

/** Category keys for the plan/feature sections that have no single business attached. */
export const WORKSPACE_PHOTOS = {
  professional: CATEGORY_PHOTOS.professional,
  retail: CATEGORY_PHOTOS.retail,
  produce: CATEGORY_PHOTOS.other,
  fitness: CATEGORY_PHOTOS.fitness,
} as const;

/**
 * Photograph for a stored category string.
 *
 * Never throws and never returns an empty value: a business created before categories
 * existed, or one with hand-typed text, still gets a real photograph.
 */
export function photoForCategory(category: string | null | undefined): WorkspacePhoto {
  // Direct profile keys ("beauty"), stored labels ("Beauty & Salon"), POS trade keys and
  // hand-typed free text ("Hardware & electrical") all resolve through the one registry,
  // which also knows pharmacy, transport, agriculture and hardware photographs.
  return imageForCategoryText(category);
}

/**
 * Up to two initials for the avatar monogram. Deterministic, so the server render and the
 * client hydration produce the same letters.
 */
export function businessInitials(name: string | null | undefined): string {
  const words = (name || "")
    .replace(/[^\p{L}\p{N}\s'&-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return "JA";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * A friendly, human category name. Stored categories are free text, so this only tidies
 * the casing and spacing — it never invents a different category.
 */
export function categoryLabel(category: string | null | undefined): string {
  const value = (category || "").trim();
  if (!value) return "Business";
  return value
    .split(/\s+/)
    .map((word) => (word.length > 3 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Guard for owner-supplied image URLs (business cover and logo).
 *
 * Only an https URL, a site-relative path or an inline image is rendered; anything else
 * (`javascript:`, `data:text/html`, a protocol-relative URL) is dropped, so a stored value
 * can never inject script or point the card at an unexpected origin. Returns the value
 * unchanged when it is safe, otherwise `null` and the category photograph is used instead.
 */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = value.trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (/^https:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url;
  return null;
}
