/**
 * Category imagery registry (image-first Studio + POS).
 *
 * One curated, category-aware starter gallery shared by Website Studio and Business POS.
 * Keys are the profile keys of the two real registries — the sixteen Website Studio
 * experience profiles (`lib/experience/categories`) and the POS business types
 * (`lib/pos/businessTypes`) — but this module deliberately does not import either: it is a
 * static string table with no server or client-only imports, so a phone never downloads the
 * 80 KB POS type registry just to render a picture. Coverage of both registries is enforced
 * by `tests/unit/category-imagery.test.ts`, which fails if a new category or trade is added
 * without a picture here.
 *
 * Every image is a *category illustration*: it shows the kind of business, never the owner's
 * own shop, product or results, and the alt text says so honestly. Images added in the
 * 2026-10-26 image-first pass under `/category/` are AI-generated for JATA and labelled as
 * such in `provenance`; the older `/landing/` and `/workspace/` photographs are JATA's
 * existing commissioned imagery. Nothing here is hot-linked or unlicensed stock.
 *
 * Each picture ships in two widths (720 px for phones, 1200 px for larger screens) and two
 * formats (WebP first, JPEG fallback) at roughly 40–90 KB, with declared dimensions so it
 * never shifts the layout while loading on a slow connection.
 */

export type CategoryImageProvenance = "jata-photo" | "ai-generated-illustration";

export type CategoryImage = {
  /** Stable registry id, e.g. "electronics". Persisted nowhere; URLs are what get saved. */
  id: string;
  /** Owner-facing name shown on the gallery card, e.g. "Phones & electronics". */
  label: string;
  /** Fallback JPEG (1200 px). */
  src: string;
  srcSet?: string;
  /** WebP served first when supported. */
  webp?: string;
  webpSrcSet?: string;
  /** Honest description: always says the picture is illustrative. */
  alt: string;
  width: number;
  height: number;
  /** What this picture is, so the UI can say "AI-made illustration" where true. */
  provenance: CategoryImageProvenance;
  /** Default crop focal point in percent (0–100), used as CSS `object-position`. */
  focal: { x: number; y: number };
};

const LANDING = "/landing";
const WORKSPACE = "/workspace";
const CATEGORY = "/category";

function landingPhoto(id: string, slug: string, label: string, alt: string, focal = { x: 50, y: 45 }): CategoryImage {
  return {
    id, label, alt, focal, provenance: "jata-photo",
    src: `${LANDING}/${slug}.jpg`,
    srcSet: `${LANDING}/${slug}-720.jpg 720w, ${LANDING}/${slug}.jpg 1100w`,
    webp: `${LANDING}/${slug}.webp`,
    webpSrcSet: `${LANDING}/${slug}-720.webp 720w, ${LANDING}/${slug}.webp 1100w`,
    width: 1100, height: 684,
  };
}

function workspacePhoto(id: string, slug: string, label: string, alt: string, focal = { x: 50, y: 45 }): CategoryImage {
  return {
    id, label, alt, focal, provenance: "jata-photo",
    src: `${WORKSPACE}/${slug}.jpg`,
    srcSet: `${WORKSPACE}/${slug}-720.jpg 720w, ${WORKSPACE}/${slug}.jpg 1200w`,
    webp: `${WORKSPACE}/${slug}-1200.webp`,
    webpSrcSet: `${WORKSPACE}/${slug}-720.webp 720w, ${WORKSPACE}/${slug}-1200.webp 1200w`,
    width: 1200, height: 670,
  };
}

/** AI-generated category illustration created for JATA (2026-10-26), under `/category/`. */
function categoryPhoto(id: string, label: string, alt: string, focal = { x: 50, y: 45 }): CategoryImage {
  return {
    id, label, alt, focal, provenance: "ai-generated-illustration",
    src: `${CATEGORY}/${id}.jpg`,
    srcSet: `${CATEGORY}/${id}-720.jpg 720w, ${CATEGORY}/${id}.jpg 1200w`,
    webp: `${CATEGORY}/${id}-1200.webp`,
    webpSrcSet: `${CATEGORY}/${id}-720.webp 720w, ${CATEGORY}/${id}-1200.webp 1200w`,
    width: 1200, height: 670,
  };
}

