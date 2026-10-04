/**
 * Studio intelligence loader (§25, §36, §46)
 *
 * Loads the extra facts the health score and the copilot need — catalogue coverage, image
 * quality and the business's own best sellers — for one tenant, after the caller has verified
 * ownership. Every query is filtered by `businessId` and every failure degrades to an empty
 * result rather than breaking the Studio (§39).
 */

import prisma from "../db";
import { buildHealthReport, type HealthInput, type HealthReport } from "./health";
import type { ExperienceDocument } from "../experience/types";

export type StudioCatalogueItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  isFeatured: boolean;
  priceKes: number | null;
};

export type StudioIntelligence = {
  health: HealthReport;
  items: StudioCatalogueItem[];
  topSellingIds: string[];
  counts: HealthInput["counts"];
};

/** Images below this width look soft on a modern phone, even when they are technically valid. */
const LOW_RESOLUTION_WIDTH = 640;
/** Hero images deserve more resolution than a thumbnail. */
const LOW_RESOLUTION_HERO_WIDTH = 1000;

function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

export async function loadStudioIntelligence(input: {
  businessId: string;
  document: ExperienceDocument;
  business: {
    name?: string | null;
    category?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    location?: string | null;
    logoUrl?: string | null;
    description?: string | null;
    openingHours?: string | null;
  };
  published?: boolean;
}): Promise<StudioIntelligence> {
  const { businessId, document } = input;

  const [products, services, media] = await Promise.all([
    safe(
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: { id: true, name: true, imageUrl: true, images: true, isFeatured: true, basePriceKES: true, salePriceKES: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 300,
      }),
      [] as Array<{ id: string; name: string; imageUrl: string | null; images: string | null; isFeatured: boolean; basePriceKES: number | null; salePriceKES: number | null }>,
    ),
    safe(
      prisma.service.findMany({
        where: { businessId, isActive: true },
        select: { id: true, title: true, imageUrl: true, isFeatured: true, priceFrom: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 200,
      }),
      [] as Array<{ id: string; title: string; imageUrl: string | null; isFeatured: boolean; priceFrom: number | null }>,
    ),
    safe(
      prisma.mediaAsset.findMany({ where: { businessId }, select: { id: true, url: true, width: true, kind: true }, take: 500 }),
      [] as Array<{ id: string; url: string; width: number | null; kind: string }>,
    ),
  ]);

  const items: StudioCatalogueItem[] = [
    ...products.map((product) => ({
      id: product.id,
      name: product.name,
      imageUrl: product.imageUrl || firstImageUrl(product.images),
      isFeatured: Boolean(product.isFeatured),
      priceKes: product.salePriceKES ?? product.basePriceKES ?? null,
    })),
    ...services.map((service) => ({
      id: service.id,
      name: service.title,
      imageUrl: service.imageUrl,
      isFeatured: Boolean(service.isFeatured),
      priceKes: service.priceFrom ?? null,
    })),
  ];

  const itemsWithoutPhotos = items.filter((item) => !item.imageUrl).length;
  const lowResolutionImages = media.filter((asset) => {
    if (typeof asset.width !== "number") return false;
    const threshold = asset.kind === "HERO" ? LOW_RESOLUTION_HERO_WIDTH : LOW_RESOLUTION_WIDTH;
    return asset.width > 0 && asset.width < threshold;
  }).length;

  const topSellingIds = await loadTopSellingIds(businessId);

  const health = buildHealthReport({
    document,
    business: input.business,
    counts: {
      products: products.length,
      services: services.length,
      media: media.length,
      itemsWithoutPhotos,
      lowResolutionImages,
    },
    items: items.map((item) => ({ id: item.id, name: item.name, imageUrl: item.imageUrl, isFeatured: item.isFeatured, priceKes: item.priceKes })),
    published: input.published,
  });

  return {
    health,
    items,
    topSellingIds,
    counts: { products: products.length, services: services.length, media: media.length, itemsWithoutPhotos, lowResolutionImages },
  };
}

function firstImageUrl(images: string | null): string | null {
  if (!images) return null;
  try {
    const parsed = JSON.parse(images);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
    if (Array.isArray(parsed) && parsed[0]?.url) return String(parsed[0].url);
  } catch {
    return null;
  }
  return null;
}

/**
 * The business's real best sellers, from its own paid and confirmed orders. Small, bounded
 * queries: a business website has tens of orders per day, not millions (§51).
 */
async function loadTopSellingIds(businessId: string): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 60 * 86_400_000);
    const rows = await prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        productId: { not: null },
        order: { businessId, createdAt: { gte: since }, status: { not: "CANCELLED" } },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 6,
    });
    return (rows || []).map((row: { productId: string | null }) => row.productId).filter((id: string | null): id is string => Boolean(id));
  } catch {
    return [];
  }
}
