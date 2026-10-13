/**
 * Pre-Order Service (§19) — support for unavailable products with clear customer labeling.
 *
 * Price integrity: a pre-order's unit price is resolved from the business catalogue with the same unit
 * price the storefront checkout charges (the shared sale-window rule in lib/sale-pricing.ts: sale price only inside its window, else base price), then any
 * owner-configured bulk-price rule for the quantity, and the product's availability and min/max rules.
 * A price supplied by the request is never used. Variant-level prices are not applied to pre-orders,
 * because a pre-order carries only a free-text variant label (owner decision: see RELEASE_BLOCKERS.md).
 */

import { evaluateProductAvailability } from "./inventory";
import { chargeableUnitPrice, listPriceKES, type QuantityRule } from "./sale-pricing";

export type PreorderProduct = {
  id: string;
  name: string;
  basePriceKES?: number | null;
  salePriceKES?: number | null;
  salePriceStartsAt?: Date | string | null;
  salePriceEndsAt?: Date | string | null;
  variantPriceKES?: number | null;
  stockStatus?: string | null;
  quantity?: number | null;
  preOrderAllowed?: boolean | null;
  minOrder?: number | null;
  maxOrder?: number | null;
  isActive?: boolean | null;
};

export type PreorderPricing =
  | { ok: true; unitPriceKES: number; quantity: number }
  | { ok: false; status: 400 | 409; error: string };

/** Resolve the server-side unit price for a pre-order, or say why it cannot be taken. */
export function resolvePreorderPricing(input: {
  product: PreorderProduct;
  quantity: number;
  bulkRules?: QuantityRule[] | null;
  now?: Date;
}): PreorderPricing {
  const { product } = input;
  const quantity = Math.round(Number(input.quantity));
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, status: 400, error: "Quantity must be a whole number of at least 1." };
  }

  const availability = evaluateProductAvailability({ product, requestedQuantity: quantity });
  if (availability.stockStatus === "DISCONTINUED" || product.isActive === false) {
    return { ok: false, status: 409, error: availability.reason || `${product.name} is not available.` };
  }
  if (!availability.canPreOrder) {
    return { ok: false, status: 409, error: `${product.name} is not available for pre-order.` };
  }
  if (typeof product.minOrder === "number" && quantity < product.minOrder) {
    return { ok: false, status: 400, error: `${product.name} requires a minimum pre-order of ${product.minOrder}.` };
  }
  if (typeof product.maxOrder === "number" && product.maxOrder > 0 && quantity > product.maxOrder) {
    return { ok: false, status: 400, error: `${product.name} has a maximum pre-order of ${product.maxOrder}.` };
  }

  // Same rule as checkout and the AI order paths: the sale window at this instant, then the owner's quantity rule.
  if (listPriceKES(product) === null) {
    return { ok: false, status: 409, error: `${product.name} has no price set, so it cannot be pre-ordered yet.` };
  }
  const { unitPriceKES } = chargeableUnitPrice({
    product,
    productName: product.name,
    quantity,
    now: input.now ?? new Date(),
    rules: input.bulkRules,
  });
  if (!(unitPriceKES > 0)) {
    return { ok: false, status: 409, error: `${product.name} has no price set, so it cannot be pre-ordered yet.` };
  }
  return { ok: true, unitPriceKES, quantity };
}

export function createPreOrderSummary(config: {
  productName: string;
  variantDesc?: string;
  quantity: number;
  fullPriceKES?: number;
  depositRequiredKES?: number;
  expectedDate?: Date | null;
  fulfilmentNotes?: string | null;
}): {
  label: string;
  quantity: number;
  fullPriceKES: number;
  depositRequiredKES: number | null;
  totalKES: number;
  depositKES: number | null;
  expectedDate: Date | null;
  fulfilmentNotes: string | null;
} {
  const quantity = Math.max(1, Math.round(config.quantity || 1));
  const fullPriceKES = Number.isSafeInteger(config.fullPriceKES) ? Math.max(0, config.fullPriceKES!) : 0;
  const depositRequiredKES = Number.isSafeInteger(config.depositRequiredKES)
    ? Math.max(0, config.depositRequiredKES!)
    : null;
  return {
    label: `PRE-ORDER: ${config.productName}${config.variantDesc ? ` (${config.variantDesc})` : ""}`,
    quantity,
    fullPriceKES,
    depositRequiredKES,
    totalKES: fullPriceKES * quantity,
    depositKES: depositRequiredKES,
    expectedDate: config.expectedDate ?? null,
    fulfilmentNotes: config.fulfilmentNotes ?? null,
  };
}
