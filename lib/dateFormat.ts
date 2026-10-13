/**
 * Deterministic date and number formatting (hydration safety).
 *
 * Why this module exists
 * ----------------------
 * A server-rendered client component that formats a date with the *runtime* locale
 * (`new Date(x).toLocaleDateString()`) or the *runtime* time zone
 * (`new Date(x).toLocaleString("en-KE")`) renders one string on the server and a different
 * string in the customer's browser. React reports that as a hydration error (the classic
 * `#418` / "Text content did not match") and, worse, can show the wrong day until the next
 * render. The platform runs in Africa/Nairobi while the build/edge runtime runs in UTC, so a
 * timestamp near midnight is enough to produce two different days.
 *
 * Every date shown by hydration-relevant UI must therefore come from here: the locale and the
 * time zone are fixed inputs, never defaults.
 *
 * Contract
 * --------
 * - Locale is pinned to `en-KE` (identical strings for Kenyan customers and for the server).
 * - Time zone is pinned to `Africa/Nairobi` (the platform's business time zone).
 * - No function reads the ambient `TZ` or the ambient default locale.
 * - `Intl` failures fall back to a stable, manual string rather than throwing.
 */

export const JATA_LOCALE = "en-KE";
export const JATA_TIME_ZONE = "Africa/Nairobi";

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateFormatter = new Intl.DateTimeFormat(JATA_LOCALE, {
  timeZone: JATA_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(JATA_LOCALE, {
  timeZone: JATA_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat(JATA_LOCALE, {
  timeZone: JATA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const numberFormatter = new Intl.NumberFormat(JATA_LOCALE, { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat(JATA_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });


const weekdayFormatter = new Intl.DateTimeFormat(JATA_LOCALE, {
  timeZone: JATA_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** `Mon, 12 Oct`, in Africa/Nairobi, from a `YYYY-MM-DD` calendar day. */
export function formatWeekdayDate(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return weekdayFormatter.format(date);
  } catch {
    return fallback;
  }
}

/**
 * A `YYYY-MM-DD` calendar day parsed as the *Nairobi* calendar day, not as UTC midnight.
 * Booking chips render this, so a customer in a different time zone still sees the day the
 * owner configured.
 */
export function parseCalendarDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T00:00:00+03:00`);
}

/** Manual fallback used when `Intl` is unavailable or rejects the locale. */
function manualDate(date: Date, withTime: boolean): string {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000); // Africa/Nairobi (UTC+3, no DST)
  const pad = (value: number) => String(value).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = `${pad(shifted.getUTCDate())} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
  return withTime ? `${day}, ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` : day;
}

/** `12 Oct 2026`, in Africa/Nairobi. Returns `fallback` for missing or invalid input. */
export function formatDate(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return dateFormatter.format(date);
  } catch {
    return manualDate(date, false);
  }
}

/** `12 Oct 2026, 14:05`, in Africa/Nairobi. Returns `fallback` for missing or invalid input. */
export function formatDateTime(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return dateTimeFormatter.format(date);
  } catch {
    return manualDate(date, true);
  }
}

/** `14:05`, in Africa/Nairobi. Returns `fallback` for missing or invalid input. */
export function formatTime(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return timeFormatter.format(date);
  } catch {
    return manualDate(date, true).split(", ")[1] ?? fallback;
  }
}

/** Grouped integer/decimal, locale-pinned (`1,500`). */
export function formatNumber(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  try {
    return numberFormatter.format(value);
  } catch {
    return String(value);
  }
}

/** `KES 1,500` — the platform's only currency presentation. */
export function formatKes(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  try {
    return `KES ${moneyFormatter.format(value)}`;
  } catch {
    return `KES ${value}`;
  }
}

/**
 * Whole days from `now` until `value` (negative when already past). Used for renewal copy.
 * `now` is injected so callers stay testable and deterministic.
 */
export function daysUntil(value: DateInput, now: Date = new Date()): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}
