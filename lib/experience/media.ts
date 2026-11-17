import type { StorefrontItem } from "./storefront";

/**
 * Local photography shipped with the four synthetic demo businesses.
 * Never use these illustrative assets for an unrelated tenant.
 */
const DEMO_BUSINESS_IMAGES: Readonly<Record<string, string>> = {
  "nyumbani-kitchen": "/landing/nyumbani-kitchen.webp",
  "marys-beauty-studio": "/landing/marys-beauty-studio.webp",
  "kamau-auto-care": "/landing/kamau-auto-care.webp",
  "john-kamau-properties": "/landing/john-kamau-properties.webp",
};

export function demoBusinessImageFor(slug: string): string | null {
  return DEMO_BUSINESS_IMAGES[slug] || null;
}

/** Select only business-owned media. Never manufacture or borrow another tenant's image. */
export function itemImageFor(item: Pick<StorefrontItem, "imageUrl" | "images">): string | null {
  return item.imageUrl || item.images.find((image) => typeof image === "string" && image.trim().length > 0) || null;
}

/** Prefer supplied media, then the first real catalogue photo, then a matching seeded-demo image. */
export function heroImageFor(input: {
  familyKey?: string;
  businessSlug?: string;
  heroImage?: string | null;
  brandImage?: string | null;
  items: Array<Pick<StorefrontItem, "imageUrl" | "images">>;
  services: Array<Pick<StorefrontItem, "imageUrl" | "images">>;
}): string | null {
  const explicit = input.heroImage || input.brandImage;
  if (explicit) return explicit;
  const catalogueImage = [...input.items, ...input.services].map(itemImageFor).find(Boolean);
  if (catalogueImage && ["cinematic", "fullscreen-media"].includes(input.familyKey || "")) return catalogueImage;
  // Seeded-demo imagery is explicitly scoped by reserved demo slug; real tenants stay image-owner-only.
  return input.businessSlug ? demoBusinessImageFor(input.businessSlug) : null;
}
