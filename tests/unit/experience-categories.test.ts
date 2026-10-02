/**
 * Experience profiles (§5, §6, §13)
 *
 * Sixteen categories, one engine. These tests are the guard against template lock-in: a
 * category may configure fields, wording and sections, but never a separate app.
 */

import { describe, expect, it } from "vitest";
import {
  CATEGORY_KEYS,
  EXPERIENCE_PROFILES,
  getExperienceProfile,
  hasCapability,
  isCategoryKey,
  resolveExperienceProfile,
} from "@/lib/experience/categories";
import { CATEGORIES, isValidCategory } from "@/lib/validation";

describe("the sixteen categories", () => {
  it("defines exactly sixteen unique profiles", () => {
    expect(EXPERIENCE_PROFILES).toHaveLength(16);
    expect(new Set(CATEGORY_KEYS).size).toBe(16);
    expect(CATEGORIES).toHaveLength(16);
  });

  it("gives every profile a complete configuration", () => {
    for (const profile of EXPERIENCE_PROFILES) {
      expect(profile.label.length).toBeGreaterThan(1);
      expect(profile.itemNoun.length).toBeGreaterThan(1);
      expect(profile.catalogueLabel.length).toBeGreaterThan(1);
      expect(profile.capabilities.length).toBeGreaterThan(0);
      expect(profile.defaultSections.length).toBeGreaterThan(3);
      expect(profile.themeKeys.length).toBeGreaterThan(0);
      expect(profile.cta.primary.length).toBeGreaterThan(0);
      expect(profile.structuredDataType.length).toBeGreaterThan(0);
      // A food business sells dishes and orders; a salon sells services and books (§13).
      expect(typeof profile.productFields.price).toBe("boolean");
      expect(typeof profile.serviceFields.quote).toBe("boolean");
    }
  });

  it("adapts capabilities and wording per category instead of forking the app", () => {
    const food = getExperienceProfile("food");
    const salon = getExperienceProfile("salon");
    const property = getExperienceProfile("realestate");

    expect(hasCapability("food", "commerce")).toBe(true);
    expect(hasCapability("salon", "booking")).toBe(true);
    // Property is enquiry-led rather than bookable — the profile says so, not the code (§13).
    expect(hasCapability("realestate", "enquiry")).toBe(true);
    expect(hasCapability("realestate", "commerce")).toBe(false);
    expect(food.itemNoun).not.toBe(salon.itemNoun);
    expect(food.cta.primary).not.toBe(salon.cta.primary);
    expect(salon.serviceFields.duration).toBe(true);
  });

  it("never throws on unknown or legacy categories", () => {
    expect(getExperienceProfile(null).key).toBe("other");
    expect(getExperienceProfile("does-not-exist").key).toBe("other");
    expect(getExperienceProfile("other").key).toBe("other");
    expect(isCategoryKey("food")).toBe(true);
    expect(isCategoryKey("nope")).toBe(false);
  });

  it("resolves legacy free-text JATA categories to a profile", () => {
    expect(resolveExperienceProfile("Restaurant").key).toBe("food");
    expect(resolveExperienceProfile("  salon  ").key).toBe("salon");
    expect(resolveExperienceProfile("Mechanic").key).toBe("automotive");
    expect(resolveExperienceProfile("Something else").key).toBe("other");
    expect(resolveExperienceProfile(null).key).toBe("other");
  });

  it("keeps the shared category list valid for every displayed label", () => {
    for (const category of CATEGORIES) {
      expect(isValidCategory(category)).toBe(true);
    }
    // Legacy labels written before Interactive Business remain accepted (§39).
    expect(isValidCategory("Beauty")).toBe(true);
    expect(isValidCategory("Restaurant")).toBe(true);
    expect(isValidCategory("Not a real category")).toBe(false);
  });
});