/**
 * The visual families. There is one picture per business *world*, not one generic picture
 * for everything: an electronics shop never gets the fashion rail, and a pharmacy never
 * gets the car workshop. Directly related trades (a salon and a beauty studio) may share.
 */
export const CATEGORY_IMAGES: Record<string, CategoryImage> = {
  food: landingPhoto("food", "nyumbani-kitchen", "Food & restaurant", "Illustrative photo of a Kenyan kitchen serving plated food."),
  beauty: landingPhoto("beauty", "marys-beauty-studio", "Beauty & salon", "Illustrative photo of a small beauty studio's braiding and nails work area."),
  salon: categoryPhoto("salon", "Salon & barber", "Illustrative AI-made image of a stylish Kenyan salon and barbershop with styling chairs, mirrors and warm light."),
  grocery: categoryPhoto("grocery", "Grocery & minimart", "Illustrative AI-made image of a bright Kenyan minimart with packed shelves and a checkout counter."),
  technical: categoryPhoto("technical", "Fundi & home services", "Illustrative AI-made image of a Kenyan electrician fundi at work with a toolbox, cables and tools on a bench.", { x: 45, y: 45 }),
  fashion: categoryPhoto("fashion", "Fashion & boutique", "Illustrative AI-made image of a Kenyan clothing boutique with colourful garments on rails and shelves."),
  retail: workspacePhoto("retail", "category-retail", "Shop & retail", "Illustrative photo of a small neighbourhood shop with stocked shelves."),
  produce: workspacePhoto("produce", "category-produce", "Mama mboga & fresh produce", "Illustrative photo of a fresh produce stall with baskets of vegetables and fruit.", { x: 55, y: 50 }),
  electronics: categoryPhoto("electronics", "Phones & electronics", "Illustrative AI-made image of a Nairobi phone and electronics accessories shop with a glass display counter."),
  automotive: landingPhoto("automotive", "kamau-auto-care", "Garage & car care", "Illustrative photo of a small vehicle workshop bay."),
  realestate: landingPhoto("realestate", "john-kamau-properties", "Property & rentals", "Illustrative photo of a residential property exterior."),
  hospitality: landingPhoto("hospitality", "john-kamau-properties-interior", "Hotel & stays", "Illustrative photo of a warm, furnished guest interior."),
  furniture: categoryPhoto("furniture", "Furniture & home", "Illustrative AI-made image of handcrafted wooden furniture in a Kenyan workshop showroom."),
  fitness: workspacePhoto("fitness", "category-fitness", "Fitness & wellness", "Illustrative photo of a small studio with mats and weights."),
  creative: categoryPhoto("creative", "Creative & photography", "Illustrative AI-made image of a photography studio with a camera, lights and editing desk."),
  professional: workspacePhoto("professional", "category-professional", "Professional services", "Illustrative photo of a calm professional office desk."),
  education: categoryPhoto("education", "Education & training", "Illustrative AI-made image of a bright tutoring classroom with desks, books and morning light."),
  hardware: categoryPhoto("hardware", "Hardware & building", "Illustrative AI-made image of a Kenyan hardware shop with tools, paint and building materials.", { x: 50, y: 50 }),
  pharmacy: categoryPhoto("pharmacy", "Pharmacy & health shop", "Illustrative AI-made image of a clean community pharmacy with tidy, unbranded shelves.", { x: 55, y: 45 }),
  agriculture: categoryPhoto("agriculture", "Farm & agrovet", "Illustrative AI-made image of a green Kenyan farm with harvested produce at golden hour.", { x: 50, y: 55 }),
  transport: categoryPhoto("transport", "Transport & delivery", "Illustrative AI-made image of a Nairobi delivery rider and matatu on a city street at golden hour.", { x: 60, y: 50 }),
};

/** The safe fallback for any business JATA cannot categorise yet. */
export const FALLBACK_CATEGORY_IMAGE: CategoryImage = CATEGORY_IMAGES.produce;

/**
 * Website Studio experience profile key → image id (`lib/experience/categories` keys).
 * Every profile has a dedicated world; only the `other` fallback shares (produce).
 */
