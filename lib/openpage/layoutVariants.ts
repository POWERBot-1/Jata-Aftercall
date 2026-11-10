/**
 * OpenPage layout-variant registry (42 variants across 19 block types)
 *
 * Upstream OpenPage ships 19 blocks with 42 visual variants. JATA cannot render an
 * arbitrary HTML block: its storefront renderer consumes a validated Experience
 * document. This registry is the single, explicit mapping between the upstream
 * variants and the JATA section/layout vocabulary. A variant that cannot be rendered
 * safely is recorded as `unsupported` with the reason — it is never silently dropped.
 *
 * The registry is pure and client-safe; it is used by the generation engine, the
 * adapter and the Studio's "layout variant" picker.
 */

import { blockMetadata } from "./blockMetadata";
import type { BlockType } from "./types";
import { sectionDefinition } from "@/lib/experience/sections";
import type { SectionType } from "@/lib/experience/types";

export type LayoutVariantSupport =
  /** The variant changes a real JATA section/layout value. */
  | "mapped"
  /** The variant is platform chrome (navigation/footer) or a purely visual separator. */
  | "presentational"
  /** The variant cannot be represented by the JATA Experience schema. */
  | "unsupported";

export type OpenPageLayoutVariant = {
  /** Stable id, e.g. `hero/split`. */
  id: string;
  blockType: BlockType;
  variant: string;
  blockLabel: string;
  support: LayoutVariantSupport;
  /** JATA sections this variant feeds when it is mapped. */
  sectionTypes: SectionType[];
  /** JATA section `layout` value written by the adapter, when one exists. */
  jataLayout?: string;
  /** Why an unsupported variant is not imported. Always present for `unsupported`. */
  reason?: string;
};

type Mapping = Omit<OpenPageLayoutVariant, "id" | "blockType" | "variant" | "blockLabel">;

const MAPPING: Record<BlockType, Record<string, Mapping>> = {
  navbar: {
    default: { support: "presentational", sectionTypes: ["navigation"], reason: "JATA renders its own tenant navigation from the document's visible sections." },
    centered: { support: "presentational", sectionTypes: ["navigation"], reason: "Navigation alignment is a JATA theme treatment, not owner content." },
  },
  hero: {
    centered: { support: "mapped", sectionTypes: ["hero"], jataLayout: "centered" },
    split: { support: "mapped", sectionTypes: ["hero"], jataLayout: "split" },
    gradient: { support: "mapped", sectionTypes: ["hero"], jataLayout: "gradient" },
    minimal: { support: "mapped", sectionTypes: ["hero"], jataLayout: "minimal" },
  },
  features: {
    grid: { support: "mapped", sectionTypes: ["why", "featured", "menu", "services", "categories", "collections", "properties", "steps", "hours"], jataLayout: "grid" },
    list: { support: "mapped", sectionTypes: ["why", "featured", "menu", "services", "categories", "collections", "properties", "steps", "hours"], jataLayout: "list" },
    alternating: { support: "mapped", sectionTypes: ["why", "featured", "menu", "services", "categories", "collections", "properties", "steps", "hours"], jataLayout: "compact" },
  },
  pricing: {
    simple: { support: "unsupported", sectionTypes: [], reason: "Prices are commercial facts owned by the JATA catalogue. A generated price table is never imported." },
    comparison: { support: "unsupported", sectionTypes: [], reason: "Plan comparison needs real plan data; JATA shows its own subscription products instead." },
  },
  cta: {
    simple: { support: "mapped", sectionTypes: ["cta"], jataLayout: "simple" },
    split: { support: "mapped", sectionTypes: ["cta"], jataLayout: "split" },
  },
  footer: {
    simple: { support: "presentational", sectionTypes: [], reason: "JATA's storefront shell owns the footer, contact links and legal line." },
    "multi-column": { support: "presentational", sectionTypes: [], reason: "JATA's storefront shell owns the footer, contact links and legal line." },
    minimal: { support: "presentational", sectionTypes: [], reason: "JATA's storefront shell owns the footer, contact links and legal line." },
  },
  testimonials: {
    cards: { support: "mapped", sectionTypes: ["testimonials"], jataLayout: "grid" },
    carousel: { support: "mapped", sectionTypes: ["testimonials"], jataLayout: "carousel" },
    spotlight: { support: "mapped", sectionTypes: ["testimonials"], jataLayout: "spotlight" },
  },
  stats: {
    grid: { support: "unsupported", sectionTypes: [], reason: "Statistics such as '200+ projects' are unverified claims; JATA never imports invented numbers." },
    bar: { support: "unsupported", sectionTypes: [], reason: "Statistics such as '200+ projects' are unverified claims; JATA never imports invented numbers." },
    counter: { support: "unsupported", sectionTypes: [], reason: "Statistics such as '200+ projects' are unverified claims; JATA never imports invented numbers." },
  },
  faq: {
    accordion: { support: "mapped", sectionTypes: ["faq"], jataLayout: "accordion" },
  },
  team: {
    grid: { support: "unsupported", sectionTypes: [], reason: "Team members are people facts. JATA has no team model, and generated names would be false." },
  },
  contact: {
    form: { support: "mapped", sectionTypes: ["contact"], jataLayout: "form" },
  },
  newsletter: {
    simple: { support: "unsupported", sectionTypes: [], reason: "JATA has no newsletter subscription integration; collecting emails would have nowhere to go." },
  },
  logocloud: {
    default: { support: "unsupported", sectionTypes: [], reason: "Client/partner logos are unverified claims and require media the business has not supplied." },
  },
  content: {
    prose: { support: "mapped", sectionTypes: ["about"], jataLayout: "prose" },
    columns: { support: "mapped", sectionTypes: ["about"], jataLayout: "columns" },
    highlight: { support: "mapped", sectionTypes: ["about"], jataLayout: "highlight" },
  },
  image: {
    "hero-image": { support: "mapped", sectionTypes: ["hero", "gallery"], jataLayout: "grid" },
    "side-by-side": { support: "mapped", sectionTypes: ["gallery"], jataLayout: "paired" },
    grid: { support: "mapped", sectionTypes: ["gallery"], jataLayout: "grid" },
  },
  video: {
    youtube: { support: "unsupported", sectionTypes: [], reason: "The JATA Experience schema has no video section and no moderated embed allowlist." },
    vimeo: { support: "unsupported", sectionTypes: [], reason: "The JATA Experience schema has no video section and no moderated embed allowlist." },
  },
  gallery: {
    grid: { support: "mapped", sectionTypes: ["gallery"], jataLayout: "grid" },
    masonry: { support: "mapped", sectionTypes: ["gallery"], jataLayout: "masonry" },
  },
  divider: {
    line: { support: "presentational", sectionTypes: [], reason: "Presentational spacing is owned by the JATA theme, not the content document." },
    space: { support: "presentational", sectionTypes: [], reason: "Presentational spacing is owned by the JATA theme, not the content document." },
    dots: { support: "presentational", sectionTypes: [], reason: "Presentational spacing is owned by the JATA theme, not the content document." },
  },
  banner: {
    ribbon: { support: "unsupported", sectionTypes: [], reason: "Announcements must come from a real JATA promotion/offer; free-text banners can make unverified claims." },
    bar: { support: "unsupported", sectionTypes: [], reason: "Announcements must come from a real JATA promotion/offer; free-text banners can make unverified claims." },
  },
};

