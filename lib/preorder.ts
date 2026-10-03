/**
 * Pre-Order Service (§19) — support for unavailable products with clear customer labeling.
 */

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
