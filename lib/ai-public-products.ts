/**
 * Price view for AI-facing and customer-facing product lists (customer AI page, AI brain and dashboard APIs).
 *
 * Every price a customer or the AI sees is the effective price at the current instant (lib/sale-pricing.ts).
 * The view never carries the sale window dates, the stored sale price, or other pricing internals: a customer
 * sees only what they will pay, and the original price only while a sale is running.
 */
import { displayPriceKES, type PricedProduct } from "./sale-pricing";

export type PublicProductPrice = {
  priceKES: number | null;
  wasPriceKES: number | null;
};

export function publicProductPrice(product: PricedProduct, now: Date = new Date()): PublicProductPrice {
  const shown = displayPriceKES(product, now);
  return { priceKES: shown.priceKES, wasPriceKES: shown.wasPriceKES };
}

/**
 * Drop the sale window and raw sale price from a product row, and add the effective price.
 * Used where a full product row would otherwise leak pricing internals.
 */
export function withPublicPricing<T extends PricedProduct & Record<string, unknown>>(
  product: T,
  now: Date = new Date(),
): Omit<T, "salePriceKES" | "salePriceStartsAt" | "salePriceEndsAt"> & PublicProductPrice {
  const { salePriceKES: _sale, salePriceStartsAt: _start, salePriceEndsAt: _end, ...rest } = product;
  void _sale;
  void _start;
  void _end;
  return { ...rest, ...publicProductPrice(product, now) };
}
