import "server-only";

/**
 * Preview data loader for the integrated Website Studio.
 *
 * Candidates are preview-only documents that have not been saved. The browser renders
 * them with the *existing* JATA storefront components (`ExperienceSite`), so a preview
 * is the same rendering path as production, not a mock. This loader provides the
 * tenant-scoped business/catalogue data those components need, once per page.
 *
 * Reads only. No candidate is written here, and no other tenant is queried.
 */

import prisma from "@/lib/db";
import { displayPriceKES } from "@/lib/sale-pricing";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";

export type StudioPreviewBase = {
  business: StorefrontData["business"];
  items: StorefrontItem[];
  services: StorefrontItem[];
  offer: StorefrontData["offer"];
  categories: string[];
};

function stringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function recordOf(value: string | null | undefined): Record<string, string[]> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, entry]) => Array.isArray(entry))
        .map(([key, entry]) => [key, (entry as unknown[]).map(String).slice(0, 20)]),
    );
  } catch {
    return {};
  }
}

function addOnsOf(value: string | null | undefined): Array<{ id: string; name: string; priceKES: number }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 12).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const raw = entry as Record<string, unknown>;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const price = Number(raw.priceKES);
      if (!name || !Number.isFinite(price) || price < 0) return [];
      return [{ id: typeof raw.id === "string" ? raw.id : name, name, priceKES: Math.round(price) }];
    });
  } catch {
    return [];
  }
}

export async function loadStudioPreviewBase(businessId: string): Promise<StudioPreviewBase | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, slug: true, name: true, category: true, phone: true, whatsapp: true,
      location: true, lat: true, lng: true, description: true, logoUrl: true,
      isPublished: true, status: true,
    },
  });
  if (!business) return null;

  const [products, services] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, isActive: true },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 48,
      select: {
        id: true, name: true, description: true, category: true, basePriceKES: true,
        salePriceKES: true, salePriceStartsAt: true, salePriceEndsAt: true, imageUrl: true,
        images: true, brand: true, portionSize: true, ingredients: true, prepMinutes: true,
        tags: true, addOns: true, variantOptions: true, isFeatured: true, stockStatus: true,
      },
    }),
    prisma.service.findMany({
      where: { businessId, isActive: true },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 48,
      select: {
        id: true, title: true, description: true, priceFrom: true, priceLabel: true,
        pricingType: true, durationMinutes: true, depositKES: true, staffName: true,
        availability: true, bookingEnabled: true, imageUrl: true, category: true,
        isFeatured: true,
      },
    }),
  ]);

  const now = new Date();
  const items: StorefrontItem[] = products.map((product) => {
    const display = displayPriceKES(product, now);
    return {
      id: product.id,
      kind: "product",
      name: product.name,
      description: product.description,
      price: display.priceKES,
      wasPrice: display.wasPriceKES,
      priceLabel: null,
      pricingType: "FIXED",
      imageUrl: product.imageUrl,
      images: stringArray(product.images),
      category: product.category,
      tags: stringArray(product.tags),
      brand: product.brand,
      portionSize: product.portionSize,
      ingredients: product.ingredients,
      prepMinutes: product.prepMinutes,
      durationMinutes: null,
      depositKES: null,
      staffName: null,
      availability: null,
      bookingEnabled: false,
      stockStatus: product.stockStatus,
      isFeatured: product.isFeatured,
      variants: [],
      variantOptions: recordOf(product.variantOptions),
      addOns: addOnsOf(product.addOns),
    };
  });

  const serviceItems: StorefrontItem[] = services.map((service) => ({
    id: service.id,
    kind: "service",
    name: service.title,
    description: service.description,
    price: service.priceFrom,
    wasPrice: null,
    priceLabel: service.priceLabel,
    pricingType: service.pricingType === "QUOTE" ? "QUOTE" : "FIXED",
    imageUrl: service.imageUrl,
    images: [],
    category: service.category,
    tags: [],
    brand: null,
    portionSize: null,
    ingredients: null,
    prepMinutes: null,
    durationMinutes: service.durationMinutes,
    depositKES: service.depositKES,
    staffName: service.staffName,
    availability: service.availability,
    bookingEnabled: service.bookingEnabled,
    stockStatus: "IN_STOCK",
    isFeatured: service.isFeatured,
    variants: [],
    variantOptions: {},
    addOns: [],
  }));

  const categories = [...new Set([...items, ...serviceItems].map((item) => item.category).filter((value): value is string => Boolean(value)))].slice(0, 12);

  return {
    business: {
      id: business.id,
      slug: business.slug,
      name: business.name,
      category: business.category || "other",
      phone: business.phone,
      whatsapp: business.whatsapp,
      location: business.location,
      lat: business.lat,
      lng: business.lng,
      description: business.description,
      logoUrl: business.logoUrl,
      isPublished: business.isPublished,
      status: business.status,
    },
    items,
    services: serviceItems,
    offer: null,
    categories,
  };
}
