/**
 * POS / ERP - PRO money (§2.1, §5.4 of the ERP addendum)
 *
 * Financial records that must reconcile are stored in integer cents. Every helper here works
 * in cents and rounds once, half-up, so a tax line, a journal and a statement agree exactly.
 * Whole-shilling display remains the product default: Kenyan retail prices are quoted in
 * shillings, but accounting precision is not negotiable.
 */

export const MAX_CENTS = 10_000_000_000; // KES 100,000,000

export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Math.round(parsed * 100), MAX_CENTS));
}

/** Parse a user-entered shilling amount ("1,250.50") into cents without ever returning NaN. */
export function parseKesToCents(value: number | string | null | undefined): number {
  if (typeof value === "number") return toCents(value);
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned) return 0;
  return toCents(Number(cleaned));
}

export function fromCents(cents: number | null | undefined): number {
  if (!Number.isFinite(Number(cents))) return 0;
  return Math.round(Number(cents)) / 100;
}

export function formatCents(cents: number | null | undefined): string {
  const amount = fromCents(cents);
  return `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact display used in dense tables: whole shillings when the cents are zero. */
export function formatCentsShort(cents: number | null | undefined): string {
  const value = fromCents(cents);
  const hasFraction = Math.round(value * 100) % 100 !== 0;
  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Round half away from zero, the convention used for tax lines. */
export function roundHalfUp(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

export function sumCents(values: Array<number | null | undefined>): number {
  return values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0), 0);
}

/** Basis points: 1600 bps = 16.00%. Rates are integers so 16% never becomes 15.9999%. */
export function rateFromBps(bps: number): number {
  return Number.isFinite(bps) ? bps / 10_000 : 0;
}

export function bpsFromPercent(percent: number): number {
  return Number.isFinite(percent) ? Math.round(percent * 100) : 0;
}

/**
 * Clamp a quantity to a sane, stored precision. Quantities are stored as floats because a
 * weighed sale is real; the constraint is on absurd values, not on decimals.
 */
export function normalizeQuantity(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1000) / 1000;
}
