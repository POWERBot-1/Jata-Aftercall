/**
 * Commerce Pricing Engine (§11, §30, §33, §89) — deterministic server-side calculation.
 * The AI communicates the result; the backend calculates it. Never trusts the
 * client to determine amount, discount, or total.
 */

export type LineItemCalc = {
  productId?: string;
  serviceId?: string;
  name: string;
  quantity: number;
  unitPriceKES: number;
  variantDesc?: string;
  lineSubtotalKES: number;
};

export function calculateLineSubtotal(item: { quantity: number; unitPriceKES: number }): number {
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) throw new Error("Quantity must be a non-negative integer.");
  if (!Number.isSafeInteger(item.unitPriceKES) || item.unitPriceKES < 0) throw new Error("Unit price must be a non-negative integer.");
  return item.quantity * item.unitPriceKES;
}

export type CommerceCalculation = {
  lineItems: LineItemCalc[];
  subtotalKES: number;
  deliveryFeeKES: number;
  discountKES: number; // Only if business has explicitly configured promotion (§32)
  taxKES: number;      // Only if applicable by jurisdiction
  totalKES: number;
  currency: string;
};

export function calculateCommerceTotal(config: {
  lineItems: Array<{ name: string; quantity: number; unitPriceKES: number; productId?: string; serviceId?: string; variantDesc?: string }>;
  deliveryFeeKES?: number;
  discountKES?: number; // Must be explicitly configured; never invented by AI (§32)
  taxRate?: number; // Example: 0.16 for 16% VAT where applicable
  currency?: string;
}): CommerceCalculation {
  const currency = config.currency || "KES";
  const deliveryFeeKES = Number.isSafeInteger(config.deliveryFeeKES) ? Math.max(0, config.deliveryFeeKES!) : 0;
  const discountKES = Number.isSafeInteger(config.discountKES) ? Math.max(0, config.discountKES!) : 0;

  const lineItems: LineItemCalc[] = [];
  let subtotalKES = 0;

  for (const item of config.lineItems) {
    const quantity = Math.max(0, Math.round(Number(item.quantity) || 0));
    const unitPriceKES = Math.max(0, Math.round(Number(item.unitPriceKES) || 0));
    const lineSubtotalKES = calculateLineSubtotal({ quantity, unitPriceKES });
    subtotalKES += lineSubtotalKES;
    lineItems.push({
      productId: item.productId,
      serviceId: item.serviceId,
      name: item.name,
      quantity,
      unitPriceKES,
      variantDesc: item.variantDesc,
      lineSubtotalKES,
    });
  }

  if (subtotalKES < discountKES) {
    throw new Error("Discount cannot exceed subtotal. No invented discounts (§32).");
  }

  const afterDiscount = Math.max(0, subtotalKES - discountKES);
  const taxRate = typeof config.taxRate === "number" ? Math.max(0, Math.min(1, config.taxRate)) : 0;
  const taxKES = Math.round(afterDiscount * taxRate);
  const totalKES = afterDiscount + deliveryFeeKES + taxKES;

  return {
    lineItems,
    subtotalKES,
    deliveryFeeKES,
    discountKES,
    taxKES,
    totalKES,
    currency,
  };
}
