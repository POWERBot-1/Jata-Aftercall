/**
 * Money (§77) — integer minor units, exact by construction.
 *
 * JATA never uses floating point for money. Amounts are stored and compared as integers in the
 * currency's minor unit (KES 550 → 55000 cents) and converted only at the edge, where the value
 * is going to be *displayed* or handed to a provider that expects a decimal string. Rounding is
 * half-away-from-zero and deterministic: the same input always produces the same integer.
 *
 * The POS keeps its own whole-shilling columns (KES) — this module is the bridge, so a sale's
 * `totalKES` and a payment's `amountMinor` can never drift by a fraction of a shilling.
 */

import { PAYMENT_CURRENCY } from "../paymentCurrency";

/** Currencies this build can settle in. The architecture is currency-agnostic (§77). */
export const SUPPORTED_CURRENCIES = [PAYMENT_CURRENCY] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const MINOR_UNITS_PER_MAJOR: Record<string, number> = {
  KES: 100, TZS: 100, UGX: 1, USD: 100, EUR: 100, GBP: 100, NGN: 100, ZAR: 100,
};

export function isValidCurrency(currency: unknown): currency is SupportedCurrency {
  return typeof currency === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(currency);
}

export function minorUnitsPerMajor(currency: string = PAYMENT_CURRENCY): number {
  return MINOR_UNITS_PER_MAJOR[currency] ?? 100;
}

/** KES 550 → 55000 minor units. Non-finite input becomes 0; negatives stay negative. */
export function toMinor(amount: number, currency: string = PAYMENT_CURRENCY): number {
  const scale = minorUnitsPerMajor(currency);
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  const scaled = Math.round(value * scale);
  // `-0` is a legal number but a confusing one to store; money is always an integer or zero.
  return scaled === 0 ? 0 : scaled;
}

export function kesToMinor(amountKES: number): number {
  return toMinor(amountKES, PAYMENT_CURRENCY);
}

/** 55000 minor units → KES 550. Exact for whole shillings, 2dp otherwise. */
export function fromMinor(amountMinor: number, currency: string = PAYMENT_CURRENCY): number {
  const scale = minorUnitsPerMajor(currency);
  const value = Number(amountMinor);
  if (!Number.isFinite(value)) return 0;
  return value / scale;
}

export function minorToKes(amountMinor: number): number {
  return fromMinor(amountMinor, PAYMENT_CURRENCY);
}

export function isValidAmountMinor(amountMinor: unknown): boolean {
  return Number.isSafeInteger(amountMinor) && (amountMinor as number) > 0;
}

export function isNonNegativeMinor(amountMinor: unknown): boolean {
  return Number.isSafeInteger(amountMinor) && (amountMinor as number) >= 0;
}

/** Adds minor amounts without losing precision — the only sanctioned way to total money. */
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + (Number.isSafeInteger(amount) ? amount : 0), 0);
}

/** KES 550 for the merchant and the customer (§110: plain language, never engine words). */
export function formatKES(amountKES: number): string {
  const value = Number.isFinite(amountKES) ? Math.round(amountKES) : 0;
  return `KES ${value.toLocaleString("en-KE")}`;
}

export function formatMinor(amountMinor: number, currency: string = PAYMENT_CURRENCY): string {
  return `${currency} ${fromMinor(amountMinor, currency).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

/** The decimal string providers expect, e.g. "550.00". Never used for our own arithmetic. */
export function minorToDecimalString(amountMinor: number, currency: string = PAYMENT_CURRENCY): string {
  const scale = minorUnitsPerMajor(currency);
  const value = Number.isSafeInteger(amountMinor) ? amountMinor : 0;
  const major = Math.trunc(Math.abs(value) / scale);
  const minor = Math.abs(value) % scale;
  const sign = value < 0 ? "-" : "";
  return `${sign}${major}.${String(minor).padStart(String(scale).length - 1, "0")}`;
}

/**
 * Parses the decimal amount a provider sent us. The provider is authoritative for *its* figure,
 * so this never "fixes" a malformed amount into something plausible: it returns null instead,
 * and the webhook pipeline rejects the event (§35, §43).
 */
export function decimalStringToMinor(value: unknown, currency: string = PAYMENT_CURRENCY): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^-?\d+(\.\d{1,6})?$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return toMinor(parsed, currency);
}

/** The last four digits — what a merchant may be shown, never the whole destination (§59). */
export function lastFour(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(-4);
}

/** "M-PESA Till •••4567" (§11, §53). */
export function maskDestination(value: unknown, prefix = ""): string {
  const four = lastFour(value);
  return `${prefix}${prefix ? " " : ""}•••${four || "••••"}`;
}

/** 2547••••126 — stored and displayed masked (§59). */
export function maskPhone(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  const head = digits.slice(0, 4);
  const tail = digits.slice(-3);
  return `${head}••••${tail}`;
}

export function isValidPhoneKE(phone: unknown): boolean {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  return /^(?:254|0)(?:7|1)\d{8}$/.test(digits);
}

/** Normalizes a Kenyan number to 2547XXXXXXXX (or 2541XXXXXXXX) for the provider. */
export function normalizePhoneKE(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}
