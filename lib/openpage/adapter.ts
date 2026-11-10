/**
 * Strict adapter between OpenPage's `SiteConfig` and JATA's Experience document.
 *
 * JATA Experience is the single source of truth. OpenPage JSON is an interchange and
 * editor view: it is validated, converted, and then normalized by JATA's own schema
 * before any draft is saved. Raw OpenPage JSON is never persisted as website content.
 *
 * Mapping rules:
 *   • a block maps to a registered JATA section, or is recorded as unsupported;
 *   • an existing JATA section is matched by block id, so editor round-trips preserve
 *     data sections (catalogue, hours, location) without copying commercial facts;
 *   • existing JATA sections that have no OpenPage block are retained, not discarded;
 *   • generated testimonials/FAQ answers/statistics/prices/team members are never
 *     accepted as facts. They are reported for review and cannot overwrite owner content.
 */

import type { ExperienceDocument, ExperienceSection, SectionType } from "@/lib/experience/types";
import { sectionDefinition } from "@/lib/experience/sections";
import { getExperienceProfile } from "@/lib/experience/categories";
import { blockMetadata } from "./blockMetadata";
import { jataLayoutForVariant, jataLayoutValueFor, openPageVariantForJataLayout } from "./layoutVariants";
import { activePage, validateSiteConfig } from "./siteConfig";
import type { BlockConfig, BlockType, SiteConfig } from "./types";

export type AdapterNote = {
  code: string;
  message: string;
  severity: "info" | "warning";
  blockId?: string;
  blockType?: string;
  sectionId?: string;
  sectionType?: string;
};

export type MappedBlock = {
  blockId: string;
  blockType: BlockType;
  variant: string;
  sectionId: string;
  sectionType: SectionType;
};

export type SiteConfigToExperienceResult = {
  document: ExperienceDocument;
  mapped: MappedBlock[];
  unsupported: AdapterNote[];
  retained: Array<{ sectionId: string; sectionType: SectionType; reason: string }>;
  reviewRequired: AdapterNote[];
  repaired: boolean;
};

export type ExperienceToSiteConfigResult = {
  config: SiteConfig;
  mapped: MappedBlock[];
  unsupported: AdapterNote[];
  /** Sections whose content could not be represented; their JATA source is untouched. */
  retained: Array<{ sectionId: string; sectionType: SectionType; reason: string }>;
};

export type AdapterOptions = {
  /**
   * True only when the config's copy demonstrably came from the owner (or from JATA's
   * grounded copy pipeline). False by default: generated testimonials and FAQ answers
   * are not factual and must not overwrite what the owner wrote.
   */
  trustedContent?: boolean;
  /** Apply the OpenPage theme to JATA brand colours. Off by default so a config cannot restyle a tenant unexpectedly. */
  applyTheme?: boolean;
  seed?: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function plainText(markdown: string): string {
  return String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 700);
}

function stringProp(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === "string" ? value.trim() : "";
}

function imagesProp(props: Record<string, unknown>): Array<{ url: string; alt?: string }> {
  if (!Array.isArray(props.images)) return [];
  return props.images.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const url = typeof raw.src === "string" ? raw.src.trim() : "";
    if (!url) return [];
    const alt = typeof raw.alt === "string" ? raw.alt.trim() : "";
    return [{ url, ...(alt ? { alt } : {}) }];
  });
}

function itemList(props: Record<string, unknown>, fields: Array<[string, string]>, max = 8): Array<Record<string, string>> {
  if (!Array.isArray(props.items)) return [];
  return props.items.slice(0, max).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const item: Record<string, string> = {};
    for (const [source, target] of fields) {
      const value = typeof raw[source] === "string" ? raw[source].trim() : "";
      if (value) item[target] = value;
    }
    return Object.keys(item).length > 0 ? [item] : [];
  });
}

function sectionFor(document: ExperienceDocument, id: string): ExperienceSection | undefined {
  return document.sections.find((section) => section.id === id);
}

function defaultsFor(type: SectionType, document: ExperienceDocument, id: string): ExperienceSection {
  const definition = sectionDefinition(type);
  if (!definition) throw new Error(`Unknown JATA section type ${type}`);
  return {
    id,
    ...definition.defaults(
      getExperienceProfile(document.categoryKey),
      { businessName: document.brand.businessName || "", location: document.settings.location || null },
    ),
  } as ExperienceSection;
}

