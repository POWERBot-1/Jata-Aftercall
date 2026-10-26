/**
 * Category imagery registry — the contract the image-first Studio + POS rely on.
 *
 * Derived from the two real registries, never a hard-coded extra list: every Website
 * Studio experience profile and every POS business type must resolve to a picture that
 * exists on disk, fits a phone data budget, is honestly described, and does not recycle
 * one generic photo across unrelated trades.
 */
import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  CATEGORY_IMAGES,
  EXPERIENCE_CATEGORY_IMAGE,
  POS_TYPE_IMAGE,
  FALLBACK_CATEGORY_IMAGE,
  categoryImageForUrl,
  categoryImageUrls,
  clampFocal,
  galleryForExperienceCategory,
  galleryForPosType,
  imageForCategoryText,
  imageForExperienceCategory,
  imageForPosType,
  isCategoryImageUrl,
} from "@/lib/categoryImagery";
import { EXPERIENCE_PROFILES } from "@/lib/experience/categories";
import { BUSINESS_TYPES } from "@/lib/pos/businessTypes";

const root = path.resolve(__dirname, "..", "..");

function urlFile(url: string) {
  return path.join(root, "public", url);
}

describe("category imagery files", () => {
  it("ships every file it can render, in WebP and JPEG, inside a phone data budget", () => {
    for (const image of Object.values(CATEGORY_IMAGES)) {
      expect(image.src, image.id).toMatch(/\.jpg$/);
      expect(image.webp, image.id).toMatch(/\.webp$/);
      for (const url of [image.src, image.webp]) {
        if (url) expect(existsSync(urlFile(url)), `${image.id}: ${url}`).toBe(true);
      }
      const seen = new Set<string>();
      for (const set of [image.srcSet, image.webpSrcSet]) {
        for (const entry of (set || "").split(",")) {
          const url = entry.trim().split(/\s+/)[0];
          if (!url || seen.has(url)) continue;
          seen.add(url);
          expect(existsSync(urlFile(url)), `${image.id}: ${url}`).toBe(true);
          if (url.includes("-720")) {
            // A phone on a slow connection must never pay desktop prices for a card image.
            expect(statSync(urlFile(url)).size, `${image.id}: ${url} too heavy`).toBeLessThan(160 * 1024);
          }
        }
      }
    }
  });

  it("describes every picture honestly and declares its dimensions", () => {
    for (const image of Object.values(CATEGORY_IMAGES)) {
      expect(image.alt.length, image.id).toBeGreaterThan(20);
      expect(image.alt, image.id).toMatch(/illustrative/i);
      if (image.provenance === "ai-generated-illustration") {
        expect(image.alt, image.id).toMatch(/AI-made/);
      }
      expect(image.width, image.id).toBeGreaterThan(0);
      expect(image.height, image.id).toBeGreaterThan(0);
      expect(image.label, image.id).toBeTruthy();
      expect(image.focal.x, image.id).toBeGreaterThanOrEqual(5);
      expect(image.focal.y, image.id).toBeLessThanOrEqual(95);
    }
  });
});

describe("coverage is derived from the real category registries", () => {
  it("gives every Website Studio experience profile a mapped image", () => {
    for (const profile of EXPERIENCE_PROFILES) {
      expect(EXPERIENCE_CATEGORY_IMAGE[profile.key], profile.key).toBeTruthy();
      expect(imageForExperienceCategory(profile.key).src, profile.key).toBeTruthy();
      const gallery = galleryForExperienceCategory(profile.key);
      expect(gallery.images[0].id, profile.key).toBe(gallery.suggestedId);
      expect(gallery.images.length, profile.key).toBe(Object.keys(CATEGORY_IMAGES).length);
    }
  });

  it("gives every POS business type a mapped image", () => {
    for (const type of BUSINESS_TYPES) {
      expect(POS_TYPE_IMAGE[type.key], `${type.key} (${type.label})`).toBeTruthy();
      expect(imageForPosType(type.key).src, type.key).toBeTruthy();
      expect(galleryForPosType(type.key).images[0].id, type.key).toBe(imageForPosType(type.key).id);
    }
  });

  it("does not recycle one generic picture across unrelated trades", () => {
    const unrelated: Array<[string, string]> = [
      ["electronics", "fashion"],
      ["electronics", "retail"],
      ["food", "automotive"],
      ["realestate", "furniture"],
      ["education", "professional"],
      ["creative", "professional"],
      ["automotive", "technical"],
      ["furniture", "hospitality"],
    ];
    for (const [a, b] of unrelated) {
      expect(imageForExperienceCategory(a).src, `${a} vs ${b}`).not.toBe(imageForExperienceCategory(b).src);
    }
    // POS trades that used to fall through to a produce stall now have their own worlds.
    expect(imageForPosType("pharmacy").id).toBe("pharmacy");
    expect(imageForPosType("hardware").id).toBe("hardware");
    expect(imageForPosType("transport").id).toBe("transport");
    expect(imageForPosType("farm").id).toBe("agriculture");
    expect(imageForPosType("courier").id).toBe("transport");
    expect(imageForPosType("restaurant").id).toBe("food");
    expect(imageForPosType("garage").id).toBe("automotive");
  });
});

describe("fallbacks and free text", () => {
  it("never fails: empty and unknown categories get the produce fallback", () => {
    expect(imageForExperienceCategory(null).id).toBe(FALLBACK_CATEGORY_IMAGE.id);
    expect(imageForExperienceCategory("")).toBe(FALLBACK_CATEGORY_IMAGE);
    expect(imageForPosType("not-a-trade")).toBeTruthy();
    expect(imageForCategoryText("Something nobody has ever categorised")).toBe(FALLBACK_CATEGORY_IMAGE);
  });

  it("reads the categories Kenyan owners actually type", () => {
    expect(imageForCategoryText("Mama mboga").id).toBe("produce");
    expect(imageForCategoryText("Pharmacy & health shop").id).toBe("pharmacy");
    expect(imageForCategoryText("Hardware & building supplies").id).toBe("hardware");
    expect(imageForCategoryText("Boda delivery").id).toBe("transport");
    expect(imageForCategoryText("Agrovet").id).toBe("agriculture");
    expect(imageForCategoryText("Salon & barber").id).toBe("beauty");
    expect(imageForCategoryText("Phone accessories").id).toBe("electronics");
  });
});

describe("registry URL helpers (POS header allow-list)", () => {
  it("recognises its own URLs and no others", () => {
    const urls = categoryImageUrls();
    expect(urls.size).toBeGreaterThan(Object.keys(CATEGORY_IMAGES).length);
    expect(isCategoryImageUrl(CATEGORY_IMAGES.food.src)).toBe(true);
    expect(isCategoryImageUrl("https://example.com/other-tenant.jpg")).toBe(false);
    expect(isCategoryImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isCategoryImageUrl(null)).toBe(false);
    expect(categoryImageForUrl(CATEGORY_IMAGES.pharmacy.src)?.id).toBe("pharmacy");
    expect(categoryImageForUrl("/not-ours.jpg")).toBeNull();
  });

  it("clamps focal points inside the safe crop range", () => {
    expect(clampFocal(0, 50)).toBe(5);
    expect(clampFocal(200, 50)).toBe(95);
    expect(clampFocal("42", 50)).toBe(42);
    expect(clampFocal("nope", 50)).toBe(50);
  });
});
