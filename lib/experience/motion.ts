/**
 * Motion engine contract (Immersive Website Engine, Phase 2 — §21, §28, §40, §51)
 *
 * The storefront already reveals sections with CSS under `html[data-motion-ready]`. That path is
 * the floor: it works with no JavaScript at all, and every Lite visitor stays on it. This module
 * decides, purely and deterministically, when a page may *upgrade* to the JavaScript motion
 * engine that is built on the `motion` package — and when it must not.
 *
 * The decision is deliberately conservative, because the engine is a download:
 *
 *   - Reduced motion, Save-Data or Lite mode never download it. They are the visitor's explicit
 *     or practical constraints, and CSS (or nothing) is the correct answer.
 *   - A theme whose treatment is `none` never animates, at any tier.
 *   - `subtle` stays on CSS. A 0.6s opacity/translate transition does not justify a library;
 *     only the `expressive` treatment — choreographed stagger, masking, image pans — does.
 *
 * Nothing here imports React, `motion` or the DOM, so it can be tested without a browser and can
 * run on the server to tell the page which recipes to mark up.
 */

import { seededChoice } from "./seed";
import type { MotionLevel } from "./themes";
import type { CapabilitySignals, RenderMode } from "./renderMode";

/**
 * Whether the device should be kept off continuous, scroll-driven work.
 *
 * Deliberately signal-based rather than model-name-based (§4): unknown memory or core counts read
 * as "not low power", because guessing wrongly in that direction costs the visitor the whole
 * choreography, while guessing wrongly the other way costs a few frames.
 */
export function isLowPowerDevice(signals: Pick<CapabilitySignals, "deviceMemoryGB" | "hardwareConcurrency">): boolean {
  const memory = signals.deviceMemoryGB;
  if (typeof memory === "number" && Number.isFinite(memory)) return memory < 4;
  const cores = signals.hardwareConcurrency;
  if (typeof cores === "number" && Number.isFinite(cores)) return cores <= 4;
  return false;
}

/** Where a visitor's motion comes from. `css` is always available; `motion-js` is an upgrade. */
export const MOTION_ENGINES = ["css", "motion-js"] as const;
export type MotionEngineKind = (typeof MOTION_ENGINES)[number];

/**
 * The reusable motion presets of §21.
 *
 * `cssFallback` is the class the CSS-only path uses when the JavaScript engine is not loaded, so
 * a recipe can never leave content hidden: the fallback reveals it. `weight` is the relative
 * cost of running the recipe, used by the performance checks (§39, §83) and to keep low-end
 * Android on the cheap recipes (§82).
 */
export type MotionRecipe = {
  key: string;
  /** Plain-language name for the owner's Studio diagnostics. Never shown to customers. */
  label: string;
  /** Class the CSS-only path applies. Every recipe must have one, so nothing can stay hidden. */
  cssFallback: string;
  /** Needs pointer hover (magnetic cursors) — never the only affordance on touch (§26, §27). */
  requiresHover: boolean;
  /** Continuous, frame-driven work. Kept off the low-power recipe set (§82). */
  continuous: boolean;
  weight: "low" | "medium" | "high";
};

export const MOTION_RECIPES: readonly MotionRecipe[] = [
  { key: "fade", label: "Fade in", cssFallback: "eb-reveal", requiresHover: false, continuous: false, weight: "low" },
  { key: "slide", label: "Slide up", cssFallback: "eb-reveal", requiresHover: false, continuous: false, weight: "low" },
  { key: "scale", label: "Scale in", cssFallback: "eb-reveal eb-reveal--expressive", requiresHover: false, continuous: false, weight: "low" },
  { key: "reveal", label: "Reveal on scroll", cssFallback: "eb-reveal", requiresHover: false, continuous: false, weight: "low" },
  { key: "mask", label: "Masked reveal", cssFallback: "eb-reveal--expressive", requiresHover: false, continuous: false, weight: "medium" },
  { key: "clip", label: "Clip-path wipe", cssFallback: "eb-reveal--expressive", requiresHover: false, continuous: false, weight: "medium" },
  { key: "parallax", label: "Image parallax", cssFallback: "eb-reveal", requiresHover: false, continuous: true, weight: "high" },
  { key: "stagger", label: "Staggered children", cssFallback: "eb-reveal", requiresHover: false, continuous: false, weight: "medium" },
  { key: "split", label: "Split panels", cssFallback: "eb-reveal--expressive", requiresHover: false, continuous: false, weight: "medium" },
  { key: "blur-reveal", label: "Blur reveal", cssFallback: "eb-reveal--expressive", requiresHover: false, continuous: false, weight: "medium" },
  { key: "image-pan", label: "Slow image pan", cssFallback: "eb-reveal", requiresHover: false, continuous: true, weight: "high" },
  { key: "text-reveal", label: "Word-by-word text", cssFallback: "eb-reveal", requiresHover: false, continuous: false, weight: "medium" },
  { key: "magnetic", label: "Magnetic call to action", cssFallback: "eb-reveal", requiresHover: true, continuous: false, weight: "low" },
  { key: "morph", label: "Shape morph", cssFallback: "eb-reveal--expressive", requiresHover: false, continuous: false, weight: "high" },
] as const;

