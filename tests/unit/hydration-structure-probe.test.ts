import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CartProvider } from "@/components/storefront/CartProvider";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { SectionRenderer } from "@/components/storefront/Sections";
import { BusinessCatalogue } from "@/components/storefront/BusinessCatalogue";
import { ItemDetailClient, ItemViewTracker } from "@/components/storefront/ItemDetailClient";
import { EnquiryClient } from "@/components/storefront/EnquiryClient";
import { BookingClient } from "@/components/storefront/BookingClient";
import { PreviewClient } from "@/components/dashboard/PreviewClient";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { getExperienceProfile } from "@/lib/experience/categories";
import { resolveExperienceTheme } from "@/lib/experience/themes";
import { createExperienceDocument } from "@/lib/experience/document";
import { seedNewDocument } from "@/lib/experience/variant";
import { businessRecipeFor, documentBusinessRecipe, defaultBusinessRecipe, recipeLayoutFor } from "@/lib/experience/businessRecipes";
import { itemCardDataFor } from "@/lib/experience/catalogue";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";

/**
 * Structural hydration probe for the historical React #418 class.
 *
 * React's `throwOnHydrationMismatch(fiber)` without `fromText` reports arg[0]="HTML":
 * the server DOM node sequence diverged from what the client walked — the classic
 * generator being invalid HTML nesting that the browser parser restructures
 * (block-in-`<p>`, nested `<a>`/`<button>`, `<li>` outside lists). The mismatching
 * subtree then hydrates differently from any byte-identical `renderToString` output.
 * These tests pin well-formed nesting for every hydrated storefront/dashboard subtree,
 * so any regression of the class fails deterministically in the native suite.
 */

