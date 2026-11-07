/**
 * Public catalogue loader for the Business Page (used by Instant Order Requests).
 *
 * One place decides which products a customer may request and what they cost. It reuses the
 * platform's own pricing rule (`lib/sale-pricing` via `withPublicPricing`) so a promotion, a
 * sale window and an order request can never disagree about a price.
 */

import prisma from "../db";
import { withPublicPricing } from "../ai-public-products";

export type PublicCatalogueItem = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceKES: number | null;
  wasPriceKES: number | null;
  category: string | null;
  stockStatus: string;
  isFeatured: boolean;
  sortOrder: number;
};

const CATALOGUE_SELECT = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  category: true,
  stockStatus: true,
  isFeatured: true,
  sortOrder: true,
  basePriceKES: true,
  variantPriceKES: true,
  salePriceKES: true,
  salePriceStartsAt: true,
  salePriceEndsAt: true,
};

/**
 * Products a customer can add to an order request: active rows only, featured first.
 *
 * `OUT_OF_STOCK` / `DISCONTINUED` rows are still listed (a customer may legitimately ask to be
 * told when something is back) but are flagged, and `AVAILABLE_ON_REQUEST` reads as requestable.
 */
export async function loadPublicCatalogue(businessId: string, options: { take?: number } = {}): Promise<PublicCatalogueItem[]> {
  const rows = await prisma.product
    .findMany({
      where: { businessId, isActive: true },
      select: CATALOGUE_SELECT,
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      take: Math.min(120, Math.max(1, options.take ?? 48)),
    })
    .catch(() => []);

  return rows.map((row: any) => {
    const priced = withPublicPricing(row);
    return {
      id: priced.id,
      name: priced.name,
      description: priced.description ?? null,
      imageUrl: priced.imageUrl ?? null,
      priceKES: priced.priceKES,
      wasPriceKES: priced.wasPriceKES,
      category: priced.category ?? null,
      stockStatus: priced.stockStatus ?? "IN_STOCK",
      isFeatured: Boolean(priced.isFeatured),
      sortOrder: Number(priced.sortOrder ?? 0),
    };
  });
}

/** Server-side price source for order-request validation (never trusts a client price). */
export async function loadCatalogueForPricing(businessId: string): Promise<any[]> {
  return prisma.product
    .findMany({ where: { businessId, isActive: true }, select: CATALOGUE_SELECT })
    .catch(() => []);
}
