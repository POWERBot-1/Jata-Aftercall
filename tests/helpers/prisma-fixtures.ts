import { randomUUID } from "node:crypto";

export const uid = () => randomUUID().slice(0, 12);

export const STOREFRONT_SETTINGS = {
  categoryKey: "food",
  themeKey: "food-grill",
  brand: { businessName: "Choma Place" },
  settings: { deliveryFeeKES: 200, minOrderKES: 0, deliveryEnabled: true, pickupEnabled: true },
  sections: [],
};

/** A published business with a published storefront. Every row is unique, so tests can share one database. */
export async function seedBusiness(p: any, over: Record<string, unknown> = {}) {
  const u = uid();
  const owner = await p.user.create({
    data: { email: `owner-${u}@test.invalid`, name: "Owner", passwordHash: "test-only", role: "CUSTOMER" },
  });
  const business = await p.business.create({
    data: {
      ownerId: owner.id, slug: `t-${u}`, name: "Choma Place", category: "food", theme: "food-grill",
      phone: "0722000000", whatsapp: "0722000000", isPublished: true, status: "ACTIVE", ...over,
    },
  });
  await p.businessExperience.create({
    data: {
      businessId: business.id, categoryKey: "food", themeKey: "food-grill", status: "PUBLISHED",
      draftJson: JSON.stringify(STOREFRONT_SETTINGS), draftVersion: 1, historyCursor: 0, publishedVersion: 1,
      publishedJson: JSON.stringify(STOREFRONT_SETTINGS),
    },
  });
  return { owner, business };
}

export async function seedProduct(p: any, businessId: string, over: Record<string, unknown> = {}) {
  return p.product.create({
    data: {
      businessId, name: `Chicken ${uid()}`, currency: "KES", basePriceKES: 1000, stockStatus: "IN_STOCK",
      minOrder: 1, maxOrder: 20, preOrderAllowed: false, deliveryEligible: true, isActive: true, isFeatured: false,
      sortOrder: 0, quantity: null, ...over,
    },
  });
}