export const OPENPAGE_LAYOUT_VARIANTS: OpenPageLayoutVariant[] = blockMetadata.flatMap((block) =>
  block.variants.map((variant) => {
    const mapping = MAPPING[block.type]?.[variant];
    if (!mapping) {
      return {
        id: `${block.type}/${variant}`,
        blockType: block.type,
        variant,
        blockLabel: block.label,
        support: "unsupported" as const,
        sectionTypes: [] as SectionType[],
        reason: "No explicit JATA mapping is registered for this OpenPage variant.",
      };
    }
    return {
      id: `${block.type}/${variant}`,
      blockType: block.type,
      variant,
      blockLabel: block.label,
      ...mapping,
    };
  }),
);

export const OPENPAGE_VARIANTS_BY_ID = new Map(OPENPAGE_LAYOUT_VARIANTS.map((entry) => [entry.id, entry]));

export function layoutVariantFor(blockType: BlockType, variant: string): OpenPageLayoutVariant | undefined {
  return OPENPAGE_VARIANTS_BY_ID.get(`${blockType}/${variant}`);
}

/** Every variant that can change a rendered JATA section. Used by the Studio picker. */
export function mappedVariantsForSection(sectionType: SectionType): OpenPageLayoutVariant[] {
  // The inspector may only offer variants JATA can persist. Content sections (hero,
  // about, gallery, testimonials) have no `layout` field, so their OpenPage variant is
  // expressed by the art-direction family instead.
  const definition = sectionDefinition(sectionType);
  if (!definition?.fields.some((field) => field.key === "layout")) return [];
  return OPENPAGE_LAYOUT_VARIANTS.filter((entry) => entry.support === "mapped" && entry.sectionTypes.includes(sectionType));
}

/** Down-maps an upstream variant to one of JATA's three persisted section layouts. */
export function jataLayoutValueFor(sectionType: SectionType, upstreamLayout: string | undefined): "grid" | "list" | "compact" | undefined {
  const definition = sectionDefinition(sectionType);
  if (!definition?.fields.some((field) => field.key === "layout")) return undefined;
  if (upstreamLayout === "list") return "list";
  if (upstreamLayout === "compact") return "compact";
  return "grid";
}

/** Upstream visual variant names, adapted to the JATA layout value. */
export function jataLayoutForVariant(blockType: BlockType, variant: string): string | undefined {
  return layoutVariantFor(blockType, variant)?.jataLayout;
}

/** The reverse: the OpenPage variant that best represents an existing JATA layout. */
export function openPageVariantForJataLayout(blockType: BlockType, layout: string | undefined): string {
  const metadata = blockMetadata.find((entry) => entry.type === blockType);
  const fallback = metadata?.variants[0] || "default";
  if (!layout) return fallback;
  const match = OPENPAGE_LAYOUT_VARIANTS.find(
    (entry) => entry.blockType === blockType && entry.support === "mapped" && entry.jataLayout === layout,
  );
  return match?.variant || fallback;
}