/** Block types that have a real JATA content section target. */
const CONTENT_TARGET: Partial<Record<BlockType, SectionType>> = {
  navbar: "navigation",
  hero: "hero",
  features: "why",
  cta: "cta",
  testimonials: "testimonials",
  faq: "faq",
  contact: "contact",
  content: "about",
  gallery: "gallery",
  image: "gallery",
};

function note(entry: AdapterNote): AdapterNote {
  return entry;
}

/**
 * Applies one block to a JATA section. Returns the section and review notes.
 * Existing commercial/contact facts are never derived from the block.
 */
function applyBlockToSection(
  block: BlockConfig,
  section: ExperienceSection,
  options: AdapterOptions,
): { section: ExperienceSection; notes: AdapterNote[]; unsupported?: AdapterNote } {
  const props = block.props || {};
  const notes: AdapterNote[] = [];
  const layout = jataLayoutValueFor(section.type, jataLayoutForVariant(block.type, block.variant));
  const next: ExperienceSection = { ...section, visible: true };
  if (layout) next.layout = layout;

  switch (block.type) {
    case "navbar": {
      // Navigation links are derived from JATA's own visible sections, never from a
      // free-text list that could point off-site or invent pages.
      notes.push(note({
        code: "navigation_links_generated",
        message: "Navigation links are generated by JATA from the visible sections.",
        severity: "info",
        blockId: block.id,
        blockType: block.type,
        sectionId: section.id,
      }));
      return { section: next, notes };
    }
    case "hero": {
      const headline = stringProp(props, "headline");
      const subheadline = stringProp(props, "subheadline");
      const badge = stringProp(props, "badge");
      const primaryCta = stringProp(props, "primaryCta");
      if (headline) next.title = headline.slice(0, 80);
      if (subheadline) next.subtitle = subheadline.slice(0, 120);
      if (!subheadline && badge) next.subtitle = badge.slice(0, 120);
      if (stringProp(props, "heroImage")) next.imageUrl = stringProp(props, "heroImage");
      if (primaryCta) next.cta = { label: primaryCta.slice(0, 30), href: section.cta?.href || "#featured" };
      return { section: next, notes };
    }
    case "features": {
      const title = stringProp(props, "title");
      const subtitle = stringProp(props, "subtitle");
      const items = itemList(props, [["title", "title"], ["description", "body"]], 8);
      if (title) next.title = title.slice(0, 60);
      if (subtitle) next.subtitle = subtitle.slice(0, 120);
      if (items.length > 0) next.items = items;
      if (items.length > 0) {
        notes.push(note({
          code: "generated_feature_copy",
          message: "Feature copy came from the prompt/config. Review it against what the business actually offers before publishing.",
          severity: "warning",
          blockId: block.id,
          blockType: block.type,
          sectionId: section.id,
        }));
      }
      return { section: next, notes };
    }
    case "cta": {
      const headline = stringProp(props, "headline");
      const subheadline = stringProp(props, "subheadline");
      const button = stringProp(props, "buttonText");
      if (headline) next.title = headline.slice(0, 80);
      if (subheadline) next.body = subheadline.slice(0, 200);
      if (button) next.cta = { label: button.slice(0, 30), href: section.cta?.href || "#contact" };
      return { section: next, notes };
    }
    case "testimonials": {
      const title = stringProp(props, "title");
      if (title) next.title = title.slice(0, 60);
      const quotes = Array.isArray(props.items) ? props.items.length : 0;
      if (quotes > 0 && options.trustedContent !== true) {
        // Never replace a business's real quotes with generated ones, and never import
        // invented customer names as if they were real.
        notes.push(note({
          code: "unverified_testimonials_not_imported",
          message: `${quotes} generated testimonial${quotes === 1 ? "" : "s"} were not imported. Add real customer quotes in JATA; the existing quotes were kept.`,
          severity: "warning",
          blockId: block.id,
          blockType: block.type,
          sectionId: section.id,
        }));
      } else if (quotes > 0) {
        next.items = itemList(props, [["quote", "quote"], ["name", "author"]], 8);
      }
      return { section: next, notes };
    }
    case "faq": {
      const title = stringProp(props, "title");
      if (title) next.title = title.slice(0, 60);
      const answers = Array.isArray(props.items) ? props.items.length : 0;
      if (answers > 0 && options.trustedContent !== true) {
        notes.push(note({
          code: "unverified_faq_not_imported",
          message: `${answers} generated FAQ answer${answers === 1 ? "" : "s"} were not imported because they may state facts the owner has not confirmed. Existing answers were kept.`,
          severity: "warning",
          blockId: block.id,
          blockType: block.type,
          sectionId: section.id,
        }));
      } else if (answers > 0) {
        next.items = itemList(props, [["question", "question"], ["answer", "answer"]], 12);
      }
      return { section: next, notes };
    }
    case "contact": {
      const title = stringProp(props, "title");
      const subtitle = stringProp(props, "subtitle");
      if (title) next.title = title.slice(0, 60);
      if (subtitle) next.body = subtitle.slice(0, 200);
      return { section: next, notes };
    }
    case "content": {
      const body = plainText(stringProp(props, "body"));
      if (body) next.body = body;
      // A content block is a story/philosophy section. If it has a visible heading, the
      // JATA About heading is kept; the body is the owner's own words.
      return { section: next, notes };
    }
    case "gallery": {
      const title = stringProp(props, "title");
      const images = imagesProp(props);
      if (title) next.title = title.slice(0, 60);
      if (images.length > 0) next.images = images;
      return { section: next, notes };
    }
    case "image": {
      const images = imagesProp(props);
      const single = stringProp(props, "src");
      const combined = [...(single ? [{ url: single, alt: stringProp(props, "alt") }] : []), ...images];
      if (combined.length > 0) {
        if (block.variant === "hero-image" && !section.imageUrl) {
          next.imageUrl = combined[0].url;
        } else {
          next.images = combined;
        }
      }
      return { section: next, notes };
    }
    default: {
      return {
        section,
        notes,
        unsupported: note({
          code: "unsupported_openpage_block",
          message: `${block.type} (${block.variant}) cannot be represented in the JATA Experience schema. Nothing was imported; existing JATA content was kept.`,
          severity: "warning",
          blockId: block.id,
          blockType: block.type,
        }),
      };
    }
  }
}

