import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CartProvider } from "@/components/storefront/CartProvider";
import { BusinessCatalogue } from "@/components/storefront/BusinessCatalogue";
import { SectionRenderer } from "@/components/storefront/Sections";
import { ItemDetailClient } from "@/components/storefront/ItemDetailClient";
import { CatalogueClient } from "@/components/storefront/CatalogueClient";
import { getExperienceProfile } from "@/lib/experience/categories";
import { resolveExperienceTheme } from "@/lib/experience/themes";
import { createExperienceDocument } from "@/lib/experience/document";
import { seedNewDocument } from "@/lib/experience/variant";
import { defaultBusinessRecipe, businessRecipeFor, documentBusinessRecipe } from "@/lib/experience/businessRecipes";
import { itemCardDataFor } from "@/lib/experience/catalogue";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
function dataFor(category: string): StorefrontData {
  const document = seedNewDocument(createExperienceDocument({ categoryKey: category, businessName: "Owned business" }), "QA-RECIPE").document;
  const profile = getExperienceProfile(category);
  const item: StorefrontItem = { id: "owned-row", kind: ["salon", "professional", "technical"].includes(category) ? "service" : "product", name: "Owned catalogue fact", description: "Owned description",
    price: 650, wasPrice: null, priceLabel: null, pricingType: "FIXED", imageUrl: "/favicon.svg", images: [], category: "Owned category", tags: [],
    brand: "Owned brand", portionSize: "Owned plate", ingredients: "Owned ingredients", prepMinutes: 15, durationMinutes: category === "salon" ? 60 : null,
    depositKES: 0, staffName: "Owned specialist", availability: null, bookingEnabled: category === "salon", stockStatus: "IN_STOCK", isFeatured: false,
    variants: [], variantOptions: {}, addOns: [] };
  return { business: { id: "owned-business", slug: "owned-slug", name: "Owned business", category, phone: "0712345678", whatsapp: null,
    location: null, lat: null, lng: null, description: null, logoUrl: null, isPublished: true, status: "ACTIVE" },
    document, profile, theme: resolveExperienceTheme(profile.defaultThemeKey), items: ["salon", "professional", "technical"].includes(category) ? [] : [item], services: ["salon", "professional", "technical"].includes(category) ? [item] : [],
    offer: null, categories: ["Owned category"], isPreview: false, publishedVersion: 3 };
}
function render(child: React.ReactNode, data: StorefrontData) {
  return renderToString(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(CartProvider,
    { slug: data.business.slug, businessId: data.business.id, cartNoun: data.profile.cta.cart, checkoutHref: "/b/owned-slug/checkout",
      canCheckout: data.profile.capabilities.includes("commerce"), children: child })));
}

describe("functional category recipe SSR", () => {
  it.each(["retail", "food", "salon"])("shares actual %s data/config between home section and filtered catalogue", (category) => {
    const data = dataFor(category); const recipe = businessRecipeFor(category)!; const config = documentBusinessRecipe(data.document)!;
    const section = data.document.sections.find((section) => section.type === recipe.primarySection)!;
    const home = render(React.createElement(SectionRenderer, { section, data }), data);
    const items = category === "salon" ? data.services : data.items;
    const shop = render(React.createElement(CatalogueClient, { items, data: itemCardDataFor(data), recipe: config, recipeLayout: section.layout, businessId: data.business.id,
      filters: { categories: ["Owned category"], priceBands: [], showStockFilter: category !== "salon", searchPlaceholder: data.profile.searchPlaceholder,
        itemNoun: data.profile.itemNoun, itemNounPlural: data.profile.itemNounPlural } }), data);
    for (const html of [home, shop]) {
      expect(html).toContain(`data-business-recipe="${recipe.key}"`);
      expect(html).toContain(`eb-business-recipe--${recipe.layout}`);
      expect(html).toContain("Owned catalogue fact"); expect(html).toContain("KES 650");
      expect(html).toContain('alt="Owned catalogue fact"');
      if (category === "retail") { expect(html).toContain("Owned brand"); expect(html).not.toContain("Owned ingredients"); expect(html).toContain('data-recipe-action="cart"'); }
      if (category === "food") { expect(html).toContain("Owned ingredients"); expect(html).toContain("Owned plate"); expect(html).toContain("15 min"); expect(html).not.toContain("Owned brand"); }
      if (category === "salon") { expect(html).toContain("Owned specialist"); expect(html).toContain("60 min"); expect(html).toContain("/book?service=owned-row"); expect(html).not.toContain('data-recipe-action="cart"'); }
    }
    if (category === "salon") { expect(shop).toContain('aria-label="Service duration"'); expect(shop).not.toContain("In stock only"); }
    if (category === "food") expect(shop).toContain("Available dishes only");
  });
  it("does not directly add variant/add-on products; links to the real option-selection workflow", () => {
    const data = dataFor("food"); const item = data.items[0];
    item.addOns = [{ id: "owned-extra", name: "Owned extra", priceKES: 30 }];
    const html = render(React.createElement(BusinessCatalogue, { items: [item], data: itemCardDataFor(data), config: documentBusinessRecipe(data.document)! }), data);
    expect(html).toContain('data-recipe-action="options"'); expect(html).toContain("Choose options"); expect(html).not.toContain('data-recipe-action="cart"');
    expect(item.price).toBe(650); expect(item.addOns[0].priceKES).toBe(30);
  });
  it("keeps sold-out and quote items out of direct-cart/booking actions", () => {
    const retail = dataFor("retail"); retail.items[0].stockStatus = "OUT_OF_STOCK";
    const stock = render(React.createElement(BusinessCatalogue, { items: retail.items, data: itemCardDataFor(retail), config: documentBusinessRecipe(retail.document)! }), retail);
    expect(stock).toContain("Unavailable"); expect(stock).not.toContain('data-recipe-action="cart"');
    const salon = dataFor("salon"); salon.services[0].pricingType = "QUOTE"; salon.services[0].price = null;
    const quote = render(React.createElement(BusinessCatalogue, { items: salon.services, data: itemCardDataFor(salon), config: documentBusinessRecipe(salon.document)! }), salon);
    expect(quote).toContain("Request a quote"); expect(quote).not.toContain("Book this service");
  });
  it("honours owner-selected metadata and layout without hiding authoritative prices", () => {
    const data = dataFor("food"); const config = { ...defaultBusinessRecipe(businessRecipeFor("food")!), details: [] };
    const html = render(React.createElement(BusinessCatalogue, { items: data.items, data: itemCardDataFor(data), config, layout: "grid" }), data);
    expect(html).toContain("eb-business-recipe--product-grid"); expect(html).not.toContain("Owned ingredients"); expect(html).not.toContain("Owned plate"); expect(html).toContain("KES 650");
  });
});

