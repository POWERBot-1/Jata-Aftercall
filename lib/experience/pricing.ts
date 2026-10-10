/**
 * Server-authoritative pricing (§26, §24, §25)
 *
 * The browser may display prices, but it never decides them. This module loads the
 * authoritative catalogue rows *inside the tenant*, derives every line total, applies the
 * tenant's own delivery fee, and returns the only amount that may be charged (§26).
 *
 * Reuses the existing commerce engine (lib/commerce-pricing.ts) rather than a second one.
 */

import prisma from "../db";
import { calculateCommerceTotal, type CommerceCalculation } from "../commerce-pricing";
import type { ExperienceSettings } from "./types";
import { chargeableUnitPrice, effectiveUnitPrice, listPriceKES, type QuantityRule } from "../sale-pricing";
import { getExtendedAIConfig } from "../ai-config";

export const PAYMENT_CURRENCY = "KES";

/** Explicit shapes so the pricing engine compiles even before `prisma generate` has run. */
type ProductRow = {
  id: string;
  name: string;
  basePriceKES: number | null;
  variantPriceKES: number | null;
  salePriceKES: number | null;
  salePriceStartsAt: Date | null;
  salePriceEndsAt: Date | null;
  imageUrl: string | null;
  minOrder: number | null;
  maxOrder: number | null;
  stockStatus: string;
  preOrderAllowed: boolean;
  deliveryEligible: boolean;
  addOns: string | null;
  isActive: boolean;
};
type VariantRow = {
  id: string;
  productId: string;
  label: string;
  priceKES: number | null;
  stockStatus: string | null;
  options: unknown;
};

export type RequestedItem = {
  productId?: string;
  variantId?: string;
  quantity?: number;
  addOnIds?: string[];
  notes?: string;
};

export type PricedLine = {
  productId: string;
  variantId?: string | null;
  name: string;
  variantDesc?: string;
  quantity: number;
  unitPriceKES: number;
  addOns: Array<{ id: string; name: string; priceKES: number }>;
  lineSubtotalKES: number;
  imageUrl?: string | null;
  notes?: string;
};

export type OrderPricing = CommerceCalculation & {
  unavailable: Array<{ productId: string; reason: string }>;
  minOrderKES: number;
  fulfilment: "PICKUP" | "DELIVERY";
};

type AddOn = { id: string; name: string; priceKES: number };