/** Converts a validated OpenPage config into a JATA Experience document. */
export function siteConfigToExperience(
  rawConfig: unknown,
  baseDocument: ExperienceDocument,
  options: AdapterOptions = {},
): SiteConfigToExperienceResult {
  const validation = validateSiteConfig(rawConfig, { seed: options.seed || "jata-openpage" });
  const config = validation.config;
  const document = clone(baseDocument);
  const blocks = activePage(config).blocks;
  const mapped: MappedBlock[] = [];
  const unsupported: AdapterNote[] = [];
  const reviewRequired: AdapterNote[] = [];
  const retained: Array<{ sectionId: string; sectionType: SectionType; reason: string }> = [];
  const used = new Set<string>();
  const ordered: ExperienceSection[] = [];

  for (const dropped of validation.dropped) {
    unsupported.push(note({
      code: "dropped_block",
      message: `Block ${dropped.type} at position ${dropped.index} was not imported: ${dropped.reason}`,
      severity: "warning",
      blockType: dropped.type,
      blockId: dropped.blockId,
    }));
  }

  for (const block of blocks) {
    const targetType = CONTENT_TARGET[block.type];

    // id-first matching preserves owner content (and data sections) across an editor round-trip.
    let target = sectionFor(document, block.id);
    if (target && used.has(target.id)) target = undefined;
    if (!target && targetType) {
      target = document.sections.find((section) => section.type === targetType && !used.has(section.id));
    }

    if (!target && targetType) {
      target = defaultsFor(targetType, document, block.id.startsWith("sec_") ? block.id : `sec_${block.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`);
    }

    if (!target) {
      const unsupportedNote = note({
        code: "unsupported_openpage_block",
        message: `${block.type} (${block.variant}) has no JATA section mapping. Nothing was imported; existing JATA content was kept.`,
        severity: "warning",
        blockId: block.id,
        blockType: block.type,
      });
      unsupported.push(unsupportedNote);
      reviewRequired.push(unsupportedNote);
      continue;
    }

    if (!targetType) {
      unsupported.push(note({
        code: "presentational_block_not_imported",
        message: `${block.type} (${block.variant}) is platform chrome and is rendered by JATA itself. It was not stored as content.`,
        severity: "info",
        blockId: block.id,
        blockType: block.type,
        sectionId: target.id,
      }));
      used.add(target.id);
      continue;
    }

    const applied = applyBlockToSection(block, target, options);
    if (applied.unsupported) {
      unsupported.push(applied.unsupported);
      reviewRequired.push(applied.unsupported);
      continue;
    }
    reviewRequired.push(...applied.notes);
    used.add(target.id);
    ordered.push(applied.section);
    mapped.push({
      blockId: block.id,
      blockType: block.type,
      variant: block.variant,
      sectionId: applied.section.id,
      sectionType: applied.section.type,
    });
  }

  // Existing sections with no corresponding block are retained. This is what prevents an
  // OpenPage plan from silently deleting the owner's catalogue, hours or contact sections.
  for (const section of document.sections) {
    if (used.has(section.id)) continue;
    ordered.push(section);
    retained.push({
      sectionId: section.id,
      sectionType: section.type,
      reason: "This section has no OpenPage block representation and was preserved unchanged.",
    });
  }

  // Navigation and hero remain first (the JATA renderer and customer flow depend on it).
  const navigation = ordered.find((section) => section.type === "navigation");
  const hero = ordered.find((section) => section.type === "hero");
  const rest = ordered.filter((section) => section !== navigation && section !== hero);
  document.sections = [
    ...(navigation ? [navigation] : []),
    ...(hero ? [hero] : []),
    ...rest,
  ];

  if (options.applyTheme && config.theme) {
    if (config.theme.accent) document.brand.accentColor = config.theme.accent.toUpperCase();
    if (config.theme.accentDim) document.brand.primaryColor = config.theme.accentDim.toUpperCase();
    if (config.theme.fontDisplay) document.brand.fontPairing = config.theme.fontDisplay.slice(0, 30);
  }

  return {
    document,
    mapped,
    unsupported,
    retained,
    reviewRequired,
    repaired: validation.repaired,
  };
}

