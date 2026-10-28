import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CartProvider } from "@/components/storefront/CartProvider";
import { BusinessCatalogue } from "@/components/storefront/BusinessCatalogue";
import { getExperienceProfile } from "@/lib/experience/categories";
import { resolveExperienceTheme } from "@/lib/experience/themes";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { seedNewDocument } from "@/lib/experience/variant";
import { validateExperienceDocument, validateExperienceJson } from "@/lib/experience/schema";
import {
  BUSINESS_RECIPES,
  businessRecipeFor,
  defaultBusinessRecipe,
  documentBusinessRecipe,
  parseBusinessRecipeConfig,
  recipeLayoutFor,
  seedBusinessRecipe,
  type BusinessRecipeConfig,
} from "@/lib/experience/businessRecipes";
import { itemCardDataFor } from "@/lib/experience/catalogue";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";

const router = { bfcacheId: "qa-router-fixture", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function itemFor(category: string): StorefrontItem {
  return { id: "owned-row", kind: category === "salon" ? "service" : "product", name: "Owned catalogue fact", description: "Owned description",
    price: 650, wasPrice: null, priceLabel: null, pricingType: "FIXED", imageUrl: "/favicon.svg", images: [], category: "Owned category", tags: [],
    brand: "Owned brand", portionSize: "Owned plate", ingredients: "Owned ingredients", prepMinutes: 15, durationMinutes: category === "salon" ? 60 : null,
    depositKES: 0, staffName: "Owned specialist", availability: null, bookingEnabled: category === "salon", stockStatus: "IN_STOCK", isFeatured: false,
    variants: [], variantOptions: {}, addOns: [] };
}
function dataFor(category: string): StorefrontData {
  const document = seedNewDocument(createExperienceDocument({ categoryKey: category, businessName: "Owned business" }), "QA-LAYOUT").document;
  const profile = getExperienceProfile(category);
  const item = itemFor(category);
  return { business: { id: "owned-business", slug: "owned-slug", name: "Owned business", category, phone: "0712345678", whatsapp: null,
    location: null, lat: null, lng: null, description: null, logoUrl: null, isPublished: true, status: "ACTIVE" },
    document, profile, theme: resolveExperienceTheme(profile.defaultThemeKey), items: category === "salon" ? [] : [item], services: category === "salon" ? [item] : [],
    offer: null, categories: ["Owned category"], isPreview: false, publishedVersion: 3 };
}
function render(child: React.ReactNode, data: StorefrontData) {
  return renderToString(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(CartProvider,
    { slug: data.business.slug, businessId: data.business.id, cartNoun: data.profile.cta.cart, checkoutHref: "/b/owned-slug/checkout",
      canCheckout: data.profile.capabilities.includes("commerce"), children: child })));
}
function configWithLayout(category: string, layout: string): BusinessRecipeConfig {
  return { ...defaultBusinessRecipe(businessRecipeFor(category)!), layout: layout as BusinessRecipeConfig["layout"] };
}