function parseAddOns(raw: string | null | undefined): AddOn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry, index) => ({
        id: typeof entry.id === "string" && entry.id ? entry.id : `addon-${index}`,
        name: String(entry.name || "Add-on").slice(0, 60),
        priceKES: Math.max(0, Math.round(Number(entry.priceKES || entry.price || 0))),
      }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * The price one unit costs right now: the variant price, else the sale price inside its window, else the base
 * price. Delegates to lib/sale-pricing.ts (the single rule shared by every channel).
 */
export function unitPriceFor(
  product: { basePriceKES?: number | null; variantPriceKES?: number | null; salePriceKES?: number | null; salePriceStartsAt?: Date | string | null; salePriceEndsAt?: Date | string | null },
  variant?: { priceKES?: number | null } | null,
  now: Date = new Date(),
): number {
  return effectiveUnitPrice(product, now, variant).unitPriceKES;
}

const PURCHASABLE = new Set(["IN_STOCK", "LOW_STOCK", "PRE_ORDER", "AVAILABLE_ON_REQUEST"]);

/**
 * Price a customer basket.
 *
 * Every lookup is scoped by businessId — a product belonging to another tenant can never be
 * priced into this order, no matter what the client sends (§37).
 */
export async function priceBasket(params: {
  businessId: string;
  items: RequestedItem[];
  fulfilment?: "PICKUP" | "DELIVERY";
  settings?: ExperienceSettings | null;
  allowPreOrder?: boolean;
  /** The instant the prices are taken at. Defaults to now. One instant is used for the whole basket. */
  now?: Date;
}): Promise<OrderPricing> {
  const { businessId, settings } = params;
  const now = params.now ?? new Date();
  // The owner's quantity rules (applied after the sale window, never stacked). Loaded inside the tenant.
  const bulkRules: QuantityRule[] = await getExtendedAIConfig(businessId)
    .then((config) => config.bulkPricing)
    .catch(() => []);
  const requests = Array.isArray(params.items) ? params.items.slice(0, 60) : [];
  const unavailable: Array<{ productId: string; reason: string }> = [];

  const productIds = Array.from(
    new Set(requests.map((item) => (typeof item?.productId === "string" ? item.productId : "")).filter(Boolean)),
  );
  if (productIds.length === 0) {
    return {
      ...calculateCommerceTotal({ lineItems: [], currency: PAYMENT_CURRENCY }),
      unavailable,
      minOrderKES: settings?.minOrderKES ?? 0,
      fulfilment: params.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP",
    };
  }

  const products = (await prisma.product.findMany({
    where: { businessId, id: { in: productIds } },
    select: {
      id: true, name: true, basePriceKES: true, variantPriceKES: true, salePriceKES: true, salePriceStartsAt: true, salePriceEndsAt: true, imageUrl: true,
      minOrder: true, maxOrder: true, stockStatus: true, preOrderAllowed: true,
      deliveryEligible: true, addOns: true, isActive: true,
    },
  })) as ProductRow[];
  const productById = new Map(products.map((product) => [product.id, product]));

  const variantIds = Array.from(
    new Set(requests.map((item) => (typeof item?.variantId === "string" ? item.variantId : "")).filter(Boolean)),
  );
  const variants = (variantIds.length
    ? await prisma.productVariant.findMany({
        where: { businessId, id: { in: variantIds } },
        select: { id: true, productId: true, label: true, priceKES: true, stockStatus: true, options: true },
      })
    : []) as VariantRow[];
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const lineInputs: Array<{ productId: string; name: string; quantity: number; unitPriceKES: number; variantDesc?: string }> = [];
  const pricedLines: PricedLine[] = [];

  for (const request of requests) {
    const product = productById.get(String(request.productId));
    if (!product) {
      unavailable.push({ productId: String(request.productId), reason: "This item is no longer available." });
      continue;
    }
    if (!product.isActive) {
      unavailable.push({ productId: product.id, reason: `${product.name} is not currently listed.` });
      continue;
    }
    const variant = request.variantId ? variantById.get(String(request.variantId)) || null : null;
    if (variant && variant.productId !== product.id) {
      unavailable.push({ productId: product.id, reason: `${product.name}: that option is not available.` });
      continue;
    }
    const stockStatus = variant?.stockStatus || product.stockStatus;
    if (!PURCHASABLE.has(String(stockStatus))) {
      const canPreOrder = params.allowPreOrder === true && product.preOrderAllowed && stockStatus === "PRE_ORDER";
      if (!canPreOrder) {
        unavailable.push({ productId: product.id, reason: `${product.name} is out of stock.` });
        continue;
      }
    }

    const requestedQuantity = Math.round(Number(request.quantity ?? 1));
    const minOrder = Math.max(1, Number(product.minOrder || 1));
    const maxOrder = product.maxOrder && product.maxOrder > 0 ? product.maxOrder : 99;
    const quantity = Math.max(minOrder, Math.min(maxOrder, Number.isFinite(requestedQuantity) ? requestedQuantity : 1));
    if (quantity < minOrder) {
      unavailable.push({ productId: product.id, reason: `${product.name} has a minimum order of ${minOrder}.` });
      continue;
    }

    const addOnCatalogue = parseAddOns(product.addOns);
    const requestedAddOnIds: string[] = [];
    if (Array.isArray(request.addOnIds)) {
      for (const entry of request.addOnIds as unknown[]) {
        if (typeof entry === "string" && entry) requestedAddOnIds.push(entry);
      }
    }
    const addOns = requestedAddOnIds
      .map((id) => addOnCatalogue.find((addOn) => addOn.id === id))
      .filter((addOn): addOn is AddOn => Boolean(addOn))
      .slice(0, 10);

    // Sale window (lib/sale-pricing.ts) first, then the owner's quantity rule. Never stacked.
    const unitBase = chargeableUnitPrice({ product, productName: product.name, quantity, now, rules: bulkRules, variant }).unitPriceKES;
    if (!(unitBase > 0)) {
      unavailable.push({ productId: product.id, reason: `${product.name} has no price set.` });
      continue;
    }
    const unitPriceKES = unitBase + addOns.reduce((sum, addOn) => sum + addOn.priceKES, 0);
    const variantDesc = [variant?.label, addOns.length ? `+ ${addOns.map((addOn) => addOn.name).join(", ")}` : ""]
      .filter(Boolean)
      .join(" · ");

    lineInputs.push({
      productId: product.id,
      name: product.name,
      quantity,
      unitPriceKES,
      variantDesc: variantDesc || undefined,
    });
    pricedLines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      variantDesc: variantDesc || undefined,
      quantity,
      unitPriceKES,
      addOns,
      lineSubtotalKES: unitPriceKES * quantity,
      imageUrl: product.imageUrl ?? null,
      notes: typeof request.notes === "string" ? request.notes.slice(0, 300) : undefined,
    });
  }

  const fulfilment = params.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP";
  const deliveryFeeKES =
    fulfilment === "DELIVERY" && settings?.deliveryEnabled !== false ? Math.max(0, Math.round(Number(settings?.deliveryFeeKES || 0))) : 0;

  const calculation = calculateCommerceTotal({ lineItems: lineInputs, deliveryFeeKES, currency: PAYMENT_CURRENCY });

  return {
    ...calculation,
    lineItems: calculation.lineItems.map((line, index) => ({ ...line, ...pricedLines[index] })),
    unavailable,
    minOrderKES: Math.max(0, Math.round(Number(settings?.minOrderKES || 0))),
    fulfilment,
  };
}
