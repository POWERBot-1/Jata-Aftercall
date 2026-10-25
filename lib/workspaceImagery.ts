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

const LANDING = "/landing";
const WORKSPACE = "/workspace";

function landingPhoto(slug: string, alt: string): WorkspacePhoto {
  return {
    src: `${LANDING}/${slug}.jpg`,
    srcSet: `${LANDING}/${slug}-720.jpg 720w, ${LANDING}/${slug}.jpg 1100w`,
    webp: `${LANDING}/${slug}.webp`,
    webpSrcSet: `${LANDING}/${slug}-720.webp 720w, ${LANDING}/${slug}.webp 1100w`,
    alt,
    width: 1100,
    height: 684,
  };
}

function workspacePhoto(slug: string, alt: string): WorkspacePhoto {
  return {
    src: `${WORKSPACE}/${slug}.jpg`,
    srcSet: `${WORKSPACE}/${slug}-720.jpg 720w, ${WORKSPACE}/${slug}.jpg 1200w`,
    webp: `${WORKSPACE}/${slug}-1200.webp`,
    webpSrcSet: `${WORKSPACE}/${slug}-720.webp 720w, ${WORKSPACE}/${slug}-1200.webp 1200w`,
    alt,
    width: 1200,
    height: 670,
  };
}

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
export const CATEGORY_PHOTOS: Record<string, WorkspacePhoto> = {
  food: landingPhoto("nyumbani-kitchen", "Illustrative photo of a Kenyan kitchen serving plated food."),
  beauty: landingPhoto("marys-beauty-studio", "Illustrative photo of a small beauty studio's braiding and nails work area."),
  salon: landingPhoto("marys-beauty-studio", "Illustrative photo of a small salon's styling chairs and mirrors."),
  fashion: workspacePhoto("category-retail", "Illustrative photo of neatly folded fabrics and garments in a shop."),
  retail: workspacePhoto("category-retail", "Illustrative photo of a small neighbourhood shop with stocked shelves."),
  electronics: workspacePhoto("category-retail", "Illustrative photo of a small shop with goods arranged on shelves."),
  automotive: landingPhoto("kamau-auto-care", "Illustrative photo of a small vehicle workshop bay."),
  technical: landingPhoto("kamau-auto-care", "Illustrative photo of a small technical workshop with tools."),
  realestate: landingPhoto("john-kamau-properties", "Illustrative photo of a residential property exterior."),
  hospitality: landingPhoto("john-kamau-properties-interior", "Illustrative photo of a warm, furnished guest interior."),
  furniture: landingPhoto("john-kamau-properties-interior", "Illustrative photo of a furnished interior with wooden furniture."),
  fitness: workspacePhoto("category-fitness", "Illustrative photo of a small studio with mats and weights."),
  creative: workspacePhoto("category-professional", "Illustrative photo of a calm desk with a laptop and notebook."),
  professional: workspacePhoto("category-professional", "Illustrative photo of a calm professional office desk."),
  education: workspacePhoto("category-professional", "Illustrative photo of a quiet desk prepared for study or tutoring."),
  other: workspacePhoto("category-produce", "Illustrative photo of a fresh produce stall with baskets of vegetables and fruit."),
};

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
  const key = (category || "").trim().toLowerCase();
  if (!key) return CATEGORY_PHOTOS.other;
  // Direct profile keys ("beauty") and stored labels ("Beauty & Salon") are both handled:
  // profile keys match the map, labels are matched against the shared alias registry.
  if (CATEGORY_PHOTOS[key]) return CATEGORY_PHOTOS[key];
  const aliases: Array<[RegExp, string]> = [
    [/\b(food|restaurant|menu|cafe|café|hotel|eatery|bakery|butcher|caterer)\b/, "food"],
    [/\b(beauty|salon|spa|nail|braid|makeup|barber|hair)\b/, "beauty"],
    [/\b(fashion|clothes|clothing|tailor|boutique|shoe)\b/, "fashion"],
    [/\b(retail|shop|duka|store|grocery|supermarket|mini-?mart)\b/, "retail"],
    [/\b(electronic|phone|computer|laptop|gadget)\b/, "electronics"],
    [/\b(auto|car|vehicle|garage|mechanic|spare)\b/, "automotive"],
    [/\b(technic\w*|repair|welding|electric\w*|plumb\w*|carpent\w*|hardware)\b/, "technical"],
    [/\b(real ?estate|property|land|rental|letting)\b/, "realestate"],
    [/\b(hospitality|guest|airbnb|lodge|travel|tour)\b/, "hospitality"],
    [/\b(furniture|interior|decor|woodwork)\b/, "furniture"],
    [/\b(fitness|gym|workout|yoga|trainer)\b/, "fitness"],
    [/\b(creative|design|photo|music|art)\b/, "creative"],
    [/\b(professional|consult|law|legal|account|audit|finance|insurance)\b/, "professional"],
    [/\b(educat|school|tutor|training|college)\b/, "education"],
    [/\b(farm|agri|produce|grocery|vegetable|fruit|milk)\b/, "other"],
  ];
  for (const [pattern, mapped] of aliases) {
    if (pattern.test(key)) return CATEGORY_PHOTOS[mapped];
  }
  return CATEGORY_PHOTOS.other;
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