const DATA_SECTION_PLACEHOLDER: Partial<Record<SectionType, BlockType>> = {
  featured: "features",
  menu: "features",
  services: "features",
  categories: "features",
  collections: "features",
  properties: "features",
  steps: "features",
  hours: "features",
  location: "contact",
  offers: "cta",
};

const SECTION_TO_BLOCK: Partial<Record<SectionType, BlockType>> = {
  navigation: "navbar",
  hero: "hero",
  why: "features",
  cta: "cta",
  testimonials: "testimonials",
  faq: "faq",
  contact: "contact",
  about: "content",
  gallery: "gallery",
};

function heroVariant(document: ExperienceDocument, section: ExperienceSection): string {
  return openPageVariantForJataLayout("hero", section.layout);
}

function blockForSection(document: ExperienceDocument, section: ExperienceSection): { block: BlockConfig; note?: AdapterNote } {
  const blockType = SECTION_TO_BLOCK[section.type] || DATA_SECTION_PLACEHOLDER[section.type] || "features";
  const id = section.id;
  const variant = openPageVariantForJataLayout(blockType, section.layout);
  const common = { title: section.title || "", subtitle: section.subtitle || "" };

  switch (blockType) {
    case "navbar": {
      const labels = document.sections
        .filter((entry) => entry.visible && entry.type !== "navigation")
        .map((entry) => sectionDefinition(entry.type)?.label || entry.type)
        .slice(0, 6);
      const hero = document.sections.find((entry) => entry.type === "hero");
      return {
        block: {
          id,
          type: "navbar",
          variant,
          props: {
            logo: document.brand.businessName || "Business",
            links: labels,
            ctaText: hero?.cta?.label || "Contact",
          },
        },
      };
    }
    case "hero":
      return {
        block: {
          id,
          type: "hero",
          variant: heroVariant(document, section),
          props: {
            headline: section.title || document.brand.businessName || "Your business",
            subheadline: section.subtitle || document.brand.tagline || "",
            primaryCta: section.cta?.label || "",
            heroImage: section.imageUrl || document.brand.heroImageUrl || "",
          },
        },
      };
    case "features":
      return {
        block: {
          id,
          type: "features",
          variant,
          props: {
            ...common,
            items: (section.items || []).slice(0, 8).map((item) => ({
              title: item.title || "",
              description: item.body || "",
              icon: "Star",
            })),
          },
        },
      };
    case "cta":
      return {
        block: {
          id,
          type: "cta",
          variant,
          props: {
            headline: section.title || "",
            subheadline: section.body || section.subtitle || "",
            buttonText: section.cta?.label || "",
          },
        },
      };
    case "testimonials":
      return {
        block: {
          id,
          type: "testimonials",
          variant,
          props: {
            title: section.title || "",
            items: (section.items || []).slice(0, 8).map((item) => ({
              name: item.author || "",
              quote: item.quote || "",
            })),
          },
        },
      };
    case "faq":
      return {
        block: {
          id,
          type: "faq",
          variant: "accordion",
          props: {
            title: section.title || "",
            items: (section.items || []).slice(0, 12).map((item) => ({
              question: item.question || "",
              answer: item.answer || "",
            })),
          },
        },
      };
    case "contact":
      return {
        block: {
          id,
          type: "contact",
          variant: "form",
          props: { title: section.title || "", subtitle: section.body || section.subtitle || "" },
        },
      };
    case "content":
      return {
        block: {
          id,
          type: "content",
          variant: openPageVariantForJataLayout("content", section.layout || "prose"),
          props: { body: section.body || section.title || "" },
        },
      };
    case "gallery":
      return {
        block: {
          id,
          type: "gallery",
          variant: openPageVariantForJataLayout("gallery", section.layout || "grid"),
          props: {
            title: section.title || "",
            images: [
              ...(section.imageUrl ? [{ src: section.imageUrl, alt: section.title || "" }] : []),
              ...(section.images || []).map((image) => ({ src: image.url, alt: image.alt || "" })),
            ],
          },
        },
      };
    default:
      return {
        block: {
          id,
          type: blockType,
          variant,
          props: common,
        },
      };
  }
}

