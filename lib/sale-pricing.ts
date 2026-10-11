/**
 * Sale-price windows: the single server-side rule for what a product costs right now.
 *
 * Policy (approved, Option C):
 *  1. The base (list) price is authoritative outside a valid sale window.
 *  2. A sale price applies only when the current instant is inside its window. The window is
 *     start-inclusive and end-exclusive: at `startsAt` the sale is on; at `endsAt` it is off.
 *  3. After expiry the base price applies automatically. No scheduled cleanup is needed for pricing.
 *  4. Storage is UTC (Prisma DateTime). Owners enter times in Africa/Nairobi (UTC+03:00, no daylight saving).
 *  5. A sale price with no window, an inverted window, or a sale price that is not below the base price
 *     never discounts anything. Those states are reported so the Studio can explain them.
 *
 * Every channel (storefront checkout, pre-orders, member carts, conversational carts, AI Front Desk
 * quotes and orders, AI create_order, POS, Studio, structured data) calls this module. None of them
 * re-implements the rule. This file has no database access, so it is safe in every runtime.
 */

/** Business-facing time zone. Kenya has no daylight saving, so a fixed offset is exact. */
export const BUSINESS_TIME_ZONE = "Africa/Nairobi";
const BUSINESS_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export type SaleState =
  | "NONE" // no sale price configured
  | "NO_WINDOW" // sale price set but no start and end: not running
  | "INVALID_WINDOW" // start missing or not before end: not running
  | "SCHEDULED" // window is in the future
  | "EXPIRED" // window has ended: base price applies
  | "NOT_A_DISCOUNT" // sale price is not below the base price: base price applies
  | "ACTIVE"; // sale price applies now

export type PriceSource = "VARIANT" | "SALE" | "BASE";

