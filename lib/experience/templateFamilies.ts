/** Versioned, renderer-supported Lite compositions. Names follow the full master §8.
 * Spatial/showroom families have deliberate HTML fallbacks, NOT a claim of WebGPU/3D capability.
 * No provider/network/asset generation, commercial facts, free-form CSS, JS or arbitrary graphs.
 */
import type { CategoryKey, ExperienceSection, SectionType } from "./types";
import type { HeroStyle, NavStyle, CardStyle } from "./themes";

export const TEMPLATE_FAMILY_KEYS = ["cinematic", "editorial", "luxury", "minimal", "magazine", "marketplace", "product-first", "storytelling", "spatial", "interactive-showroom", "gallery", "split-screen", "fullscreen-media", "scrollytelling", "cardless-immersive", "map-driven", "catalog", "portfolio", "service-journey", "experimental"] as const;
export type TemplateFamilyKey = typeof TEMPLATE_FAMILY_KEYS[number];
export const DESIGN_GOALS = ["sell", "book", "enquire", "browse"] as const;
export type DesignGoal = typeof DESIGN_GOALS[number];
export const DESIGN_PERSONALITIES = ["warm", "minimal", "premium", "editorial", "bold"] as const;
export const DESIGN_AUDIENCES = ["local", "families", "professional", "premium", "discovery"] as const;
export const DESIGN_DENSITIES = ["compact", "balanced", "spacious"] as const;
export type DesignDensity = typeof DESIGN_DENSITIES[number];
export type ArtDirection = {
  version: 1;
  family: TemplateFamilyKey;
  goal: DesignGoal;
  personality: typeof DESIGN_PERSONALITIES[number];
  audience: typeof DESIGN_AUDIENCES[number];
  density: DesignDensity;
};
export type BodyComposition = "stack" | "paired" | "magazine" | "chapters" | "stage" | "location-led";
export type CatalogueComposition = "grid" | "list" | "editorial" | "carousel" | "spotlight" | "comparison";
export type GalleryComposition = "grid" | "masonry" | "strip" | "panorama" | "paired" | "mosaic";
export type TemplateFamily = {
  key: TemplateFamilyKey; name: string; rationale: string;
  categories: readonly CategoryKey[]; goals: readonly DesignGoal[];
  personality: ArtDirection["personality"]; audience: ArtDirection["audience"];
  hero: HeroStyle; heroTreatment: "standard" | "poster" | "stage";
  navigation: NavStyle; body: BodyComposition; catalogue: CatalogueComposition; gallery: GalleryComposition;
  density: DesignDensity; cards: CardStyle; mediaRatio: "4 / 3" | "3 / 4" | "16 / 9" | "1 / 1";
  motion: "none" | "subtle" | "expressive";
  /** Priority among movable EXISTING sections. Does not fabricate testimonials, facts or new assets. */
  flow: readonly SectionType[];
  immersive: "none" | "optional-scene-fallback";
};
const shop = ["categories", "featured", "menu", "collections", "properties", "services", "offers", "gallery", "about", "testimonials", "faq", "steps", "why", "hours", "location", "cta"] as const;
const story = ["about", "gallery", "why", "steps", "testimonials", "featured", "services", "menu", "properties", "collections", "categories", "offers", "faq", "hours", "location", "cta"] as const;
const journey = ["services", "steps", "why", "gallery", "testimonials", "about", "faq", "featured", "menu", "collections", "categories", "properties", "hours", "location", "offers", "cta"] as const;
const galleryFlow = ["gallery", "featured", "collections", "about", "properties", "menu", "services", "categories", "why", "testimonials", "steps", "faq", "hours", "location", "offers", "cta"] as const;
const place = ["location", "hours", "properties", "services", "menu", "featured", "gallery", "about", "steps", "why", "testimonials", "categories", "collections", "faq", "offers", "cta"] as const;
const allGoals: readonly DesignGoal[] = DESIGN_GOALS;
// Each definition differs in several actual layout dimensions, not just a label/palette.
function family(key: TemplateFamilyKey, name: string, categories: CategoryKey[], geometry: [HeroStyle, BodyComposition, CatalogueComposition, GalleryComposition, NavStyle, DesignDensity], extra: Partial<TemplateFamily> = {}): TemplateFamily {
  return { key, name, categories, goals: allGoals, rationale: "Content-led composition with visible HTML and server-bound customer actions.", personality: "warm", audience: "local", hero: geometry[0], body: geometry[1], catalogue: geometry[2], gallery: geometry[3], navigation: geometry[4], density: geometry[5], heroTreatment: "standard", cards: "plain", mediaRatio: "4 / 3", motion: "subtle", flow: shop, immersive: "none", ...extra };
}
export const TEMPLATE_FAMILIES: readonly TemplateFamily[] = [
  family("cinematic", "Cinematic", ["food", "hospitality", "beauty"], ["overlay", "stack", "spotlight", "panorama", "bar", "spacious"], { personality: "bold", rationale: "Lead with an existing strong image, then a prominent commercial selection." }),
  family("editorial", "Editorial", ["creative", "professional", "fashion"], ["split", "paired", "editorial", "paired", "inline", "balanced"], { personality: "editorial", flow: story, mediaRatio: "3 / 4" }),
  family("luxury", "Luxury", ["hospitality", "beauty", "furniture"], ["centered", "paired", "spotlight", "paired", "pill", "spacious"], { personality: "premium", audience: "premium", mediaRatio: "3 / 4" }),
  family("minimal", "Minimal", ["professional", "technical", "other"], ["band", "stack", "list", "grid", "inline", "compact"], { personality: "minimal", audience: "professional", motion: "none" }),
  family("magazine", "Magazine", ["fashion", "creative", "education"], ["split", "magazine", "editorial", "masonry", "bar", "balanced"], { personality: "editorial", audience: "discovery", flow: story }),
  family("marketplace", "Marketplace", ["retail", "electronics", "food"], ["band", "stack", "grid", "strip", "pill", "compact"], { audience: "discovery", cards: "bordered" }),
  family("product-first", "Product-first", ["retail", "electronics", "furniture"], ["split", "stage", "spotlight", "strip", "bar", "balanced"], { cards: "media", rationale: "Prioritise product imagery and server prices, without copying commercial records into config." }),
  family("storytelling", "Storytelling", ["professional", "fitness", "hospitality"], ["overlay", "chapters", "list", "panorama", "inline", "balanced"], { flow: story, audience: "families" }),
  family("spatial", "Spatial", ["automotive", "furniture", "realestate"], ["centered", "stage", "editorial", "mosaic", "bar", "spacious"], { immersive: "optional-scene-fallback", heroTreatment: "stage", flow: galleryFlow }),
  family("interactive-showroom", "Interactive showroom", ["furniture", "automotive", "electronics"], ["split", "stage", "carousel", "strip", "pill", "spacious"], { immersive: "optional-scene-fallback", heroTreatment: "stage", cards: "media" }),
  family("gallery", "Gallery", ["creative", "salon", "beauty"], ["overlay", "magazine", "grid", "masonry", "inline", "balanced"], { flow: galleryFlow, mediaRatio: "1 / 1" }),
  family("split-screen", "Split-screen", [], ["split", "paired", "grid", "paired", "pill", "balanced"], { mediaRatio: "3 / 4" }),
  family("fullscreen-media", "Fullscreen media", ["hospitality", "realestate"], ["overlay", "stack", "editorial", "panorama", "bar", "spacious"], { heroTreatment: "poster", flow: galleryFlow, mediaRatio: "16 / 9" }),
  family("scrollytelling", "Scrollytelling", ["education", "technical", "professional"], ["band", "chapters", "editorial", "paired", "inline", "spacious"], { flow: journey, personality: "editorial", audience: "professional" }),
  family("cardless-immersive", "Cardless immersive", ["furniture", "realestate", "hospitality"], ["overlay", "stage", "editorial", "mosaic", "bar", "spacious"], { immersive: "optional-scene-fallback", flow: galleryFlow, heroTreatment: "stage" }),
  family("map-driven", "Map-driven", ["realestate", "hospitality", "automotive", "food"], ["split", "location-led", "list", "paired", "pill", "balanced"], { flow: place, rationale: "Existing address/hours and real directions links first; no invented coordinates or new map-provider call." }),
  family("catalog", "Catalog", ["retail", "electronics", "technical"], ["band", "stack", "comparison", "grid", "inline", "compact"], { personality: "minimal", audience: "professional", cards: "bordered" }),
  family("portfolio", "Portfolio", ["creative", "professional"], ["split", "magazine", "spotlight", "masonry", "inline", "spacious"], { flow: galleryFlow, personality: "editorial", audience: "professional", mediaRatio: "3 / 4" }),
  family("service-journey", "Service journey", ["beauty", "salon", "technical", "fitness"], ["centered", "chapters", "list", "paired", "pill", "balanced"], { flow: journey, goals: ["book", "enquire", "browse"], rationale: "Lead from existing services through steps/trust to the existing booking or enquiry flow." }),
  family("experimental", "Experimental", ["creative", "fashion", "other"], ["centered", "magazine", "carousel", "mosaic", "bar", "balanced"], { personality: "bold", audience: "discovery", flow: story, motion: "expressive" }),
];
const registry = new Map(TEMPLATE_FAMILIES.map((entry) => [entry.key, entry]));
export const isTemplateFamily = (value: unknown): value is TemplateFamilyKey => typeof value === "string" && registry.has(value as TemplateFamilyKey);
export function templateFamily(key: TemplateFamilyKey): TemplateFamily { return registry.get(key)!; }
export function familyGeometrySignature(entry: TemplateFamily): string {
  return [entry.hero, entry.heroTreatment, entry.body, entry.catalogue, entry.gallery, entry.navigation, entry.density, entry.cards, entry.mediaRatio, entry.flow.join(",")].join("|");
}
export function templateForDocument(document: { version: number; artDirection?: ArtDirection }): TemplateFamily | null {
  return document.version === 2 && document.artDirection?.version === 1 && isTemplateFamily(document.artDirection.family) ? templateFamily(document.artDirection.family) : null;
}
/** Honour explicit editor layout choices; family defaults are presentation, not a rewrite of content. */
export function sectionLayout(section: ExperienceSection, direction?: ArtDirection): string {
  if (section.layout && section.layout !== "family") return section.layout;
  if (!direction || !isTemplateFamily(direction.family)) return section.layout === "family" ? "grid" : section.layout || "grid";
  const definition = templateFamily(direction.family);
  if (["featured", "menu", "services", "properties"].includes(section.type)) return definition.catalogue;
  if (section.type === "gallery") return definition.gallery;
  return section.layout || "grid";
}

export function parseArtDirection(input: unknown): ArtDirection {
  const raw = input as Record<string, unknown>;
  const fields = ["version", "family", "goal", "personality", "audience", "density"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !fields.includes(key)) || raw.version !== 1 || !isTemplateFamily(raw.family) ||
    !(DESIGN_GOALS as readonly unknown[]).includes(raw.goal) || !(DESIGN_PERSONALITIES as readonly unknown[]).includes(raw.personality) || !(DESIGN_AUDIENCES as readonly unknown[]).includes(raw.audience) || !(DESIGN_DENSITIES as readonly unknown[]).includes(raw.density)) {
    throw new Error("This website's art direction is not supported. Nothing was changed.");
  }
  return { version: 1, family: raw.family, goal: raw.goal as DesignGoal, personality: raw.personality as ArtDirection["personality"], audience: raw.audience as ArtDirection["audience"], density: raw.density as DesignDensity };
}
export const CATALOGUE_LAYOUT_KEYS = ["grid", "list", "compact", "family", "editorial", "carousel", "spotlight", "comparison"] as const;
export const GALLERY_LAYOUT_KEYS = ["grid", "family", "masonry", "strip", "panorama", "paired", "mosaic"] as const;
