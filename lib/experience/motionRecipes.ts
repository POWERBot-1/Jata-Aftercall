/** Finite, compositor-only presentation recipes. No customer data, executable config or continuous loops. */
import type { SectionType } from "./types";

export const MOTION_RECIPE_KEYS = ["fade", "slide", "scale", "reveal"] as const;
export type MotionRecipeKey = (typeof MOTION_RECIPE_KEYS)[number];
export type MotionRecipe = { keyframes: { opacity: number[]; transform?: string[] }; duration: number };

// Content remains readable throughout: no zero opacity, masks, offscreen text or price changes.
export const MOTION_RECIPES: Record<MotionRecipeKey, MotionRecipe> = {
  fade: { keyframes: { opacity: [0.94, 1] }, duration: 0.32 },
  slide: { keyframes: { opacity: [0.94, 1], transform: ["translateY(10px)", "none"] }, duration: 0.42 },
  scale: { keyframes: { opacity: [0.94, 1], transform: ["scale(0.99)", "none"] }, duration: 0.42 },
  reveal: { keyframes: { opacity: [0.92, 1], transform: ["translateY(18px)", "none"] }, duration: 0.56 },
};

export function isMotionRecipe(value: unknown): value is MotionRecipeKey {
  return typeof value === "string" && (MOTION_RECIPE_KEYS as readonly string[]).includes(value);
}

export function motionRecipeForSection(type?: SectionType, expressive = false): MotionRecipeKey {
  if (type === "contact" || type === "cta" || type === "location" || type === "hours") return "fade";
  if (type === "gallery" || type === "featured" || type === "collections") return "scale";
  return expressive ? "reveal" : "slide";
}
