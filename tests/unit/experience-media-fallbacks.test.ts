import { describe, expect, it } from "vitest";
import { heroImageFor, itemImageFor } from "@/lib/experience/media";

describe("Website Studio family media fallbacks", () => {
  it("prefers an explicit hero photo, then the business brand photo", () => {
    expect(heroImageFor({ familyKey: "cinematic", heroImage: "/hero.jpg", brandImage: "/brand.jpg", items: [], services: [] })).toBe("/hero.jpg");
    expect(heroImageFor({ familyKey: "cinematic", brandImage: "/brand.jpg", items: [], services: [] })).toBe("/brand.jpg");
  });
  it("gives cinematic and fullscreen-media a real catalogue image when no hero photo exists", () => {
    const items = [{ imageUrl: null, images: [] }, { imageUrl: "/product.jpg", images: [] }];
    expect(heroImageFor({ familyKey: "cinematic", items, services: [] })).toBe("/product.jpg");
    expect(heroImageFor({ familyKey: "fullscreen-media", items, services: [] })).toBe("/product.jpg");
  });
  it("does not force a catalogue image into families whose art direction is not image-led", () => {
    expect(heroImageFor({ familyKey: "editorial", items: [{ imageUrl: "/product.jpg", images: [] }], services: [] })).toBeNull();
  });
  it("uses an item's first supplied gallery image when its primary imageUrl is empty", () => {
    expect(itemImageFor({ imageUrl: null, images: ["/gallery-1.jpg", "/gallery-2.jpg"] })).toBe("/gallery-1.jpg");
    expect(itemImageFor({ imageUrl: "/primary.jpg", images: ["/gallery-1.jpg"] })).toBe("/primary.jpg");
    expect(itemImageFor({ imageUrl: null, images: [] })).toBeNull();
  });
});