describe("professional enquiries are a functional fourth service recipe", () => {
  it("renders real quote work with an asynchronous enquiry entry, no cart/stock/appointment assumptions", () => {
    const data = dataFor("professional"); const item = data.services[0]; item.price = null; item.pricingType = "QUOTE"; item.bookingEnabled = false;
    const config = documentBusinessRecipe(data.document)!;
    const html = render(React.createElement(CatalogueClient, { items: data.services, data: itemCardDataFor(data), recipe: config,
      recipeLayout: "list", businessId: data.business.id, filters: { categories: [], priceBands: [], showStockFilter: false,
        searchPlaceholder: data.profile.searchPlaceholder, itemNoun: "Service", itemNounPlural: "Services" } }), data);
    expect(html).toContain('data-business-recipe="professional-enquiry"'); expect(html).toContain("eb-business-recipe--service-list");
    expect(html).toContain("/b/owned-slug/enquire?service=owned-row"); expect(html).toContain('aria-label="Professional request type"');
    expect(html).not.toContain("In stock only"); expect(html).not.toContain('data-recipe-action="cart"'); expect(html).not.toContain("Book this service");
    expect(item.price).toBeNull(); expect(data.items).toEqual([]);
  });
  it("keeps actual fixed bookable consultations on the existing booking/payment path", () => {
    const data = dataFor("professional"); data.services[0].bookingEnabled = true;
    const html = render(React.createElement(BusinessCatalogue, { items: data.services, data: itemCardDataFor(data), config: documentBusinessRecipe(data.document)!, layout: "list" }), data);
    expect(html).toContain("/book?service=owned-row"); expect(html).toContain('data-recipe-action="book"'); expect(html).not.toContain('data-recipe-action="cart"');
  });
  it("professional detail shows only one appropriate request CTA, not duplicate broken booking links", () => {
    const data = dataFor("professional"); const item = data.services[0]; item.pricingType = "QUOTE"; item.price = null; item.bookingEnabled = false;
    const html = render(React.createElement(ItemDetailClient, { item, slug: data.business.slug, businessId: data.business.id,
      capabilities: data.profile.capabilities, cta: data.profile.cta, itemNoun: "Service", related: [], professional: true }), data);
    expect(html).toContain("/enquire?service=owned-row"); expect(html).not.toContain("/book?service=owned-row"); expect(html).not.toContain("Add to basket");
  });
  it("technical recipe routes quote work to enquiries and real bookable visits to appointments, with owned technician facts", () => {
    const data = dataFor("technical");
    const config = documentBusinessRecipe(data.document)!;
    const quoteHtml = render(React.createElement(BusinessCatalogue, { items: data.services, data: itemCardDataFor(data), config, layout: "list" }), data);
    expect(quoteHtml).toContain('data-business-recipe="technical-enquiry"');
    expect(quoteHtml).toContain("/enquire?service=owned-row"); expect(quoteHtml).toContain('data-recipe-action="enquire"');
    expect(quoteHtml).toContain("Owned specialist"); expect(quoteHtml).not.toContain("In stock only"); expect(quoteHtml).not.toContain("Add to basket");
    data.services[0].bookingEnabled = true;
    const bookHtml = render(React.createElement(BusinessCatalogue, { items: data.services, data: itemCardDataFor(data), config, layout: "list" }), data);
    expect(bookHtml).toContain("/book?service=owned-row"); expect(bookHtml).toContain('data-recipe-action="book"');
  });
});