export const MOTION_RECIPE_KEYS: readonly string[] = MOTION_RECIPES.map((recipe) => recipe.key);

/**
 * The recipes the JavaScript runtime actually animates today.
 *
 * The catalogue above is the §21 target list; this is what is wired. `motionPlan` only ever
 * offers these, and `components/storefront/motion/MotionRuntime.ts` re-exports the same list so a
 * test can fail when a recipe is promised but not implemented. Nothing is claimed by name alone.
 */
export const MOTION_ENGINE_RECIPES: readonly string[] = [
  "fade",
  "slide",
  "scale",
  "reveal",
  "mask",
  "clip",
  "stagger",
  "split",
  "blur-reveal",
  "text-reveal",
  "parallax",
  "image-pan",
  "magnetic",
  "morph",
];

const RECIPE_BY_KEY = new Map(MOTION_RECIPES.map((recipe) => [recipe.key, recipe]));

export function recipeFor(key: string | null | undefined): MotionRecipe | null {
  if (typeof key !== "string") return null;
  return RECIPE_BY_KEY.get(key) ?? null;
}

/**
 * Recipes a low-power device may run: no continuous frame work, no hover dependency (§82).
 * A low-end Android on mobile data gets choreography, not a parallax loop.
 */
export const LOW_POWER_RECIPE_KEYS: readonly string[] = MOTION_RECIPES.filter(
  (recipe) => !recipe.continuous && !recipe.requiresHover && recipe.weight !== "high",
).map((recipe) => recipe.key);

export type MotionPlan = {
  engine: MotionEngineKind;
  /** Recipes the page may run. Empty when the engine must not animate anything. */
  recipes: string[];
  /** Plain-language reasons, for analytics and owner diagnostics (§57). Never customer-facing. */
  reasons: string[];
};

export type MotionPlanInput = {
  /** The tier the capability detector resolved. Immersive pages keep the same motion layer. */
  renderMode: RenderMode;
  /** The published theme's motion treatment. */
  motionLevel: MotionLevel;
  /** `prefers-reduced-motion: reduce`. Overrides everything (§51). */
  reducedMotion: boolean;
  /** `navigator.connection.saveData`. */
  saveData?: boolean;
  /**
   * Whether the JavaScript engine is actually usable — the dynamic import resolved. When it is
   * not (slow connection, blocked script, old WebView) the plan degrades to CSS instead of
   * leaving a page waiting on a chunk that never arrives (§54).
   */
  engineLoaded?: boolean;
  /** Low-power device: continuous recipes are removed rather than the whole engine (§82). */
  lowPower?: boolean;
  /** Optional seed, so two businesses in the same theme still choreograph differently (§7, §68). */
  seed?: string;
};

/**
 * Decides the motion layer for one page view.
 *
 * The order of the refusals matters: reduced motion first, because it is the visitor's own
 * setting; then Save-Data; then the render tier; then the theme. Each refusal records its reason
 * exactly once, and a refusal always returns the CSS engine with no recipes — never a page that
 * has been told to hide content.
 */
