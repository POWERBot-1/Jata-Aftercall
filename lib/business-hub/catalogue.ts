/**
 * Public catalogue loader for the Business Page (used by Instant Order Requests).
 *
 * One place decides which products a customer may request and what they cost. It reuses the
 * platform's own pricing rule (`lib/sale-pricing` via `withPublicPricing`) so a promotion, a
 * sale window and an order request can never disagree about a price.
 */

import prisma from "../db";
import { withPublicPricing } from "../ai-public-products";

export type CatalogueKind = "PRODUCT" | "SERVICE";

export type PublicCatalogueItem = {
  id: string;
  /** PRODUCT rows come from the catalogue; SERVICE rows are the page's own services list. */
  kind: CatalogueKind;
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

const SERVICE_SELECT = {
  id: true,
  title: true,
  description: true,
  imageUrl: true,
  category: true,
  priceFrom: true,
  priceToKES: true,
  priceLabel: true,
  pricingType: true,
  isFeatured: true,
  sortOrder: true,
};

/**
 * "KES 650" / "From KES 1,500" → 650 / 1500. Services store their price in `priceFrom` and,
 * for older rows, only in the free-text `priceLabel`. Parsing is best-effort and server-side
 * only: a label that does not read as an amount leaves the line as "price on request" rather
 * than inventing a number.
 */
export function priceLabelToKES(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const match = label.replace(/,/g, "").match(/KES\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const value = Math.round(Number(match[1]));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The services a business lists on its page, as requestable catalogue lines.
 *
 * This is what the page actually shows under "Services and products", and it is the catalogue
 * most Business Page owners have — the product catalogue belongs to the Interactive Business
 * experience. Leaving services out meant those owners (and every demo page) had no order
 * requests at all, which is the gap this closes.
 *
 * A `QUOTE` service carries no price: the customer is asking for one.
 */
export async function loadPublicServices(
  businessId: string,
  options: { take?: number } = {},
): Promise<PublicCatalogueItem[]> {
  const rows = await prisma.service
    .findMany({
      where: { businessId, isActive: true },
      select: SERVICE_SELECT,
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      take: Math.min(120, Math.max(1, options.take ?? 48)),
    })
    .catch(() => []);

  return rows.map((row: any) => {
    const quoteOnly = String(row.pricingType ?? "FIXED").toUpperCase() === "QUOTE";
    const priceKES = quoteOnly
      ? null
      : (typeof row.priceFrom === "number" ? row.priceFrom : null) ?? priceLabelToKES(row.priceLabel);
    return {
      id: row.id,
      kind: "SERVICE" as const,
      name: row.title,
      description: row.description ?? null,
      imageUrl: row.imageUrl ?? null,
      priceKES,
      wasPriceKES: null,
      category: row.category ?? null,
      stockStatus: quoteOnly ? "AVAILABLE_ON_REQUEST" : "IN_STOCK",
      isFeatured: Boolean(row.isFeatured),
      sortOrder: Number(row.sortOrder ?? 0),
    };
  });
}

/**
 * Everything a customer may put in an order request: the product catalogue first, then the
 * page's services, featured rows ahead of the rest.
 */
export async function loadRequestableCatalogue(
  businessId: string,
  options: { take?: number } = {},
): Promise<PublicCatalogueItem[]> {
  const [products, services] = await Promise.all([
    loadPublicCatalogue(businessId, options),
    loadPublicServices(businessId, options),
  ]);
  const rank = (item: PublicCatalogueItem) => (item.kind === "PRODUCT" ? 0 : 1);
  return [...products, ...services].sort(
    (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || rank(a) - rank(b) || a.sortOrder - b.sortOrder,
  );
}

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
      kind: "PRODUCT" as const,
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

/**
 * Server-side price source for order-request validation (never trusts a client price).
 *
 * Products keep the fields `effectiveUnitPrice` needs (sale windows included); services arrive
 * pre-priced by the same rule `loadPublicServices` shows on the page, so what the page quoted
 * and what the request is written at cannot disagree.
 */
export async function loadCatalogueForPricing(businessId: string): Promise<any[]> {
  const [products, services] = await Promise.all([
    prisma.product.findMany({ where: { businessId, isActive: true }, select: CATALOGUE_SELECT }).catch(() => []),
    prisma.service.findMany({ where: { businessId, isActive: true }, select: SERVICE_SELECT }).catch(() => []),
  ]);

  return [
    ...(products as any[]).map((row) => ({ ...row, kind: "PRODUCT" as const, isActive: true })),
    ...(services as any[]).map((row) => {
      const quoteOnly = String(row.pricingType ?? "FIXED").toUpperCase() === "QUOTE";
      return {
        id: row.id,
        kind: "SERVICE" as const,
        name: row.title,
        description: row.description ?? null,
        imageUrl: row.imageUrl ?? null,
        isActive: true,
        stockStatus: quoteOnly ? "AVAILABLE_ON_REQUEST" : "IN_STOCK",
        unitPriceKES: quoteOnly
          ? null
          : (typeof row.priceFrom === "number" ? row.priceFrom : null) ?? priceLabelToKES(row.priceLabel),
      };
    }),
  ];
}
