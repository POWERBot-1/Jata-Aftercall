/**
 * Cart Service (§58) — conversational order building.
 * Transform natural language selections (e.g. "two red medium hoodies")
 * into structured cart items with authoritative pricing (§11, §33).
 */

import { calculateCommerceTotal } from "./commerce-pricing";

export type CartLine = {
  productId?: string;
  serviceId?: string;
  name: string;
  variantDesc?: string; // Size, colour, etc.
  quantity: number;
  unitPriceKES: number;
};

export function buildCartFromLines(lines: CartLine[]) {
  return calculateCommerceTotal({ lineItems: lines });
}
