import type { StorefrontItem } from "./storefront";

/** Select only business-owned media. Never manufacture or borrow another tenant's image. */
export function itemImageFor(item: Pick<StorefrontItem, "imageUrl" | "images">): string | null {
  return item.imageUrl || item.images.find((image) => typeof image === "string" && image.trim().length > 0) || null;
}

/** Cinematic families may lead with the first real catalogue photo when no hero photo exists. */
export function heroImageFor(input: {
  familyKey?: string;
  heroImage?: string | null;
  brandImage?: string | null;
  items: Array<Pick<StorefrontItem, "imageUrl" | "images">>;
  services: Array<Pick<StorefrontItem, "imageUrl" | "images">>;
}): string | null {
  const explicit = input.heroImage || input.brandImage;
  if (explicit) return explicit;
  if (input.familyKey !== "cinematic" && input.familyKey !== "fullscreen-media") return null;
  return [...input.items, ...input.services].map(itemImageFor).find(Boolean) || null;
}
