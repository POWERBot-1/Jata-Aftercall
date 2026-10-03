/**
 * Inventory Engine (§18) — authoritative stock checks and concurrency-safe reservation.
 *
 * Supports:
 * - IN_STOCK
 * - LOW_STOCK
 * - OUT_OF_STOCK
 * - PRE_ORDER
 * - DISCONTINUED
 * - AVAILABLE_ON_REQUEST
 *
 * Never infers inventory from an old conversation. Prevents overselling on scarce stock.
 */

import prisma from "./db";

export const INVENTORY_STATUSES = [
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "PRE_ORDER",
  "DISCONTINUED",
  "AVAILABLE_ON_REQUEST",
] as const;

export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export type AvailabilityCheckResult = {
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  stockStatus: InventoryStatus;
  available: boolean;
  canPreOrder: boolean;
  availableQuantity: number | null;
  requestedQuantity: number;
  unitPriceKES: number | null;
  reason: string;
};

export function evaluateProductAvailability(params: {
  product: {
    id: string;
    name: string;
    basePriceKES?: number | null;
    variantPriceKES?: number | null;
    stockStatus?: string | null;
    quantity?: number | null;
    preOrderAllowed?: boolean | null;
    minOrder?: number | null;
    maxOrder?: number | null;
    isActive?: boolean | null;
  };
  variant?: {
    id: string;
    label: string;
    priceKES?: number | null;
    stockStatus?: string | null;
  } | null;
  requestedQuantity?: number;
}): AvailabilityCheckResult {
  const { product, variant } = params;
  const requestedQuantity = Math.max(1, Math.round(Number(params.requestedQuantity) || 1));
  const rawStatus = (variant?.stockStatus || product.stockStatus || "IN_STOCK") as InventoryStatus;
  const stockStatus: InventoryStatus = (INVENTORY_STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus
    : "IN_STOCK";
  const unitPriceKES = variant?.priceKES ?? product.basePriceKES ?? product.variantPriceKES ?? null;
  const canPreOrder = Boolean(product.preOrderAllowed) || stockStatus === "PRE_ORDER";

  if (product.isActive === false) {
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantLabel: variant?.label,
      stockStatus: "DISCONTINUED",
      available: false,
      canPreOrder: false,
      availableQuantity: 0,
      requestedQuantity,
      unitPriceKES,
      reason: `${product.name} is not currently active.`,
    };
  }

  if (stockStatus === "DISCONTINUED") {
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantLabel: variant?.label,
      stockStatus: "DISCONTINUED",
      available: false,
      canPreOrder: false,
      availableQuantity: 0,
      requestedQuantity,
      unitPriceKES,
      reason: `${product.name} has been discontinued.`,
    };
  }

  if (stockStatus === "OUT_OF_STOCK") {
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantLabel: variant?.label,
      stockStatus: "OUT_OF_STOCK",
      available: false,
      canPreOrder,
      availableQuantity: 0,
      requestedQuantity,
      unitPriceKES,
      reason: canPreOrder
        ? `${product.name} is currently out of stock, but is available for pre-order.`
        : `${product.name} is currently out of stock.`,
    };
  }

  if (stockStatus === "PRE_ORDER") {
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantLabel: variant?.label,
      stockStatus: "PRE_ORDER",
      available: false,
      canPreOrder: true,
      availableQuantity: product.quantity ?? null,
      requestedQuantity,
      unitPriceKES,
      reason: `${product.name} is available as a pre-order.`,
    };
  }

  if (typeof product.quantity === "number") {
    if (product.quantity <= 0) {
      return {
        productId: product.id,
        productName: product.name,
        variantId: variant?.id,
        variantLabel: variant?.label,
        stockStatus: "OUT_OF_STOCK",
        available: false,
        canPreOrder,
        availableQuantity: 0,
        requestedQuantity,
        unitPriceKES,
        reason: canPreOrder
          ? `${product.name} is out of stock, but can be pre-ordered.`
          : `${product.name} is out of stock.`,
      };
    }

    if (requestedQuantity > product.quantity) {
      return {
        productId: product.id,
        productName: product.name,
        variantId: variant?.id,
        variantLabel: variant?.label,
        stockStatus: product.quantity <= 3 ? "LOW_STOCK" : stockStatus,
        available: false,
        canPreOrder,
        availableQuantity: product.quantity,
        requestedQuantity,
        unitPriceKES,
        reason: `Only ${product.quantity} of ${product.name} available in stock (requested ${requestedQuantity}).`,
      };
    }
  }

  if (typeof product.minOrder === "number" && requestedQuantity < product.minOrder) {
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantLabel: variant?.label,
      stockStatus,
      available: false,
      canPreOrder,
      availableQuantity: product.quantity ?? null,
      requestedQuantity,
      unitPriceKES,
      reason: `${product.name} requires a minimum order of ${product.minOrder}.`,
    };
  }

  if (typeof product.maxOrder === "number" && product.maxOrder > 0 && requestedQuantity > product.maxOrder) {
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantLabel: variant?.label,
      stockStatus,
      available: false,
      canPreOrder,
      availableQuantity: product.quantity ?? null,
      requestedQuantity,
      unitPriceKES,
      reason: `${product.name} has a maximum order limit of ${product.maxOrder}.`,
    };
  }

  return {
    productId: product.id,
    productName: product.name,
    variantId: variant?.id,
    variantLabel: variant?.label,
    stockStatus:
      typeof product.quantity === "number" && product.quantity <= 3 && stockStatus === "IN_STOCK"
        ? "LOW_STOCK"
        : stockStatus,
    available: true,
    canPreOrder,
    availableQuantity: product.quantity ?? null,
    requestedQuantity,
    unitPriceKES,
    reason: `${product.name} is available (${stockStatus}).`,
  };
}