export const EXPERIENCE_CATEGORY_IMAGE: Record<string, string> = {
  food: "food",
  beauty: "beauty",
  salon: "salon",
  fashion: "fashion",
  retail: "retail",
  electronics: "electronics",
  automotive: "automotive",
  realestate: "realestate",
  furniture: "furniture",
  fitness: "fitness",
  creative: "creative",
  professional: "professional",
  hospitality: "hospitality",
  education: "education",
  technical: "technical",
  other: "produce",
};

/**
 * POS business type key → image id (`lib/pos/businessTypes` keys). Related trades share a
 * world (a bakery and a restaurant are both food); unrelated trades never do.
 */
export const POS_TYPE_IMAGE: Record<string, string> = {
  // Food & drink
  restaurant: "food", cafe: "food", bar: "food", bakery: "food", butchery: "food", catering: "food",
  hotel: "hospitality",
  // Shops & retail
  retail: "retail", supermarket: "grocery", convenience_shop: "grocery", wholesale: "retail",
  grocery: "grocery", florist: "produce",
  electronics: "electronics",
  clothing: "fashion", boutique: "fashion", shoes: "fashion", fashion_designer: "fashion", tailor: "fashion",
  beauty_products: "beauty", furniture: "furniture",
  pharmacy: "pharmacy", clinic: "pharmacy", dental: "pharmacy", veterinary: "pharmacy",
  // Trade & supply
  hardware: "hardware", building_materials: "hardware", construction: "hardware",
  manufacturing: "hardware", workshop: "hardware", printing: "creative",
  marketplace_seller: "retail", online_seller: "retail",
  subscription_business: "professional", membership_business: "professional",
  // Beauty & personal care
  salon: "salon", barber: "salon", spa: "beauty",
  // Motoring & movement
  garage: "automotive", auto_repair: "automotive", car_wash: "automotive", spare_parts: "automotive",
  transport: "transport", courier: "transport",
  // Everyday services
  laundry: "retail", cleaning_service: "professional",
  // Farming
  farm: "agriculture", agribusiness: "agriculture",
  // Professional, property, education, events
  professional_services: "professional", consultancy: "professional", agency: "creative",
  real_estate: "realestate", education: "education",
  events: "hospitality", photography: "creative",
  other: "produce",
};

/** Free-text fallbacks, mirroring the workspace alias rules, for hand-typed categories. */
const FREE_TEXT_IMAGE: Array<[RegExp, string]> = [
  [/\b(pharmacy|chemist|clinic|dental|health|vet(erinary)?)\b/, "pharmacy"],
  [/\b(mama mboga|produce|vegetable|fruit|greengrocer)\b/, "produce"],
  [/\b(grocery|mini-?mart|supermarket)\b/, "grocery"],
  [/\b(farm|agri\w*|agrovet|livestock|crop|dairy|poultry)\b/, "agriculture"],
  [/\b(transport|taxi|matatu|logistics|courier|delivery|rider|boda)\b/, "transport"],
  [/\b(technic\w*|repair|welding|electric\w*|plumb\w*|fundi|carpent\w*)\b/, "technical"],
  [/\b(hardware|building|construction|mabati|cement|timber)\b/, "hardware"],
  [/\b(food|restaurant|menu|cafe|café|eatery|bakery|butcher|cater\w*|kitchen|choma)\b/, "food"],
  [/\b(beauty|cosmetic|makeup|spa|skincare)\b/, "beauty"],
  [/\b(salon|barber|hair|braid|nail)\b/, "salon"],
  [/\b(fashion|clothes|clothing|tailor|boutique|shoe|mitumba)\b/, "fashion"],
  [/\b(electronic|phone|computer|laptop|gadget|accessor)\b/, "electronics"],
  [/\b(auto|car|vehicle|garage|mechanic|spare)\b/, "automotive"],
  [/\b(handyman|home services)\b/, "technical"],
  [/\b(real ?estate|property|land|rental|letting|agent)\b/, "realestate"],
  [/\b(hotel|hospitality|guest|airbnb|lodge|travel|tour)\b/, "hospitality"],
  [/\b(furniture|interior|decor|woodwork|sofa)\b/, "furniture"],
  [/\b(fitness|gym|workout|yoga|trainer|wellness)\b/, "fitness"],
  [/\b(creative|design|photo|music|art|print)\b/, "creative"],
  [/\b(educat|school|tutor|training|college|academy)\b/, "education"],
  [/\b(professional|consult|law|legal|account|audit|finance|insurance|office)\b/, "professional"],
  [/\b(retail|shop|duka|duka|supermarket|mini-?mart|store)\b/, "retail"],
];

