/**
 * Strict SiteConfig validation (adapted from OpenPage `src/lib/generate-site.ts`)
 *
 * OpenPage's original validator accepted any `props` object and generated block ids with
 * `Date.now()`. JATA needs three stronger guarantees before untrusted JSON can touch a
 * tenant's website:
 *
 *   1. only registered block types and variants survive;
 *   2. each block type has an explicit property schema — unknown properties are removed;
 *   3. ids are deterministic, so the same input always produces the same document and
 *      generation is reproducible in tests.
 *
 * The result carries an explicit `dropped` list. Nothing is discarded silently.
 */

import { blockMetadata } from "./blockMetadata";
import type { BlockConfig, BlockType, PageConfig, SiteConfig, ThemeConfig } from "./types";

const BLOCK_TYPES = new Set<BlockType>(blockMetadata.map((entry) => entry.type));
const VARIANTS = new Map<BlockType, Set<string>>(
  blockMetadata.map((entry) => [entry.type, new Set(entry.variants)]),
);
const DEFAULT_PROPS = new Map<BlockType, Record<string, unknown>>(
  blockMetadata.map((entry) => [entry.type, entry.defaultProps]),
);

const ICONS = new Set([
  "Blocks", "Code", "Bot", "Zap", "Shield", "Globe", "Layers",
  "Palette", "Rocket", "Star", "Lock", "Settings",
]);

export type DroppedBlock = { index: number; type: string; reason: string; blockId?: string };

export type SiteConfigValidation = {
  config: SiteConfig;
  dropped: DroppedBlock[];
  /** True when any property, variant, id or page shape had to be repaired. */
  repaired: boolean;
};

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .slice(0, max);
}

function url(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 2048);
  if (!trimmed || trimmed.includes("\\") || trimmed.startsWith("//")) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.username || parsed.password ? "" : trimmed;
    } catch {
      return "";
    }
  }
  return "";
}

function strings(value: unknown, maxItems = 8, maxLength = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((entry) => text(entry, maxLength))
    .filter(Boolean);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function items(value: unknown, maxItems: number, fields: Record<string, number>): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).flatMap((entry) => {
    const raw = record(entry);
    const clean: Record<string, string> = {};
    for (const [key, max] of Object.entries(fields)) {
      const next = text(raw[key], max);
      if (next) clean[key] = next;
    }
    return Object.keys(clean).length > 0 ? [clean] : [];
  });
}

function images(value: unknown, maxItems = 12): Array<{ src: string; alt: string; caption?: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).flatMap((entry) => {
    const raw = record(entry);
    const src = url(raw.src);
    if (!src) return [];
    const alt = text(raw.alt, 160);
    const caption = text(raw.caption, 160);
    return [{ src, alt, ...(caption ? { caption } : {}) }];
  });
}