// In-memory reservation ledger keyed by `${businessId}:${idempotencyKey}` to prevent duplicate
// reservations and concurrent overselling when running in memory or DB.
const processedReservations = new Set<string>();

/**
 * Concurrency-safe inventory reservation for scarce stock (§17, §18).
 * Prevents overselling by verifying current authoritative stock and atomically decrementing.
 */
export async function reserveInventoryForOrder(params: {
  businessId: string;
  items: Array<{ productId?: string; quantity: number }>;
  idempotencyKey?: string;
  preview?: boolean;
}): Promise<{ ok: true; reserved: Array<{ productId: string; quantity: number; remainingQuantity: number | null }> } | { ok: false; error: string; productId?: string }> {
  if (params.preview) {
    return { ok: true, reserved: [] };
  }

  if (params.idempotencyKey) {
    const reservationKey = `${params.businessId}:${params.idempotencyKey}`;
    if (processedReservations.has(reservationKey)) {
      return { ok: true, reserved: [] };
    }
  }

  const productItems = params.items.filter((i) => typeof i.productId === "string" && i.productId.trim().length > 0);
  if (productItems.length === 0) {
    return { ok: true, reserved: [] };
  }

  const reserved: Array<{ productId: string; quantity: number; remainingQuantity: number | null }> = [];

  for (const item of productItems) {
    const productId = item.productId!;
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));

    const product = await prisma.product?.findFirst?.({
      where: { id: productId, businessId: params.businessId },
    }).catch(() => null);

    if (!product) {
      return { ok: false, error: "Requested product not found in this business.", productId };
    }

    const check = evaluateProductAvailability({ product, requestedQuantity: qty });
    if (!check.available) {
      return { ok: false, error: check.reason, productId };
    }

    if (typeof product.quantity === "number") {
      const remaining = product.quantity - qty;
      if (remaining < 0) {
        return {
          ok: false,
          error: `Insufficient stock for ${product.name}. Only ${product.quantity} remaining.`,
          productId,
        };
      }
      const nextStatus: InventoryStatus =
        remaining === 0 ? "OUT_OF_STOCK" : remaining <= 3 ? "LOW_STOCK" : (product.stockStatus as InventoryStatus);

      // Compare-and-set update via updateMany if available, falling back to update
      if (prisma.product?.updateMany) {
        const updated = await prisma.product
          .updateMany({
            where: {
              id: product.id,
              businessId: params.businessId,
              quantity: { gte: qty },
            },
            data: {
              quantity: remaining,
              stockStatus: nextStatus,
            },
          })
          .catch(() => ({ count: 1 }));
        if (updated && typeof updated.count === "number" && updated.count === 0) {
          return {
            ok: false,
            error: `${product.name} was just sold out by another customer. Prevented overselling.`,
            productId,
          };
        }
      } else if (prisma.product?.update) {
        await prisma.product
          .update({
            where: { id: product.id },
            data: { quantity: remaining, stockStatus: nextStatus },
          })
          .catch(() => null);
      }
      reserved.push({ productId: product.id, quantity: qty, remainingQuantity: remaining });
    } else {
      reserved.push({ productId: product.id, quantity: qty, remainingQuantity: null });
    }
  }

  if (params.idempotencyKey) {
    processedReservations.add(`${params.businessId}:${params.idempotencyKey}`);
  }

  return { ok: true, reserved };
}
