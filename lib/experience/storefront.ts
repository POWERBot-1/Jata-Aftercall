/**
 * Storefront data loader (§37, §39, §60)
 *
 * One tenant-scoped read powers every public page. Data is loaded server-side, mapped to a
 * category-neutral view model, and handed to shared components — the pages stay small and
 * the customer never waits on client-side data fetching.
 */

import prisma from "../db";
import { requestCache } from "../request-cache";
import { getExperienceProfile } from "./categories";
import { normalizeExperienceDocument, themeOf } from "./document";
import { resolveExperienceTheme, type ExperienceTheme } from "./themes";
import type { ExperienceDocument } from "./types";
import { displayPriceKES } from "../sale-pricing";
import { describeSitePublication, resolvePublicDocument } from "./publication-state";

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
  salePriceStartsAt?: Date | string | null;
  salePriceEndsAt?: Date | string | null;
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
  // Shown exactly as checkout charges it: the sale only inside its window (lib/sale-pricing.ts).
  const shown = displayPriceKES(product);
  const price = shown.priceKES;
  return {
    id: product.id,
    kind: "product",
    name: product.name,
    description: product.description,
    price,
    wasPrice: shown.wasPriceKES,
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
  /** Explicit per-business secondary-site slug; omitted resolves the default site. */
  websiteSlug?: string;
};

/**
 * Load a published storefront. Returns null when the business is missing, unpublished, or
 * has no published experience — the caller renders not-found (§37).
 *
 * Request-deduplicated (M11 #418): `generateMetadata` and the page body call this
 * through one shared per-request cache entry (primitive cache key), so each request
 * performs a single load and the SSR root segment completes with the metadata —
 * keeping the hydration bootstrap scripts behind the content in the emitted HTML.
 */
async function loadStorefrontImpl(slug: string, allowDraft: boolean, preferDraft: boolean, websiteSlug: string | null): Promise<StorefrontData | null> {
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
  // The tenant kill switch is applied inside the state machine (tenantVisible), not
  // here: a hidden tenant returns nothing to a visitor but still resolves its own
  // site for the owner's authorised preview.

  // The default Studio website is now the preferred publication source. The old
  // BusinessExperience remains a compatibility fallback for businesses that have not
  // completed the per-site cutover; secondary sites are resolved by their own route.
  const [studioWebsite, experience] = await Promise.all([
    prisma.studioWebsite.findFirst({
      where: websiteSlug
        ? { businessId: business.id, slug: websiteSlug, isDefault: false }
        : { businessId: business.id, isDefault: true },
      select: {
        id: true,
        status: true,
        content: { select: { draftJson: true, publishedJson: true, draftVersion: true, publishedVersion: true } },
      },
    }),
    prisma.businessExperience.findUnique({
      where: { businessId: business.id },
      select: { publishedJson: true, draftJson: true, draftVersion: true, categoryKey: true, themeKey: true, status: true, publishedVersion: true },
    }),
  ]);

  // Publication is decided by exactly one place: lib/experience/publication-state.ts.
  // The site row is loaded WITHOUT a status filter so the state machine can tell
  // "never published" (DRAFT, legacy fallback allowed) apart from "explicitly taken
  // down" (UNPUBLISHED/SUSPENDED, no fallback) and "published" (its own snapshot).
  const isDefaultRoute = websiteSlug === null;
  const decision = resolvePublicDocument({
    site: studioWebsite,
    isDefaultRoute,
    legacy: experience,
    allowDraft,
    preferDraft,
    tenantVisible: business.isPublished && business.status !== "SUSPENDED",
  });
  // The resolver is the single place the legacy draft can be selected for an authorised
  // preview, and it tags that selection "draft" so the preview banner, the preview notice
  // and the noindex rule apply to it exactly as they do to a site's own draft. Keeping a
  // second fallback path here is what previously let legacy draft content render as live.
  const json = decision.json;
  const usingDraft = decision.source === "draft";
  const usePreferredDraft = usingDraft && preferDraft;
  if (!json) return null;

  let document: ExperienceDocument;
  try {
    document = normalizeExperienceDocument(JSON.parse(json), experience?.categoryKey);
  } catch {
    // An unreadable/newer format is not rendered as an older schema. The /b route retains
    // its classic HTML business-page fallback; no published/draft data is modified here.
    return null;
  }
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
  const currentOffer = offer && offer.isActive && (!offer.validUntil || offer.validUntil >= new Date()) ? offer : null;
  const categories = Array.from(
    new Set([...items, ...mappedServices].map((item) => item.category).filter((value): value is string => Boolean(value))),
  ).sort();

  return {
    business,
    document,
    theme: themeOf(document),
    profile: getExperienceProfile(document.categoryKey),
    items,
    services: mappedServices,
    offer: currentOffer
      ? { title: currentOffer.title, subtitle: currentOffer.subtitle, imageUrl: currentOffer.imageUrl, ctaLabel: currentOffer.ctaLabel, badge: currentOffer.badge }
      : null,
    categories,
    // Preview is exactly "the visitor is looking at something not publicly live".
    isPreview: usingDraft,
    // The version of what is actually being rendered: the site's own publication when
    // the site published, otherwise the legacy row that stood in for it.
    publishedVersion: decision.source === "published"
      ? describeSitePublication(studioWebsite, { isDefaultRoute }).publishedVersion
      : decision.source === "legacy"
        ? Number(experience?.publishedVersion ?? 0)
        : 0,
  };
}

const loadStorefrontCached = requestCache(loadStorefrontImpl);

export function loadStorefront(slug: string, options: LoadStorefrontOptions = {}): Promise<StorefrontData | null> {
  return loadStorefrontCached(slug, options.allowDraft === true, options.preferDraft === true, options.websiteSlug ?? null);
}

export function findItem(data: StorefrontData, id: string): StorefrontItem | null {
  return [...data.items, ...data.services].find((item) => item.id === id) || null;
}