describe("registered recipe layouts", () => {
  it("keeps seeded default presentation implicit and canonical", () => {
    for (const recipe of BUSINESS_RECIPES) {
      const doc = seedNewDocument(createExperienceDocument({ categoryKey: recipe.category, businessName: "Owner" }), "QA-LAYOUT").document;
      const config = documentBusinessRecipe(doc)!;
      expect(config.layout).toBeUndefined();
      expect(defaultBusinessRecipe(recipe).layout).toBeUndefined();
      const section = doc.sections.find((entry) => entry.type === recipe.primarySection)!;
      expect(recipeLayoutFor(config, recipe, section.layout)).toBe(recipe.category === "retail" ? "product-grid" : recipe.layout);
    }
    expect(BUSINESS_RECIPES.map((recipe) => recipe.layout)).toEqual(["product-grid", "menu-list", "service-list", "service-list", "service-list"]);
    expect(BUSINESS_RECIPES.map((recipe) => recipe.layouts)).toEqual([["product-grid", "product-list"], ["menu-list", "menu-board"], ["service-list", "service-grid"], ["service-list", "service-grid"], ["service-list", "service-grid"]]);
    expect(BUSINESS_RECIPES.map((recipe) => recipe.listLayout)).toEqual(["product-list", "menu-list", "service-list", "service-list", "service-list"]);
  });

  it("accepts only this recipe's registered layouts and never authority fields", () => {
    expect(parseBusinessRecipeConfig({ businessRecipe: { version: 1, key: "food-menu", details: [], layout: "menu-board" } }, "food", "menu"))
      .toEqual({ version: 1, key: "food-menu", details: [], layout: "menu-board" });
    expect(parseBusinessRecipeConfig({ businessRecipe: { version: 1, key: "retail-stock", details: ["brand"], layout: "product-list" } }, "retail", "featured"))
      .toEqual({ version: 1, key: "retail-stock", details: ["brand"], layout: "product-list" });
    // Legacy config without a layout keeps its canonical default and exact shape.
    expect(parseBusinessRecipeConfig({ businessRecipe: { version: 1, key: "food-menu", details: [] } }, "food", "menu"))
      .toEqual({ version: 1, key: "food-menu", details: [] });
    for (const rejected of [
      { version: 1, key: "food-menu", details: [], layout: "service-list" },
      { version: 1, key: "food-menu", details: [], layout: "product-grid" },
      { version: 1, key: "food-menu", details: [], layout: "menu-anything" },
      { version: 1, key: "food-menu", details: [], layout: 5 },
      { version: 1, key: "food-menu", details: [], layout: "menu-board", price: 1 },
      { version: 1, key: "food-menu", details: [], layout: "menu-board", html: "<b>" },
    ]) {
      expect(parseBusinessRecipeConfig({ businessRecipe: rejected }, "food", "menu")).toBeNull();
    }
  });

  it("validates and preserves owner-selected layouts through normalization and publication JSON exactly", () => {
    const seeded = seedNewDocument(createExperienceDocument({ categoryKey: "food", businessName: "Owner" }), "QA-LAYOUT").document;
    const menu = seeded.sections.find((section) => section.type === "menu")!;
    const withLayout = normalizeExperienceDocument({ ...seeded, sections: seeded.sections.map((section) =>
      section.id === menu.id ? { ...section, config: { businessRecipe: { version: 1, key: "food-menu", details: ["portion"], layout: "menu-board" } } } : section) });
    expect(documentBusinessRecipe(withLayout)).toEqual({ version: 1, key: "food-menu", details: ["portion"], layout: "menu-board" });
    expect(validateExperienceDocument(withLayout).ok).toBe(true);
    const validated = validateExperienceJson(JSON.stringify(withLayout));
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.document).toEqual(withLayout);
    // Normalization never injects a layout into legacy configs and never rewrites an unsupported one.
    const untouched = normalizeExperienceDocument(seeded);
    expect(documentBusinessRecipe(untouched)?.layout).toBeUndefined();
    const unsupported = { ...seeded, sections: seeded.sections.map((section) =>
      section.id === menu.id ? { ...section, config: { businessRecipe: { version: 1, key: "food-menu", details: [], layout: "menu-board", script: "x" } } } : section) };
    expect(validateExperienceDocument(unsupported).ok).toBe(false);
    const result = validateExperienceDocument(unsupported);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "unsupported_config" }));
  });

  it("resolves presentation: explicit registered config first, then the unchanged legacy section-layout mapping", () => {
    const retail = businessRecipeFor("retail")!; const food = businessRecipeFor("food")!; const salon = businessRecipeFor("salon")!;
    const foodConfig = defaultBusinessRecipe(food);
    expect(recipeLayoutFor({ ...foodConfig, layout: "menu-board" }, food, "grid")).toBe("menu-board");
    expect(recipeLayoutFor({ ...foodConfig, layout: "menu-board" }, food, undefined)).toBe("menu-board");
    // Legacy mapping preserved exactly for configs without an explicit layout.
    expect(recipeLayoutFor(foodConfig, food, "grid")).toBe("product-grid");
    expect(recipeLayoutFor(foodConfig, food, "list")).toBe("menu-list");
    expect(recipeLayoutFor(foodConfig, food, "compact")).toBe("menu-list");
    expect(recipeLayoutFor(foodConfig, food, "carousel")).toBe("menu-list");
    expect(recipeLayoutFor(defaultBusinessRecipe(salon), salon, "list")).toBe("service-list");
    expect(recipeLayoutFor(defaultBusinessRecipe(retail), retail, "list")).toBe("product-list");
    expect(recipeLayoutFor(defaultBusinessRecipe(retail), retail, undefined)).toBe("product-grid");
    // A layout outside the recipe's registry can never win even if it reaches the resolver.
    expect(recipeLayoutFor({ ...foodConfig, layout: "service-grid" as never }, food, "list")).toBe("menu-list");
  });

  it("renders the text menu board without media and keeps authoritative prices and real facts", () => {
    const data = dataFor("food");
    const html = render(React.createElement(BusinessCatalogue, { items: data.items, data: itemCardDataFor(data),
      config: configWithLayout("food", "menu-board"), layout: "grid" }), data);
    expect(html).toContain('data-recipe-presentation="menu-board"');
    expect(html).toContain("eb-business-recipe--menu-board");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("No photo yet");
    expect(html).toContain("eb-recipe-item__price");
    expect(html).toContain("Owned catalogue fact");
    expect(html).toContain("KES 650");
    expect(html).toContain("Owned ingredients");
    expect(html).toContain('data-recipe-item="owned-row"');
    expect(html).toContain('data-recipe-action="cart"');
    // Explicit registered layout wins over the legacy grid mapping.
    expect(html).not.toContain("eb-business-recipe--product-grid");
  });

  it("renders the salon service grid with real cover media and the booking action, never cart", () => {
    const data = dataFor("salon");
    const html = render(React.createElement(BusinessCatalogue, { items: data.services, data: itemCardDataFor(data),
      config: configWithLayout("salon", "service-grid"), layout: "list" }), data);
    expect(html).toContain('data-recipe-presentation="service-grid"');
    expect(html).toContain("eb-business-recipe--service-grid");
    expect(html).toContain('alt="Owned catalogue fact"');
    expect(html).toContain("/book?service=owned-row");
    expect(html).toContain('data-recipe-action="book"');
    expect(html).toContain("KES 650");
    expect(html).toContain("Owned specialist");
    expect(html).not.toContain('data-recipe-action="cart"');
    expect(html).not.toContain("eb-business-recipe--service-list");
  });

  it("renders the retail product list from the registered config on every surface", () => {
    const data = dataFor("retail");
    for (const sectionLayout of ["grid", "list", undefined]) {
      const html = render(React.createElement(BusinessCatalogue, { items: data.items, data: itemCardDataFor(data),
        config: configWithLayout("retail", "product-list"), layout: sectionLayout }), data);
      expect(html).toContain('data-recipe-presentation="product-list"');
      expect(html).toContain("eb-business-recipe--product-list");
      expect(html).toContain('alt="Owned catalogue fact"');
      expect(html).toContain("Owned brand");
      expect(html).toContain('data-recipe-action="cart"');
    }
  });

  it("keeps the seeded legacy presentation markup unchanged when no layout is configured", () => {
    const food = dataFor("food");
    const seededHtml = render(React.createElement(BusinessCatalogue, { items: food.items, data: itemCardDataFor(food),
      config: documentBusinessRecipe(food.document)!, layout: "list" }), food);
    expect(seededHtml).toContain('data-recipe-presentation="menu-list"');
    expect(seededHtml).toContain("<img");
    expect(seededHtml).toContain("KES 650");
    const salon = dataFor("salon");
    const salonHtml = render(React.createElement(BusinessCatalogue, { items: salon.services, data: itemCardDataFor(salon),
      config: documentBusinessRecipe(salon.document)!, layout: "list" }), salon);
    expect(salonHtml).toContain('data-recipe-presentation="service-list"');
    expect(salonHtml).toContain('data-recipe-action="book"');
  });

  it("never lets a recipe layout change payment, option or availability behaviour", () => {
    const data = dataFor("food");
    const item = { ...itemFor("food"), addOns: [{ id: "owned-extra", name: "Owned extra", priceKES: 30 }] };
    const board = render(React.createElement(BusinessCatalogue, { items: [item], data: itemCardDataFor(data),
      config: configWithLayout("food", "menu-board") }), data);
    expect(board).toContain('data-recipe-action="options"');
    expect(board).not.toContain('data-recipe-action="cart"');
    const soldOut = render(React.createElement(BusinessCatalogue, { items: [{ ...itemFor("food"), stockStatus: "OUT_OF_STOCK" as const }], data: itemCardDataFor(data),
      config: configWithLayout("food", "menu-board") }), data);
    expect(soldOut).not.toContain('data-recipe-action="cart"');
    expect(soldOut).toContain('data-recipe-action="details"');
    // Retail's registered stock fact still reports unavailability in its registered list layout.
    const retail = dataFor("retail");
    const retailSoldOut = render(React.createElement(BusinessCatalogue, { items: [{ ...itemFor("retail"), stockStatus: "OUT_OF_STOCK" as const }], data: itemCardDataFor(retail),
      config: configWithLayout("retail", "product-list") }), retail);
    expect(retailSoldOut).toContain("Unavailable");
    expect(retailSoldOut).not.toContain('data-recipe-action="cart"');
    expect(item.price).toBe(650);
  });

  it("refuses recipe layouts on unsupported categories or sections through the seeded parser path", () => {
    const professional = seedBusinessRecipe(createExperienceDocument({ categoryKey: "professional", businessName: "Owner" }));
    for (const section of professional.sections) {
      expect(parseBusinessRecipeConfig({ businessRecipe: { version: 1, key: "professional-list", details: [], layout: "menu-board" } }, "professional", section.type)).toBeNull();
    }
    expect(parseBusinessRecipeConfig({ businessRecipe: { version: 1, key: "food-menu", details: [], layout: "menu-board" } }, "food", "hero")).toBeNull();
  });
});
