/**
 * Cart Service (§27, §58) — conversational order building with authoritative server-side pricing.
 *
 * Transforms natural language selections (e.g., "I want two burgers and one chips")
 * into structured cart items with authoritative pricing from the business catalogue (§11, §16, §27).
 */

import { calculateCommerceTotal, type CommerceCalculation } from "./commerce-pricing";

export type CartLine = {
  productId?: string;
  serviceId?: string;
  name: string;
  variantDesc?: string; // Size, colour, etc.
  quantity: number;
  unitPriceKES: number;
};

export function buildCartFromLines(
  lines: CartLine[],
  options?: { deliveryFeeKES?: number; discountKES?: number; taxRate?: number; currency?: string },
): CommerceCalculation {
  return calculateCommerceTotal({
    lineItems: lines,
    deliveryFeeKES: options?.deliveryFeeKES,
    discountKES: options?.discountKES,
    taxRate: options?.taxRate,
    currency: options?.currency,
  });
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  moja: 1,
  mbili: 2,
  tatu: 3,
  nne: 4,
  tano: 5,
};

function singularize(word: string): string {
  const lower = word.toLowerCase().trim();
  if (lower === "chips" || lower === "fries" || lower.length <= 3) return lower;
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("es") && lower.length > 4 && !lower.endsWith("oes")) return lower.slice(0, -1);
  if (lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

/**
 * Parse natural language ordering ("I want two burgers and one chips") against
 * the tenant's authoritative product catalogue (§27).
 */
export function parseConversationalOrder(
  message: string,
  catalogue: Array<{
    id: string;
    name: string;
    basePriceKES?: number | null;
    variantPriceKES?: number | null;
    stockStatus?: string | null;
    quantity?: number | null;
    preOrderAllowed?: boolean | null;
  }>,
): {
  matchedLines: CartLine[];
  outOfStockItems: Array<{ productId: string; name: string; stockStatus: string; preOrderAllowed: boolean; priceKES: number }>;
} {
  const matchedLines: CartLine[] = [];
  const outOfStockItems: Array<{ productId: string; name: string; stockStatus: string; preOrderAllowed: boolean; priceKES: number }> = [];
  const text = (message || "").toLowerCase();

  for (const product of catalogue) {
    const productNameLower = product.name.toLowerCase();
    const tokens = productNameLower
      .split(/\s+/)
      .map((t) => singularize(t.replace(/[^a-z0-9]/g, "")))
      .filter((t) => t.length >= 3);

    // Match full product name or distinctive head noun (e.g., "burger" -> "Chicken Burger", "chips" -> "Chips")
    const fullMatch = text.includes(productNameLower) || text.includes(singularize(productNameLower));
    const headToken = tokens[tokens.length - 1] || productNameLower;
    const tokenRegex = new RegExp(`\\b${headToken}s?\\b`, "i");
    const partialMatch = headToken.length >= 3 && tokenRegex.test(text);

    if (!fullMatch && !partialMatch) continue;

    // Extract quantity immediately preceding or following the matched product token
    let quantity = 1;
    const escapedTarget = fullMatch ? productNameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : `${headToken}s?`;
    const beforePattern = new RegExp(`\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|moja|mbili|tatu|nne|tano)\\s+(?:x\\s*|×\\s*)?(?:[a-z]+\\s+)?${escapedTarget}`, "i");
    const afterPattern = new RegExp(`${escapedTarget}\\s+(\\d+|moja|mbili|tatu|nne|tano)\\b`, "i");

    const beforeMatch = beforePattern.exec(text);
    const afterMatch = afterPattern.exec(text);
    const rawQty = beforeMatch?.[1] || afterMatch?.[1];
    if (rawQty) {
      const asNum = Number(rawQty);
      if (Number.isFinite(asNum) && asNum > 0) {
        quantity = Math.min(99, Math.round(asNum));
      } else if (WORD_NUMBERS[rawQty.toLowerCase()]) {
        quantity = WORD_NUMBERS[rawQty.toLowerCase()];
      }
    }

    const authoritativePrice = Math.max(0, Math.round(Number(product.basePriceKES ?? product.variantPriceKES ?? 0)));
    const status = product.stockStatus || "IN_STOCK";
    const isUnavailable =
      status === "OUT_OF_STOCK" ||
      status === "DISCONTINUED" ||
      status === "PRE_ORDER" ||
      (typeof product.quantity === "number" && product.quantity < quantity);

    if (isUnavailable) {
      outOfStockItems.push({
        productId: product.id,
        name: product.name,
        stockStatus: status,
        preOrderAllowed: Boolean(product.preOrderAllowed) || status === "PRE_ORDER",
        priceKES: authoritativePrice,
      });
    } else {
      matchedLines.push({
        productId: product.id,
        name: product.name,
        quantity,
        unitPriceKES: authoritativePrice,
      });
    }
  }

  return { matchedLines, outOfStockItems };
}
