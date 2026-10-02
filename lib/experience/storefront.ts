/**
 * Storefront data loader (§37, §39, §60)
 *
 * One tenant-scoped read powers every public page. Data is loaded server-side, mapped to a
 * category-neutral view model, and handed to shared components — the pages stay small and
 * the customer never waits on client-side data fetching.
 */

import prisma from "../db";
import { getExperienceProfile } from "./categories";
import { normalizeExperienceDocument } from "./document";
import { resolveExperienceTheme, type ExperienceTheme } from "./themes";
import type { ExperienceDocument } from "./types";

export type StorefrontVariant = { id: string; label: string; priceKES: number | null; stockStatus: string; options: Record<string, string> };
export type StorefrontAddOn = { id: string; name: string; priceKES: number };

export type StorefrontItem = {
  id: string;
  kind: "product" | "service";
  name: string;
  description: string | null;
  price: number | null;
  wasPrice: number | null;
  priceLabel: string | null;
  pricingType: "FIXED" | "QUOTE";
  imageUrl: string | null;
  images: string[];
  category: string | null;
  tags: string[];
  brand: string | null;
  portionSize: string | null;
  ingredients: string | null;
  prepMinutes: number | null;
  durationMinutes: number | null;
  depositKES: number | null;
  staffName: string | null;
  availability: string | null;
  bookingEnabled: boolean;
  stockStatus: string;
  isFeatured: boolean;
  variants: StorefrontVariant[];
  variantOptions: Record<string, string[]>;
  addOns: StorefrontAddOn[];
};

export type StorefrontOffer = { title: string; subtitle: string | null; imageUrl: string | null; ctaLabel: string | null; badge: string | null } | null;

export type StorefrontData = {
  business: {
    id: string;
    slug: string;
    name: string;
    category: string;
    phone: string | null;
    whatsapp: string | null;
    location: string | null;
    lat: number | null;
    lng: number | null;
    description: string | null;
    logoUrl: string | null;
    isPublished: boolean;
    status: string;
  };
  document: ExperienceDocument;
  theme: ExperienceTheme;
  profile: ReturnType<typeof getExperienceProfile>;
  items: StorefrontItem[];
  services: StorefrontItem[];
  offer: StorefrontOffer;
  categories: string[];
  isPreview: boolean;
  publishedVersion: number;
};

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => (typeof entry === "string" ? entry : (entry as { url?: string })?.url || ""))
        .filter(Boolean)
        .slice(0, 12);
    }
  } catch {
    /* ignore malformed stored JSON */
  }
  return [];
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string | null | undefined): Record<string, string[]> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(raw)) result[key] = raw.map(String).slice(0, 20);
    }
    return result;
  } catch {
    return {};
  }
}

function parseAddOns(value: string | null | undefined): StorefrontAddOn[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 12).map((entry, index) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return {
        id: String(item.id || `addon-${index}`),
        name: String(item.name || "Add-on").slice(0, 60),
        priceKES: Math.max(0, Math.round(Number(item.priceKES || item.price || 0))),
      };
    });
  } catch {
    return [];
  }
}

function mapProduct(product: {
  id: string;
  name: string;
  description: string | null;
  basePriceKES: number | null;
  salePriceKES: number | null;
  imageUrl: string | null;
  images: string | null;
  category: string | null;
  tags: string | null;
  brand: string | null;
  portionSize: string | null;
  ingredients: string | null;
  prepMinutes: number | null;
  stockStatus: string;
  isFeatured: boolean;
  addOns: string | null;
  variantOptions: string | null;
  variants?: Array<{ id: string; label: string; priceKES: number | null; stockStatus: string; options: string | null }>;
}): StorefrontItem {
  const price = product.salePriceKES && product.salePriceKES > 0 ? product.salePriceKES : product.basePriceKES;
  return {
    id: product.id,
    kind: "product",
    name: product.name,
    description: product.description,
    price,
    wasPrice: product.salePriceKES && product.salePriceKES > 0 && product.basePriceKES ? product.basePriceKES : null,
    priceLabel: null,
    pricingType: "FIXED",
    imageUrl: product.imageUrl || parseJsonArray(product.images)[0] || null,
    images: [product.imageUrl, ...parseJsonArray(product.images)].filter(Boolean) as string[],
    category: product.category,
    tags: parseStringArray(product.tags),
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
    variants: (product.variants || []).map((variant) => ({
      id: variant.id,
      label: variant.label,
      priceKES: variant.priceKES,
      stockStatus: variant.stockStatus,
      options: variant.options ? (parseRecord(variant.options) as unknown as Record<string, string>) : {},
    })),
    variantOptions: parseRecord(product.variantOptions),
    addOns: parseAddOns(product.addOns),
  };
}

