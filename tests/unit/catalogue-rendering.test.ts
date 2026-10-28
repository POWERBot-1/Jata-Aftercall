import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CartProvider } from "@/components/storefront/CartProvider";
import { CatalogueClient } from "@/components/storefront/CatalogueClient";
import { itemCardDataFor } from "@/lib/experience/catalogue";
import { getExperienceProfile } from "@/lib/experience/categories";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";

function fixture(category: string) {
  const profile = getExperienceProfile(category);
  const item: StorefrontItem = {
    id: "owned-item", kind: category === "salon" ? "service" : "product", name: "Owned catalogue fact", description: "Owner description",
    price: 650, wasPrice: null, priceLabel: null, pricingType: "FIXED", imageUrl: null, images: [], category: "Owned category", tags: [],
    brand: null, portionSize: null, ingredients: null, prepMinutes: null, durationMinutes: category === "salon" ? 60 : null,
    depositKES: 0, staffName: null, availability: null, bookingEnabled: category === "salon", stockStatus: "IN_STOCK", isFeatured: false,
    variants: [], variantOptions: {}, addOns: [],
  };
  // Extra/private draft data must not cross the filtered-card client boundary.
  const data = { business: { slug: "owned-slug", internalOnly: "PRIVATE OWNER" }, profile,
    theme: { treatment: { cardStyle: "raised" } }, document: { privateDraft: "PRIVATE DRAFT" }, publishedVersion: 3 } as unknown as StorefrontData;
  return { profile, item, data };
}
const router = { bfcacheId: "qa-router-fixture", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

describe("faithful server/client catalogue context", () => {
  it("serializes only the required public card fields, including real theme treatment", () => {
    const { data, profile } = fixture("retail");
    const result = itemCardDataFor(data);
    expect(result).toEqual({ business: { slug: "owned-slug" }, profile: { capabilities: profile.capabilities, cta: { add: profile.cta.add } },
      theme: { treatment: { cardStyle: "raised" } } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result.profile.capabilities).not.toBe(profile.capabilities);
  });
  it.each(["retail", "food", "salon"])("renders actual %s cards with theme and appropriate commerce/service CTA, no unsafe cast", (category) => {
    const { data, profile, item } = fixture(category);
    const html = renderToString(React.createElement(AppRouterContext.Provider, { value: router },
      React.createElement(CartProvider, { slug: "owned-slug", businessId: "owned-business", cartNoun: profile.cta.cart,
        checkoutHref: "/b/owned-slug/checkout", canCheckout: profile.capabilities.includes("commerce"), children:
          React.createElement(CatalogueClient, { items: [item], data: itemCardDataFor(data), businessId: "owned-business",
            filters: { categories: [], priceBands: [], showStockFilter: category !== "salon", searchPlaceholder: profile.searchPlaceholder,
              itemNoun: profile.itemNoun, itemNounPlural: profile.itemNounPlural } }) })));
    expect(html).toContain("eb-card--raised");
    expect(html).toContain("Owned catalogue fact");
    expect(html).toContain("KES 650");
    expect(html).not.toContain("PRIVATE");
    if (category === "salon") { expect(html).toContain(">Book</a>"); expect(html).not.toContain("In stock only"); }
    else { expect(html).toContain(profile.cta.add); expect(html).toContain("In stock only"); }
  });
});