export function categoryImageById(id: string | null | undefined): CategoryImage {
  return (id && CATEGORY_IMAGES[id]) || FALLBACK_CATEGORY_IMAGE;
}

/** Image for a Website Studio experience profile key (or a stored free-text category). */
export function imageForExperienceCategory(categoryKey: string | null | undefined): CategoryImage {
  const key = (categoryKey || "").trim().toLowerCase();
  if (key && EXPERIENCE_CATEGORY_IMAGE[key]) return categoryImageById(EXPERIENCE_CATEGORY_IMAGE[key]);
  return imageForCategoryText(key);
}

/** Image for a POS business type key. Unknown types fall back safely, never to a broken image. */
export function imageForPosType(typeKey: string | null | undefined): CategoryImage {
  const key = (typeKey || "").trim().toLowerCase();
  if (key && POS_TYPE_IMAGE[key]) return categoryImageById(POS_TYPE_IMAGE[key]);
  return imageForCategoryText(key);
}

/** Best-effort image for a hand-typed category. Never throws, never returns empty. */
export function imageForCategoryText(category: string | null | undefined): CategoryImage {
  const key = (category || "").trim().toLowerCase();
  if (!key) return FALLBACK_CATEGORY_IMAGE;
  if (CATEGORY_IMAGES[key]) return CATEGORY_IMAGES[key];
  if (EXPERIENCE_CATEGORY_IMAGE[key]) return categoryImageById(EXPERIENCE_CATEGORY_IMAGE[key]);
  if (POS_TYPE_IMAGE[key]) return categoryImageById(POS_TYPE_IMAGE[key]);
  for (const [pattern, id] of FREE_TEXT_IMAGE) {
    if (pattern.test(key)) return categoryImageById(id);
  }
  return FALLBACK_CATEGORY_IMAGE;
}

/**
 * The starter gallery for one business: its own category's picture first (the suggested
 * image), then every other world, so an owner whose shop does two things can still pick a
 * better fit. `suggestedId` names the "original" a Restore action returns to.
 */
export function starterGallery(suggested: CategoryImage): { suggestedId: string; images: CategoryImage[] } {
  const rest = Object.values(CATEGORY_IMAGES).filter((image) => image.id !== suggested.id);
  return { suggestedId: suggested.id, images: [suggested, ...rest] };
}

export function galleryForExperienceCategory(categoryKey: string | null | undefined) {
  return starterGallery(imageForExperienceCategory(categoryKey));
}

export function galleryForPosType(typeKey: string | null | undefined) {
  return starterGallery(imageForPosType(typeKey));
}

/** Every registry URL, for allow-list checks where an owner picks a starter image. */
export function categoryImageUrls(): Set<string> {
  const urls = new Set<string>();
  for (const image of Object.values(CATEGORY_IMAGES)) {
    urls.add(image.src);
    if (image.webp) urls.add(image.webp);
    for (const set of [image.srcSet, image.webpSrcSet]) {
      for (const entry of (set || "").split(",")) {
        const url = entry.trim().split(/\s+/)[0];
        if (url) urls.add(url);
      }
    }
  }
  return urls;
}

export function isCategoryImageUrl(url: string | null | undefined): boolean {
  return Boolean(url) && categoryImageUrls().has(String(url));
}

/** Registry image matching a saved URL (any width/format variant), if it is one of ours. */
export function categoryImageForUrl(url: string | null | undefined): CategoryImage | null {
  if (!url) return null;
  for (const image of Object.values(CATEGORY_IMAGES)) {
    if (image.src === url || image.webp === url) return image;
  }
  return null;
}

/** Clamp a focal point to a safe 5–95% so an edge crop can never push the subject out. */
export function clampFocal(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(5, Math.min(95, Math.round(n)));
}

export function focalToObjectPosition(focal: { x: number; y: number } | null | undefined): string {
  if (!focal) return "50% 45%";
  return `${clampFocal(focal.x, 50)}% ${clampFocal(focal.y, 45)}%`;
}