export type PricedProduct = {
  basePriceKES?: number | null;
  variantPriceKES?: number | null;
  salePriceKES?: number | null;
  salePriceStartsAt?: Date | string | null;
  salePriceEndsAt?: Date | string | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The list price: base price, falling back to the product-level variant price (the same chain order paths use). */
export function listPriceKES(product: PricedProduct): number | null {
  for (const value of [product.basePriceKES, product.variantPriceKES]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return null;
}

/** Where the sale window stands at `now`. Start-inclusive, end-exclusive. */
export function saleStateAt(product: PricedProduct, now: Date): SaleState {
  const sale = product.salePriceKES;
  if (typeof sale !== "number" || !Number.isFinite(sale) || sale <= 0) return "NONE";
  const start = toDate(product.salePriceStartsAt);
  const end = toDate(product.salePriceEndsAt);
  if (!start && !end) return "NO_WINDOW";
  if (!start || !end || start.getTime() >= end.getTime()) return "INVALID_WINDOW";
  const instant = now.getTime();
  if (instant < start.getTime()) return "SCHEDULED";
  if (instant >= end.getTime()) return "EXPIRED";
  const list = listPriceKES(product);
  if (list === null || Math.round(sale) >= list) return "NOT_A_DISCOUNT";
  return "ACTIVE";
}

export type EffectivePrice = {
  unitPriceKES: number;
  source: PriceSource;
  saleState: SaleState;
  listPriceKES: number | null;
};

/**
 * The unit price a customer pays right now for one product (optionally one variant).
 * A variant with its own price keeps that price; product-level sales do not discount it.
 */
export function effectiveUnitPrice(
  product: PricedProduct,
  now: Date,
  variant?: { priceKES?: number | null } | null,
): EffectivePrice {
  const list = listPriceKES(product);
  const saleState = saleStateAt(product, now);
  if (variant && typeof variant.priceKES === "number" && Number.isFinite(variant.priceKES)) {
    return { unitPriceKES: Math.max(0, Math.round(variant.priceKES)), source: "VARIANT", saleState, listPriceKES: list };
  }
  if (saleState === "ACTIVE") {
    return { unitPriceKES: Math.round(Number(product.salePriceKES)), source: "SALE", saleState, listPriceKES: list };
  }
  return { unitPriceKES: list ?? 0, source: "BASE", saleState, listPriceKES: list };
}

export type QuantityRule = { productName: string; minQuantity: number; unitPriceKES: number };

/**
 * Explicit quantity pricing (for example "10 or more at KES 750"). It is applied to the effective unit price
 * and never stacks with a sale: the rule can only lower the price, and the lower of the two is charged.
 * Policy: no compounding of discounts. The owner's configured rule is the only quantity discount.
 */
export function applyQuantityRule(
  productName: string,
  effectiveUnitKES: number,
  quantity: number,
  rules: QuantityRule[] | null | undefined,
): { unitPriceKES: number; bulkApplied: boolean } {
  const match = (rules || []).find(
    (rule) =>
      rule.productName.trim().toLowerCase() === productName.trim().toLowerCase() &&
      quantity >= rule.minQuantity &&
      Number.isFinite(rule.unitPriceKES) &&
      rule.unitPriceKES >= 0,
  );
  if (!match || Math.round(match.unitPriceKES) >= effectiveUnitKES) {
    return { unitPriceKES: effectiveUnitKES, bulkApplied: false };
  }
  return { unitPriceKES: Math.round(match.unitPriceKES), bulkApplied: true };
}

/** Effective unit price after the owner's quantity rule. The one function checkout-style channels call. */
export function chargeableUnitPrice(input: {
  product: PricedProduct;
  productName: string;
  quantity: number;
  now: Date;
  rules?: QuantityRule[] | null;
  variant?: { priceKES?: number | null } | null;
}): EffectivePrice & { unitPriceKES: number; bulkApplied: boolean } {
  const effective = effectiveUnitPrice(input.product, input.now, input.variant);
  const quantity = Math.max(1, Math.round(input.quantity));
  const rule = applyQuantityRule(input.productName, effective.unitPriceKES, quantity, input.rules);
  return { ...effective, unitPriceKES: rule.unitPriceKES, bulkApplied: rule.bulkApplied };
}

/**
 * Parse an owner-entered time. A value with an explicit zone (Z or +hh:mm) is taken as written. A value
 * without a zone (the `datetime-local` format, "YYYY-MM-DDTHH:mm") is read as Africa/Nairobi time.
 * Returns null for anything else.
 */
export function parseBusinessDateTime(input: unknown): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(match[i] ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - BUSINESS_UTC_OFFSET_MS;
  const parsed = new Date(utc);
  // Reject dates that rolled over (for example 31 February).
  const back = new Date(utc + BUSINESS_UTC_OFFSET_MS);
  if (back.getUTCDate() !== day || back.getUTCMonth() !== month - 1) return null;
  return parsed;
}

/** "YYYY-MM-DDTHH:mm" in Africa/Nairobi, for a `datetime-local` input. */
export function toBusinessLocalInput(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + BUSINESS_UTC_OFFSET_MS).toISOString().slice(0, 16);
}

/** Human-readable Nairobi time, for owner and customer display. */
export function formatBusinessDateTime(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: BUSINESS_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "YYYY-MM-DD" in Africa/Nairobi, for schema.org `priceValidUntil`. */
export function businessDateOnly(date: Date): string {
  return new Date(date.getTime() + BUSINESS_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export type SaleWriteResult =
  | { ok: true; salePriceKES: number | null; salePriceStartsAt: Date | null; salePriceEndsAt: Date | null }
  | { ok: false; error: string };

/**
 * Validate a sale definition before it is saved. Used by every write path (catalogue API, POS, AI config).
 * `keepWindowIfUnchanged`: when the sale price equals the stored one and no window is sent, keep the stored window
 * (so a form that round-trips the price does not wipe the dates). Any new or changed sale needs a window.
 */
export function validateSaleWrite(input: {
  basePriceKES?: number | null;
  variantPriceKES?: number | null;
  salePriceKES?: number | string | null;
  startsAt?: unknown;
  endsAt?: unknown;
  stored?: { salePriceKES?: number | null; salePriceStartsAt?: Date | null; salePriceEndsAt?: Date | null };
}): SaleWriteResult {
  const rawSale = input.salePriceKES;
  // null, empty, or 0 all mean "no sale": the sale is cleared, and any window is dropped with it.
  if (rawSale === null || rawSale === undefined || rawSale === "" || Number(rawSale) === 0) {
    return { ok: true, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null };
  }
  const sale = Number(rawSale);
  if (!Number.isInteger(sale) || sale <= 0) {
    return { ok: false, error: "The sale price must be a whole KES amount above 0." };
  }
  const list = listPriceKES({ basePriceKES: input.basePriceKES, variantPriceKES: input.variantPriceKES });
  if (list !== null && sale >= list) {
    return { ok: false, error: "The sale price must be lower than the base price." };
  }
  const unchanged = input.stored && input.stored.salePriceKES === sale;
  const noWindowSent = (input.startsAt === undefined || input.startsAt === null || input.startsAt === "") &&
    (input.endsAt === undefined || input.endsAt === null || input.endsAt === "");
  if (unchanged && noWindowSent && input.stored?.salePriceStartsAt && input.stored?.salePriceEndsAt) {
    return {
      ok: true,
      salePriceKES: sale,
      salePriceStartsAt: input.stored.salePriceStartsAt,
      salePriceEndsAt: input.stored.salePriceEndsAt,
    };
  }
  const startsAt = parseBusinessDateTime(input.startsAt);
  const endsAt = parseBusinessDateTime(input.endsAt);
  if (!startsAt || !endsAt) {
    return { ok: false, error: "Set both a start and an end time for the sale (Africa/Nairobi time)." };
  }
  if (startsAt.getTime() >= endsAt.getTime()) {
    return { ok: false, error: "The sale must end after it starts." };
  }
  return { ok: true, salePriceKES: sale, salePriceStartsAt: startsAt, salePriceEndsAt: endsAt };
}

/**
 * What a customer-facing surface shows for a product at `now`: the price charged, and the struck-through
 * original only while a sale is ACTIVE. Storefront, structured data, validation and Studio all use this, so
 * they cannot disagree with checkout. Quantity rules are not shown here (they depend on the basket).
 */
export function displayPriceKES(
  product: PricedProduct,
  now: Date = new Date(),
): { priceKES: number | null; wasPriceKES: number | null; saleState: SaleState } {
  const list = listPriceKES(product);
  const effective = effectiveUnitPrice(product, now);
  if (list === null) return { priceKES: null, wasPriceKES: null, saleState: effective.saleState };
  const onSale = effective.saleState === "ACTIVE";
  return {
    priceKES: effective.unitPriceKES,
    wasPriceKES: onSale ? list : null,
    saleState: effective.saleState,
  };
}
