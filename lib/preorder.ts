/**
 * Pre-Order Service (§15) — support for unavailable products with clear customer labeling.
 */

import { calculateCommerceTotal } from "./commerce-pricing";

export function createPreOrderSummary(config: {
  productName: string;
  variantDesc?: string;
  quantity: number;
  fullPriceKES?: number;
  depositRequiredKES?: number;
}): { label: string; totalKES: number; depositKES: number | null } {
  const quantity = Math.max(1, Math.round(config.quantity || 1));
  const fullPriceKES = Number.isSafeInteger(config.fullPriceKES) ? Math.max(0, config.fullPriceKES!) : 0;
  const depositRequiredKES = Number.isSafeInteger(config.depositRequiredKES) ? Math.max(0, config.depositRequiredKES!) : null;
  return {
    label: `PRE-ORDER: ${config.productName}${config.variantDesc ? ` (${config.variantDesc})` : ""}`,
    totalKES: fullPriceKES * quantity,
    depositKES: depositRequiredKES,
  };
}