/** Converts a JATA Experience document into an editable OpenPage SiteConfig view. */
export function experienceToSiteConfig(
  document: ExperienceDocument,
  options: { businessName?: string; seed?: string } = {},
): ExperienceToSiteConfigResult {
  const mapped: MappedBlock[] = [];
  const unsupported: AdapterNote[] = [];
  const retained: Array<{ sectionId: string; sectionType: SectionType; reason: string }> = [];
  const blocks: BlockConfig[] = [];

  for (const section of document.sections) {
    if (section.type === "navigation") {
      // Navigation is always represented once, even when a legacy document omits the section.
      if (blocks.some((block) => block.type === "navbar")) {
        retained.push({ sectionId: section.id, sectionType: section.type, reason: "Duplicate navigation is rendered by JATA once." });
        continue;
      }
    }
    const result = blockForSection(document, section);
    blocks.push(result.block);
    mapped.push({
      blockId: result.block.id,
      blockType: result.block.type,
      variant: result.block.variant,
      sectionId: section.id,
      sectionType: section.type,
    });
    if (result.note) unsupported.push(result.note);
  }

  if (!blocks.some((block) => block.type === "navbar")) {
    blocks.unshift({
      id: "op_navbar_auto",
      type: "navbar",
      variant: "default",
      props: {
        logo: options.businessName || document.brand.businessName || "Business",
        links: document.sections.filter((section) => section.visible && section.type !== "navigation").slice(0, 6).map((section) => sectionDefinition(section.type)?.label || section.type),
        ctaText: "Contact",
      },
    });
  }

  const config: SiteConfig = {
    name: options.businessName || document.brand.businessName || "My website",
    pages: [{ id: "page-home", name: "Home", path: "/", blocks }],
    blocks,
  };

  return { config, mapped, unsupported, retained };
}

/** A safe fallback config when an input is unusable, based on the existing document. */
export function fallbackSiteConfigFor(document: ExperienceDocument): SiteConfig {
  return experienceToSiteConfig(document).config;
}

export const OPENPAGE_TO_JATA_BLOCK_MAP: Record<BlockType, SectionType | null> = Object.fromEntries(
  blockMetadata.map((block) => [block.type, CONTENT_TARGET[block.type] || null]),
) as Record<BlockType, SectionType | null>;