const router = { bfcacheId: "qa-router-fixture", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

const INLINE_CONTAINERS = new Set(["p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "a", "button", "label", "figcaption"]);
const BLOCK_CHILDREN = new Set(["div", "ul", "ol", "section", "article", "header", "footer", "nav", "main", "form", "p", "table", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "pre"]);
const LIST_ITEMS = new Set(["li"]);
const LIST_CONTAINERS = new Set(["ul", "ol"]);

/** Minimal stack-based nesting validator over renderToString markup (void tags handled). */
function nestingViolations(html: string): string[] {
  const violations: string[] = [];
  const stack: string[] = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const closing = match[0].startsWith("</");
    const name = match[1].toLowerCase();
    if (voidTags.has(name) || match[3] === "/") continue;
    if (closing) {
      const open = stack.pop();
      if (open !== name) violations.push(`unbalanced close </${name}> (open <${open ?? "none"}>)`);
      continue;
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      if (INLINE_CONTAINERS.has(parent) && BLOCK_CHILDREN.has(name)) violations.push(`block <${name}> inside inline <${parent}>`);
      if (parent === "a" && (name === "a" || name === "button")) violations.push(`<${name}> nested inside <a>`);
      if (parent === "button" && (name === "a" || name === "button")) violations.push(`<${name}> nested inside <button>`);
      if (LIST_ITEMS.has(name) && !(parent && LIST_CONTAINERS.has(parent))) violations.push(`<li> directly under <${parent}>`);
      if (LIST_CONTAINERS.has(parent) && !(LIST_ITEMS.has(name) || name === "script" || name === "template")) violations.push(`<${name}> directly inside <${parent}>`);
    }
    stack.push(name);
  }
  if (stack.length) violations.push(`unclosed tags: ${stack.join(" > ")}`);
  return violations;
}

function itemFor(category: string): StorefrontItem {
  return { id: "owned-row", kind: ["salon", "professional"].includes(category) ? "service" : "product", name: "Owned catalogue fact", description: "Owned description",
    price: 650, wasPrice: null, priceLabel: null, pricingType: category === "professional" ? "QUOTE" : "FIXED", imageUrl: "/favicon.svg", images: [], category: "Owned category", tags: [],
    brand: "Owned brand", portionSize: "Owned plate", ingredients: "Owned ingredients", prepMinutes: 15, durationMinutes: category === "salon" ? 60 : null,
    depositKES: 0, staffName: "Owned specialist", availability: null, bookingEnabled: category === "salon", stockStatus: "IN_STOCK", isFeatured: false,
    variants: [], variantOptions: {}, addOns: [] };
}
function dataFor(category: string): StorefrontData {
  const document = seedNewDocument(createExperienceDocument({ categoryKey: category, businessName: "Owned business" }), "QA-STRUCTURE").document;
  const profile = getExperienceProfile(category);
  const item = itemFor(category);
  return { business: { id: "owned-business", slug: "owned-slug", name: "Owned business", category, phone: "0712345678", whatsapp: "0712345678",
    location: "Owned location", lat: null, lng: null, description: null, logoUrl: null, isPublished: true, status: "ACTIVE" },
    document, profile, theme: resolveExperienceTheme(profile.defaultThemeKey), items: ["salon", "professional"].includes(category) ? [] : [item], services: ["salon", "professional"].includes(category) ? [item] : [],
    offer: null, categories: ["Owned category"], isPreview: false, publishedVersion: 3 };
}
function render(child: React.ReactNode, data: StorefrontData) {
  return renderToString(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(CartProvider,
    { slug: data.business.slug, businessId: data.business.id, cartNoun: data.profile.cta.cart, checkoutHref: "/b/owned-slug/checkout",
      canCheckout: data.profile.capabilities.includes("commerce"), children: child })));
}

describe("hydration structure probe (React #418 HTML-mismatch class)", () => {
  it.each(["retail", "food", "salon", "professional", "technical"])("keeps well-formed nesting in the %s storefront shell and home sections", (category) => {
    const data = dataFor(category);
    const shell = render(React.createElement(StorefrontShell, { data, children: React.createElement("main", { className: "eb-family-body" }, "Owned hero copy") }), data);
    expect(nestingViolations(shell)).toEqual([]);
    for (const section of data.document.sections) {
      expect(nestingViolations(render(React.createElement(SectionRenderer, { section, data }), data))).toEqual([]);
    }
  });

  it.each(["retail", "food", "salon", "professional", "technical"])("keeps well-formed nesting across every registered %s recipe presentation", (category) => {
    const data = dataFor(category);
    const recipe = businessRecipeFor(category)!;
    for (const layout of recipe.layouts) {
      const config = { ...defaultBusinessRecipe(recipe), layout } as ReturnType<typeof defaultBusinessRecipe>;
      const html = render(React.createElement(BusinessCatalogue, { data: itemCardDataFor(data), config, layout: config.layout, items: data.items.length ? data.items : data.services }), data);
      expect(html).toContain(`data-recipe-presentation="${layout}"`);
      expect(nestingViolations(html)).toEqual([]);
    }
  });

  it("keeps well-formed nesting in item, enquiry and booking initial renders", () => {
    const salon = dataFor("salon"), professional = dataFor("professional");
    const item = itemFor("salon");
    const itemHtml = render(React.createElement(ItemDetailClient, { item, slug: "owned-slug", businessId: "owned-business",
      capabilities: salon.profile.capabilities, cta: salon.profile.cta, itemNoun: salon.profile.itemNoun, related: [] }), salon);
    expect(nestingViolations(itemHtml)).toEqual([]);
    expect(nestingViolations(render(React.createElement(ItemViewTracker, { businessId: "owned-business", itemId: item.id, kind: "service" }), salon))).toEqual([]);
    const enquiryHtml = renderToString(React.createElement(EnquiryClient, { slug: "owned-slug", preview: false,
      services: [{ id: "owned-quote", name: "Owned quote work", description: "Owned scope", kind: "service" as const, price: null, pricingType: "QUOTE" as const, bookingEnabled: false }] }));
    expect(nestingViolations(enquiryHtml)).toEqual([]);
    const bookingHtml = renderToString(React.createElement(BookingClient, {
      slug: "owned-slug", businessId: "owned-business",
      calendar: [{ date: "2026-10-12", label: "Mon, 12 Oct" }],
      bookables: [{ id: item.id, name: item.name, kind: "service", durationMinutes: 60, depositKES: 0, price: 1200, pricingType: "FIXED", imageUrl: null, description: null }],
      preselectedId: item.id, ctaLabel: "Book now", confirmationLabel: "Booking requested", requireDate: true,
    }));
    expect(nestingViolations(bookingHtml)).toEqual([]);
  });

  it("keeps well-formed nesting in the dashboard preview chrome (the #418 record path)", () => {
    const tabs = renderToString(React.createElement(AppRouterContext.Provider, { value: router },
      React.createElement(StudioTabs, { businessId: "owned-business", capabilities: ["commerce", "bookings"] })));
    expect(nestingViolations(tabs)).toEqual([]);
    const preview = renderToString(React.createElement(AppRouterContext.Provider, { value: router },
      React.createElement(PreviewClient, { businessId: "owned-business", slug: "owned-slug", draftVersion: 1, publishedVersion: 0 })));
    expect(nestingViolations(preview)).toEqual([]);
  });
});