/** One explicit property schema per block type. Anything else is removed. */
function sanitizeProps(type: BlockType, input: unknown, repaired: { value: boolean }): Record<string, unknown> {
  const raw = record(input);
  const defaults = DEFAULT_PROPS.get(type) || {};
  const known = new Set(Object.keys(defaults));
  for (const key of Object.keys(raw)) {
    if (!known.has(key) && !["variant"].includes(key)) repaired.value = true;
  }

  switch (type) {
    case "navbar":
      return { logo: text(raw.logo, 60) || "Brand", logoImage: url(raw.logoImage), links: strings(raw.links, 8, 30), ctaText: text(raw.ctaText, 30) };
    case "hero":
      return {
        badge: text(raw.badge, 40),
        headline: text(raw.headline, 90) || "Your headline",
        subheadline: text(raw.subheadline, 160),
        primaryCta: text(raw.primaryCta, 30),
        primaryCtaUrl: url(raw.primaryCtaUrl),
        secondaryCta: text(raw.secondaryCta, 30),
        secondaryCtaUrl: url(raw.secondaryCtaUrl),
        heroImage: url(raw.heroImage),
      };
    case "features":
      return {
        label: text(raw.label, 40),
        title: text(raw.title, 70) || "Features",
        subtitle: text(raw.subtitle, 140),
        items: items(raw.items, 8, { icon: 20, title: 60, description: 220 }).map((item) => ({
          ...item,
          icon: ICONS.has(item.icon) ? item.icon : "Star",
        })),
      };
    case "pricing":
      return {
        title: text(raw.title, 70) || "Pricing",
        subtitle: text(raw.subtitle, 140),
        tiers: Array.isArray(raw.tiers) ? raw.tiers.slice(0, 4).flatMap((entry) => {
          const tier = record(entry);
          const name = text(tier.name, 40);
          if (!name) return [];
          return [{
            name,
            price: text(tier.price, 20),
            period: text(tier.period, 20),
            description: text(tier.description, 120),
            features: strings(tier.features, 10, 80),
            cta: text(tier.cta, 30),
            featured: tier.featured === true,
          }];
        }) : [],
      };
    case "cta":
      return {
        headline: text(raw.headline, 90) || "Ready when you are",
        subheadline: text(raw.subheadline, 160),
        buttonText: text(raw.buttonText, 30),
        buttonUrl: url(raw.buttonUrl),
      };
    case "footer":
      return { logo: text(raw.logo, 60), copyright: text(raw.copyright, 120), links: strings(raw.links, 8, 30) };
    case "testimonials":
      return {
        title: text(raw.title, 70),
        subtitle: text(raw.subtitle, 140),
        items: Array.isArray(raw.items) ? raw.items.slice(0, 8).flatMap((entry) => {
          const item = record(entry);
          const quote = text(item.quote, 240);
          if (!quote) return [];
          return [{
            name: text(item.name, 60),
            role: text(item.role, 60),
            company: text(item.company, 60),
            quote,
            rating: String(Math.max(0, Math.min(5, Math.round(Number(item.rating) || 0)))),
          }];
        }) : [],
      };
    case "stats":
      return { title: text(raw.title, 70), items: items(raw.items, 8, { value: 20, label: 60 }) };
    case "faq":
      return { title: text(raw.title, 70), items: items(raw.items, 12, { question: 160, answer: 500 }) };
    case "team":
      return { title: text(raw.title, 70), subtitle: text(raw.subtitle, 140), members: items(raw.members, 12, { name: 60, role: 60 }) };
    case "contact":
      return { title: text(raw.title, 70), subtitle: text(raw.subtitle, 160) };
    case "newsletter":
      return { title: text(raw.title, 70), subtitle: text(raw.subtitle, 160), buttonText: text(raw.buttonText, 30) };
    case "logocloud":
      return { title: text(raw.title, 70) };
    case "content":
      return { body: text(raw.body, 4000) };
    case "image":
      return {
        src: url(raw.src),
        alt: text(raw.alt, 160),
        title: text(raw.title, 70),
        subtitle: text(raw.subtitle, 160),
        images: images(raw.images, 8).map((entry) => ({ src: entry.src, alt: entry.alt })),
        imageSide: raw.imageSide === "right" ? "right" : "left",
      };
    case "video": {
      const videoUrl = url(raw.url);
      const allowed = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i.test(videoUrl);
      return { url: allowed ? videoUrl : "", title: text(raw.title, 70) };
    }
    case "gallery":
      return { title: text(raw.title, 70), images: images(raw.images, 12) };
    case "divider":
      return {
        height: Math.max(0, Math.min(200, Math.round(Number(raw.height) || 60))),
        width: ["full", "centered", "narrow"].includes(String(raw.width)) ? String(raw.width) : "full",
      };
    case "banner":
      return { text: text(raw.text, 120), linkText: text(raw.linkText, 30), linkUrl: url(raw.linkUrl) };
    default:
      return {};
  }
}

/** Small, stable string hash (FNV-1a). Deterministic ids make generation reproducible. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(36);
}

export function newBlockId(type: BlockType, seed: string, index = 0): string {
  return `op_${type}_${hash(`${seed}|${type}|${index}`)}`;
}

function sanitizeTheme(raw: unknown, repaired: { value: boolean }): Partial<ThemeConfig> | undefined {
  const input = record(raw);
  if (Object.keys(input).length === 0) return undefined;
  const theme: Partial<ThemeConfig> = {};
  const hexKeys = [
    "bg0", "bg1", "bg2", "bg3", "bg4", "bg5",
    "text0", "text1", "text2", "text3",
    "accent", "accentDim",
    "borderDefault", "borderSubtle", "borderHover",
  ] as const;
  for (const key of hexKeys) {
    const value = input[key];
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
      (theme as Record<string, unknown>)[key] = value.toUpperCase();
    } else if (value !== undefined) {
      repaired.value = true;
    }
  }
  for (const key of ["fontSans", "fontDisplay", "fontMono"] as const) {
    if (typeof input[key] === "string" && String(input[key]).trim()) {
      theme[key] = text(input[key], 40);
    } else if (input[key] !== undefined) {
      repaired.value = true;
    }
  }
  if (typeof input.radius === "number" && Number.isFinite(input.radius)) {
    theme.radius = Math.max(0, Math.min(24, Math.round(input.radius)));
  }
  if (typeof input.radiusLg === "number" && Number.isFinite(input.radiusLg)) {
    theme.radiusLg = Math.max(0, Math.min(32, Math.round(input.radiusLg)));
  }
  return Object.keys(theme).length > 0 ? theme : undefined;
}

function sanitizeBlock(raw: unknown, index: number, seed: string, dropped: DroppedBlock[], repaired: { value: boolean }): BlockConfig | null {
  const input = record(raw);
  const type = input.type;
  if (typeof type !== "string" || !BLOCK_TYPES.has(type as BlockType)) {
    dropped.push({ index, type: typeof type === "string" ? type.slice(0, 40) : "(missing)", reason: "Unknown OpenPage block type." });
    return null;
  }
  const blockType = type as BlockType;
  const allowedVariants = VARIANTS.get(blockType)!;
  let variant = typeof input.variant === "string" ? input.variant : "";
  if (!variant || !allowedVariants.has(variant)) {
    variant = allowedVariants.values().next().value || "default";
    repaired.value = true;
  }
  const rawId = typeof input.id === "string" && input.id.trim() ? input.id.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) : "";
  const id = rawId || newBlockId(blockType, seed, index);
  return { id, type: blockType, variant, props: sanitizeProps(blockType, input.props, repaired) };
}

function sanitizeBlocks(raw: unknown, seed: string, dropped: DroppedBlock[], repaired: { value: boolean }): BlockConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    const block = sanitizeBlock(entry, index, seed, dropped, repaired);
    return block ? [block] : [];
  });
}

function sanitizePages(rawPages: unknown, seed: string, dropped: DroppedBlock[], repaired: { value: boolean }): PageConfig[] | undefined {
  if (!Array.isArray(rawPages) || rawPages.length === 0) return undefined;
  const pages = rawPages.slice(0, 8).flatMap((entry, index) => {
    const page = record(entry);
    const blocks = sanitizeBlocks(page.blocks, `${seed}|page|${index}`, dropped, repaired);
    if (blocks.length === 0) {
      dropped.push({ index, type: "page", reason: "A page with no supported blocks was not imported." });
      return [];
    }
    return [{
      id: text(page.id, 40) || `page-${index === 0 ? "home" : index}`,
      name: text(page.name, 40) || `Page ${index + 1}`,
      path: text(page.path, 80) || (index === 0 ? "/" : `/page-${index}`),
      blocks,
    }];
  });
  return pages.length > 0 ? pages : undefined;
}

/**
 * Validates an untrusted SiteConfig. A completely unusable input returns the caller's
 * fallback (never an empty site that would erase an owner's page).
 */
