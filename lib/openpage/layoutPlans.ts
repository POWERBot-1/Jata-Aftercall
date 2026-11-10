/**
 * OpenPage-inspired structural plans (adapted from upstream `src/lib/templates.ts`)
 *
 * Upstream templates contain a full page of sample copy, testimonials, statistics and
 * prices. Those are invented facts and are deliberately not imported. What is retained
 * is the useful part: the *block sequence* and variant choice that makes a restaurant
 * page read differently from a portfolio, an agency page or a SaaS page.
 *
 * A plan never supplies content. Content comes from the owner's business facts and the
 * owner's own prompt, through JATA's Experience engine.
 */

import type { BlockConfig, BlockType } from "./types";
import { layoutVariantFor } from "./layoutVariants";
import type { SiteConfig } from "./types";

export type LayoutPlanBlock = { type: BlockType; variant: string };

export type LayoutPlan = {
  id: "portfolio" | "restaurant" | "agency" | "blog" | "commerce" | "service" | "saas";
  name: string;
  keywords: string[];
  blocks: LayoutPlanBlock[];
};

export const LAYOUT_PLANS: LayoutPlan[] = [
  {
    id: "restaurant",
    name: "Menu-led",
    keywords: ["restaurant", "food", "cafe", "café", "bakery", "bar", "bistro", "pizza", "sushi", "kitchen", "menu", "hotel", "eatery", "butchery", "catering"],
    blocks: [
      { type: "navbar", variant: "centered" },
      { type: "hero", variant: "gradient" },
      { type: "features", variant: "list" },
      { type: "gallery", variant: "masonry" },
      { type: "testimonials", variant: "spotlight" },
      { type: "cta", variant: "simple" },
    ],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    keywords: ["portfolio", "personal", "resume", "freelance", "designer", "developer", "photographer", "artist", "creative"],
    blocks: [
      { type: "navbar", variant: "default" },
      { type: "hero", variant: "minimal" },
      { type: "gallery", variant: "grid" },
      { type: "features", variant: "alternating" },
      { type: "contact", variant: "form" },
    ],
  },
  {
    id: "agency",
    name: "Agency",
    keywords: ["agency", "studio", "consulting", "firm", "digital", "marketing", "brand", "professional", "law", "accounting"],
    blocks: [
      { type: "navbar", variant: "centered" },
      { type: "hero", variant: "split" },
      { type: "features", variant: "alternating" },
      { type: "gallery", variant: "grid" },
      { type: "cta", variant: "split" },
    ],
  },
  {
    id: "blog",
    name: "Editorial",
    keywords: ["blog", "newsletter", "magazine", "journal", "publication", "writer", "author", "news"],
    blocks: [
      { type: "navbar", variant: "default" },
      { type: "hero", variant: "minimal" },
      { type: "content", variant: "columns" },
      { type: "gallery", variant: "masonry" },
      { type: "faq", variant: "accordion" },
    ],
  },
  {
    id: "commerce",
    name: "Storefront",
    keywords: ["shop", "store", "retail", "products", "boutique", "electronics", "furniture", "fashion", "sell", "order"],
    blocks: [
      { type: "navbar", variant: "default" },
      { type: "hero", variant: "split" },
      { type: "features", variant: "grid" },
      { type: "gallery", variant: "grid" },
      { type: "cta", variant: "simple" },
    ],
  },
  {
    id: "service",
    name: "Service journey",
    keywords: ["salon", "barber", "spa", "beauty", "fitness", "gym", "repair", "garage", "clinic", "dentist", "school", "training", "consult", "service", "book", "appointment"],
    blocks: [
      { type: "navbar", variant: "centered" },
      { type: "hero", variant: "centered" },
      { type: "features", variant: "list" },
      { type: "gallery", variant: "grid" },
      { type: "faq", variant: "accordion" },
      { type: "contact", variant: "form" },
    ],
  },
  {
    id: "saas",
    name: "Clean launch",
    keywords: ["saas", "software", "app", "platform", "tech", "startup", "developer", "api", "dashboard"],
    blocks: [
      { type: "navbar", variant: "default" },
      { type: "hero", variant: "centered" },
      { type: "features", variant: "grid" },
      { type: "cta", variant: "simple" },
    ],
  },
];

const FALLBACK_PLAN = LAYOUT_PLANS[LAYOUT_PLANS.length - 1];

export function planForPrompt(prompt: string): LayoutPlan {
  const lower = String(prompt || "").toLowerCase();
  let best: { plan: LayoutPlan; matches: number } | null = null;
  for (const plan of LAYOUT_PLANS) {
    const matches = plan.keywords.filter((keyword) => lower.includes(keyword)).length;
    if (matches > 0 && (!best || matches > best.matches)) best = { plan, matches };
  }
  return best?.plan || FALLBACK_PLAN;
}

/**
 * Reorders the config's blocks to the plan, keeping the owner's blocks and ids.
 * Only block types the plan names are promoted; everything else is appended, never
 * deleted. A variant is applied only when OpenPage registers it and JATA maps it.
 */
export function applyLayoutPlan(config: SiteConfig, plan: LayoutPlan, seed = "plan"): SiteConfig {
  const source = config.pages?.[0]?.blocks || config.blocks;
  const queues = new Map<BlockType, BlockConfig[]>();
  for (const block of source) {
    const queue = queues.get(block.type) || [];
    queue.push(block);
    queues.set(block.type, queue);
  }
  const used = new Set<string>();
  const blocks: BlockConfig[] = [];

  for (const planned of plan.blocks) {
    const queue = queues.get(planned.type);
    const next = queue?.shift();
    if (!next || used.has(next.id)) continue;
    const mapped = layoutVariantFor(planned.type, planned.variant);
    blocks.push(mapped?.support === "mapped" ? { ...next, variant: planned.variant } : next);
    used.add(next.id);
  }

  for (const block of source) {
    if (used.has(block.id)) continue;
    blocks.push(block);
    used.add(block.id);
  }

  // A plan never removes required page furniture. Navigation and hero stay first.
  const navbar = blocks.filter((block) => block.type === "navbar");
  const hero = blocks.filter((block) => block.type === "hero");
  const rest = blocks.filter((block) => block.type !== "navbar" && block.type !== "hero");

  return {
    ...config,
    pages: [{ id: "page-home", name: "Home", path: "/", blocks: [...navbar, ...hero, ...rest] }],
    blocks: [...navbar, ...hero, ...rest],
    name: config.name || seed,
  };
}

export const LAYOUT_PLAN_IDS = LAYOUT_PLANS.map((plan) => plan.id);
