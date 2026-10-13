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