export function motionPlan(input: MotionPlanInput): MotionPlan {
  const reasons: string[] = [];

  if (input.reducedMotion) {
    return { engine: "css", recipes: [], reasons: ["reduced-motion"] };
  }
  if (input.saveData) {
    return { engine: "css", recipes: [], reasons: ["save-data"] };
  }
  if (input.renderMode === "lite") {
    return { engine: "css", recipes: [], reasons: ["render-mode-lite"] };
  }
  if (input.motionLevel === "none") {
    return { engine: "css", recipes: [], reasons: ["theme-motion-none"] };
  }
  if (input.motionLevel === "subtle") {
    // A subtle treatment is one opacity/translate transition per section. CSS already does it,
    // and shipping a library for it would break the §39 initial-JS budget for no visual gain.
    return { engine: "css", recipes: ["reveal"], reasons: ["subtle-uses-css"] };
  }
  if (input.engineLoaded === false) {
    return { engine: "css", recipes: ["reveal"], reasons: ["engine-not-loaded"] };
  }

  const recipes = [...MOTION_ENGINE_RECIPES];
  if (input.lowPower) reasons.push("low-power-recipe-set");
  return { engine: "motion-js", recipes, reasons };
}

/**
 * The section recipe for one section, chosen deterministically from the page seed.
 *
 * Two businesses sharing a theme therefore choreograph differently, while a business always
 * choreographs the same way on every visit — which is what makes generation reproducible and
 * testable (§68) and is not the same thing as picking a template at random (§66).
 */
export function sectionRecipe(input: {
  recipes: readonly string[];
  seed: string;
  sectionId: string;
  index: number;
  /** Hover-only recipes are never the only affordance on a touch device (§26, §27). */
  pointerFine?: boolean;
  /** Continuous scroll-driven recipes are dropped for low-memory, low-power devices (§82). */
  lowPower?: boolean;
}): string | null {
  const candidates = input.recipes.filter((key) => {
    const recipe = recipeFor(key);
    if (!recipe) return false;
    if (recipe.requiresHover && input.pointerFine !== true) return false;
    if (recipe.continuous && input.lowPower === true) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  const choice = seededChoice(`${input.seed}:${input.sectionId}:${input.index}`, candidates);
  return choice ?? null;
}

/**
 * The CSS classes the server renders for one section.
 *
 * This is the part that must never depend on the JavaScript engine: whatever the plan says, the
 * class list leaves content visible on a page with no scripts. The recipe is carried as a data
 * attribute for the engine to pick up after it loads.
 */
export function sectionMotionMarkup(input: { motionLevel: MotionLevel; recipe: string | null }): {
  className: string;
  recipe: string | null;
} {
  if (input.motionLevel === "none") return { className: "", recipe: null };
  const recipe = recipeFor(input.recipe);
  const base = input.motionLevel === "expressive" ? "eb-reveal eb-reveal--expressive" : "eb-reveal";
  // The recipe's own fallback class wins only when it is more specific than the level's, so a
  // `subtle` page never gets an expressive fallback it did not ask for.
  const fallback = recipe?.cssFallback ?? "";
  const className =
    fallback.includes("eb-reveal--expressive") && input.motionLevel === "expressive"
      ? "eb-reveal eb-reveal--expressive"
      : base;
  return { className, recipe: recipe ? recipe.key : null };
}

/**
 * Assigns a recipe to every visible section, deterministically, on the server.
 *
 * Hover-only recipes are excluded here: a section recipe has to work with a thumb, and the
 * hover-driven magnetic call to action is attached to the button itself instead (§26, §27).
 * The engine may still skip an individual recipe at runtime — a low-power device drops the
 * scroll-driven ones — and the CSS fallback class is what the visitor sees in that case.
 */
export function sectionRecipesForPage(input: {
  motionLevel: MotionLevel;
  seed: string;
  sections: ReadonlyArray<{ id: string }>;
  recipes?: readonly string[];
}): Record<string, string | null> {
  if (input.motionLevel === "none") return {};
  const pool = (input.recipes ?? MOTION_ENGINE_RECIPES).filter((key) => {
    const recipe = recipeFor(key);
    return recipe !== null && !recipe.requiresHover;
  });
  const out: Record<string, string | null> = {};
  input.sections.forEach((section, index) => {
    out[section.id] = sectionRecipe({ recipes: pool, seed: input.seed, sectionId: section.id, index });
  });
  return out;
}