function mapService(service: {
  id: string;
  title: string;
  description: string | null;
  priceFrom: number | null;
  priceToKES: number | null;
  priceLabel: string | null;
  pricingType: string;
  durationMinutes: number | null;
  depositKES: number | null;
  staffName: string | null;
  availability: string | null;
  bookingEnabled: boolean;
  imageUrl: string | null;
  category: string | null;
  isFeatured: boolean;
}): StorefrontItem {
  return {
    id: service.id,
    kind: "service",
    name: service.title,
    description: service.description,
    price: service.pricingType === "QUOTE" ? null : service.priceFrom,
    wasPrice: null,
    priceLabel: service.pricingType === "QUOTE" ? "Request a quote" : service.priceLabel || null,
    pricingType: service.pricingType === "QUOTE" ? "QUOTE" : "FIXED",
    imageUrl: service.imageUrl,
    images: service.imageUrl ? [service.imageUrl] : [],
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
  };
}

export type LoadStorefrontOptions = {
  /** Owner/admin preview of unpublished changes (§16). Verified by the caller. */
  allowDraft?: boolean;
  /**
   * Show the draft even when a published version exists — the owner comparing
   * "what customers see" with "what I am about to publish" (§16). Only ever honoured
   * together with `allowDraft`.
   */
  preferDraft?: boolean;
};

/**
 * Load a published storefront. Returns null when the business is missing, unpublished, or
 * has no published experience — the caller renders not-found (§37).
 */
export async function loadStorefront(slug: string, options: LoadStorefrontOptions = {}): Promise<StorefrontData | null> {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, category: true, phone: true, whatsapp: true,
      location: true, lat: true, lng: true, description: true, logoUrl: true,
      isPublished: true, status: true,
    },
  });
  if (!business) return null;
  if (business.status === "SUSPENDED") return null;

  const experience = await prisma.businessExperience.findUnique({
    where: { businessId: business.id },
    select: { publishedJson: true, draftJson: true, categoryKey: true, themeKey: true, status: true, publishedVersion: true },
  });

  const published = experience?.publishedJson && experience.status === "PUBLISHED";
  const usingDraft = options.allowDraft === true && Boolean(experience?.draftJson);
  const preferDraft = options.preferDraft === true && usingDraft;
  const json = preferDraft
    ? experience!.draftJson
    : published
      ? experience!.publishedJson
      : usingDraft
        ? experience!.draftJson
        : null;
  if (!json) return null;

  const document = normalizeExperienceDocument(JSON.parse(json), experience!.categoryKey);
  // Contact details always come from the tenant's own stored business record (§45).
  document.settings.phone = document.settings.phone || business.phone || undefined;
  document.settings.whatsapp = document.settings.whatsapp || business.whatsapp || undefined;
  document.settings.location = document.settings.location || business.location || undefined;
  if (document.settings.lat === null && business.lat !== null) document.settings.lat = business.lat;
  if (document.settings.lng === null && business.lng !== null) document.settings.lng = business.lng;
  document.brand.businessName = document.brand.businessName || business.name;
  document.brand.logoUrl = document.brand.logoUrl || business.logoUrl || undefined;

  const [products, services, offer] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: business.id, isActive: true },
      include: { variants: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 120,
    }),
    prisma.service.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }],
      take: 120,
    }),
    prisma.offer.findUnique({ where: { businessId: business.id } }),
  ]);

  const items = products.map(mapProduct);
  const mappedServices = services.map(mapService);
  const categories = Array.from(
    new Set([...items, ...mappedServices].map((item) => item.category).filter((value): value is string => Boolean(value))),
  ).sort();

  return {
    business,
    document,
    theme: resolveExperienceTheme(document.themeKey),
    profile: getExperienceProfile(document.categoryKey),
    items,
    services: mappedServices,
    offer: offer && offer.isActive
      ? { title: offer.title, subtitle: offer.subtitle, imageUrl: offer.imageUrl, ctaLabel: offer.ctaLabel, badge: offer.badge }
      : null,
    categories,
    isPreview: preferDraft || (usingDraft && !published),
    publishedVersion: experience?.publishedVersion ?? 0,
  };
}

export function findItem(data: StorefrontData, id: string): StorefrontItem | null {
  return [...data.items, ...data.services].find((item) => item.id === id) || null;
}