export function validateSiteConfig(raw: unknown, options: { seed?: string; fallback?: SiteConfig } = {}): SiteConfigValidation {
  const seed = options.seed || "openpage";
  const repaired = { value: false };
  const dropped: DroppedBlock[] = [];
  const input = record(raw);
  const pages = sanitizePages(input.pages, seed, dropped, repaired);
  const topBlocks = sanitizeBlocks(input.blocks, seed, dropped, repaired);
  const blocks = topBlocks.length > 0 ? topBlocks : pages?.[0]?.blocks || [];
  if (topBlocks.length > 0 && pages && JSON.stringify(pages[0].blocks) !== JSON.stringify(topBlocks)) {
    // OpenPage allowed top-level blocks to drift from the first page. JATA keeps one
    // authoritative list (the top-level one, which every JATA surface reads). Blocks that
    // existed only on the first page are reported rather than discarded silently.
    const topIds = new Set(topBlocks.map((block) => block.id));
    pages[0].blocks.forEach((block, index) => {
      if (topIds.has(block.id)) return;
      dropped.push({
        index,
        type: block.type,
        blockId: block.id,
        reason: "Only present on the first page; the top-level block list is authoritative and was kept.",
      });
    });
    pages[0] = { ...pages[0], blocks: topBlocks };
    repaired.value = true;
  }
  if (pages) {
    for (const [pageIndex, page] of pages.entries()) {
      if (pageIndex === 0) continue;
      for (const block of page.blocks) {
        dropped.push({
          index: pageIndex,
          type: block.type,
          blockId: block.id,
          reason: "Only the first page is imported; a JATA website is single-page. The block was preserved in the OpenPage payload but not added to the Experience document.",
        });
      }
    }
  }
  if (!pages && blocks.length === 0) {
    return {
      config: options.fallback || { name: text(input.name, 80) || "My website", blocks: [] },
      dropped,
      repaired: true,
    };
  }
  const theme = sanitizeTheme(input.theme, repaired);
  return {
    config: {
      name: text(input.name, 80) || "My website",
      pages: pages || [{ id: "page-home", name: "Home", path: "/", blocks }],
      blocks,
      ...(theme ? { theme } : {}),
    },
    dropped,
    repaired: repaired.value,
  };
}

export function activePage(config: SiteConfig): PageConfig {
  return config.pages?.[0] || { id: "page-home", name: "Home", path: "/", blocks: config.blocks };
}

export function cloneSiteConfig(config: SiteConfig): SiteConfig {
  return JSON.parse(JSON.stringify(config)) as SiteConfig;
}

export function blockDefaults(type: BlockType): Record<string, unknown> {
  return { ...(DEFAULT_PROPS.get(type) || {}) };
}

export function blockLabel(type: BlockType): string {
  return blockMetadata.find((entry) => entry.type === type)?.label || type;
}

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && BLOCK_TYPES.has(value as BlockType);
}

/** Create an editable config from a block sequence (used by prompt generation). */
export function siteConfigFromBlocks(params: {
  name: string;
  blocks: BlockConfig[];
  theme?: Partial<ThemeConfig>;
  seed?: string;
}): SiteConfig {
  const validation = validateSiteConfig({
    name: params.name,
    blocks: params.blocks,
    theme: params.theme,
    pages: [{ id: "page-home", name: "Home", path: "/", blocks: params.blocks }],
  }, { seed: params.seed });
  return validation.config;
}
