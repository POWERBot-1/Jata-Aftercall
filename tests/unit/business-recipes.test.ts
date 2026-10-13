import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument, updateSection } from "@/lib/experience/document";
import { seedNewDocument } from "@/lib/experience/variant";
import { validateExperienceDocument, validateExperienceJson } from "@/lib/experience/schema";
import { BUSINESS_RECIPES, businessRecipeFor, defaultBusinessRecipe, documentBusinessRecipe, parseBusinessRecipeConfig, recipeCatalogue, recipeFacts, seedBusinessRecipe } from "@/lib/experience/businessRecipes";
import type { StorefrontItem } from "@/lib/experience/storefront";
function seeded(categoryKey: string) { return seedNewDocument(createExperienceDocument({ categoryKey, businessName: "Owner facts", phone: "0712345678" }), "QA-RECIPE").document; }
function item(kind: "product" | "service", id: string): StorefrontItem {
  return { id, kind, name: "Owned name", description: null, price: 650, wasPrice: null, priceLabel: null, pricingType: "FIXED", imageUrl: null, images: [],
    category: null, tags: [], brand: "Owned brand", portionSize: "Owned portion", ingredients: "Owned ingredients", prepMinutes: 15,
    durationMinutes: 60, depositKES: 100, staffName: "Owned specialist", availability: null, bookingEnabled: true, stockStatus: "IN_STOCK", isFeatured: false,
    variants: [], variantOptions: {}, addOns: [] };
}

describe("registered business recipes", () => {
  it.each(["retail", "food", "salon", "professional", "technical"])("seeds a validated versioned %s recipe without dummy records or changing business facts", (category) => {
    const base = createExperienceDocument({ categoryKey: category, businessName: "Owner facts", phone: "0712345678" });
    const doc = seeded(category); const recipe = businessRecipeFor(category)!;
    expect(documentBusinessRecipe(doc)).toEqual(defaultBusinessRecipe(recipe));
    expect(doc.brand.businessName).toBe(base.brand.businessName);
    expect(doc.settings).toEqual(base.settings);
    expect(doc.sections.find((section) => section.type === recipe.primarySection)?.config).toEqual({ businessRecipe: defaultBusinessRecipe(recipe) });
    expect(validateExperienceDocument(doc).ok).toBe(true);
  });
  it("does not silently enroll existing v1/v2 or unsupported categories during normalization", () => {
    const legacy = createExperienceDocument({ categoryKey: "food", businessName: "Owner" });
    expect(documentBusinessRecipe(normalizeExperienceDocument(legacy))).toBeNull();
    expect(seedBusinessRecipe(legacy)).toBe(legacy);
    const v2 = seeded("food"); v2.sections = v2.sections.map((section) => ({ ...section, config: undefined }));
    expect(documentBusinessRecipe(normalizeExperienceDocument(v2))).toBeNull();
    // The unsupported-category invariant follows the established order: technical is now registered,
    // so the next unimplemented category carries it.
    expect(documentBusinessRecipe(seeded("hospitality"))).toBeNull();
  });
  it.each([
    { version: 2, key: "food-menu", details: [] },
    { version: 1, key: "salon-booking", details: [] },
    { version: 1, key: "food-menu", details: ["price"] },
    { version: 1, key: "food-menu", details: ["ingredients", "ingredients"] },
    { version: 1, key: "food-menu", details: "ingredients" },
    { version: 1, key: "food-menu", details: [], unitPriceKES: 1 },
    { version: 1, key: "food-menu", details: [], javascript: "alert(1)" },
  ])("rejects unsupported version/category/authority/executable config %j", (businessRecipe) => {
    const doc = seeded("food"); doc.sections.find((section) => section.type === "menu")!.config = { businessRecipe };
    expect(parseBusinessRecipeConfig({ businessRecipe }, "food", "menu")).toBeNull();
    const result = validateExperienceDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "unsupported_config" }));
  });
  it("rejects recipe config on the wrong section or legacy outer format", () => {
    const config = { businessRecipe: defaultBusinessRecipe(businessRecipeFor("food")!) };
    expect(parseBusinessRecipeConfig(config, "food", "hero")).toBeNull();
    const legacy = createExperienceDocument({ categoryKey: "food", businessName: "Owner" });
    legacy.sections.find((section) => section.type === "menu")!.config = config;
    expect(validateExperienceDocument(legacy).ok).toBe(false);
  });
  it("preserves exact owner-selected presentation in normalizer, edit, JSON validation and publication input", () => {
    const doc = seeded("food"); const menu = doc.sections.find((section) => section.type === "menu")!;
    const updated = updateSection(doc, menu.id, { title: "Owned menu heading", layout: "compact", config: { businessRecipe: { version: 1, key: "food-menu", details: ["portion"] } } });
    expect(documentBusinessRecipe(updated)?.details).toEqual(["portion"]);
    expect(updated.sections.find((section) => section.id === menu.id)?.title).toBe("Owned menu heading");
    const validated = validateExperienceJson(JSON.stringify(updated));
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.document).toEqual(updated);
    expect(documentBusinessRecipe(updateSection(updated, menu.id, { config: {} }))).toBeNull();
  });
  it.each(["salon", "technical"])("uses real service rows for %s even when unrelated product rows exist", (category) => {
    const config = defaultBusinessRecipe(businessRecipeFor(category)!);
    const service = item("service", "owned-service"); const product = item("product", "irrelevant-product");
    expect(recipeCatalogue({ items: [product], services: [service] }, config)).toEqual([service]);
    expect(recipeCatalogue({ items: [], services: [service] }, config)).toEqual([service]);
    expect(recipeCatalogue({ items: [product], services: [] }, config)).toEqual([]);
  });
  it.each(["retail", "food"])("uses products for %s without requiring service records", (category) => {
    const product = item("product", "owned-product"); const service = item("service", "irrelevant-service");
    const config = defaultBusinessRecipe(businessRecipeFor(category)!);
    expect(recipeCatalogue({ items: [product], services: [] }, config)).toEqual([product]);
    expect(recipeCatalogue({ items: [], services: [service] }, config)).toEqual([]);
  });
  it("renders only category-appropriate, explicitly owner-selected real facts; missing facts are omitted", () => {
    const owned = item("product", "owned-product");
    const food = defaultBusinessRecipe(businessRecipeFor("food")!);
    expect(recipeFacts(owned, food).map((fact) => fact.key)).toEqual(["ingredients", "portion", "prep"]);
    expect(recipeFacts(owned, { ...food, details: ["portion"] })).toEqual([{ key: "portion", label: "Portion", value: "Owned portion" }]);
    const empty = { ...owned, ingredients: null, portionSize: null, prepMinutes: null };
    expect(recipeFacts(empty, food)).toEqual([]);
    expect(BUSINESS_RECIPES.map((recipe) => recipe.layout)).toEqual(["product-grid", "menu-list", "service-list", "service-list", "service-list"]);
    expect(BUSINESS_RECIPES.map((recipe) => recipe.category)).toEqual(["retail", "food", "salon", "professional", "technical"]);
  });
});
