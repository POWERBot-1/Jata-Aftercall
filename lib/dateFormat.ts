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

/**
 * The clock booking instants are stored against.
 *
 * `validateBookingRequest` builds every booking from the availability slot string in the
 * *server's* zone, and the server is UTC on Vercel, so a customer who taps "09:00" is stored as
 * 09:00Z. Booking instants are therefore displayed on that same clock — showing them in
 * Africa/Nairobi would move every appointment three hours and disagree with the slot the
 * customer chose. This is an interim, semantics-preserving convention: whether bookings should
 * be *anchored* to the Nairobi wall clock instead is an open product decision (release report
 * §H.4) and is deliberately not decided by a display helper.
 */
export const JATA_BOOKING_TIME_ZONE = "UTC";

/**
 * Africa/Nairobi is UTC+3 all year (no daylight saving), so Nairobi calendar arithmetic is a
 * fixed shift away from UTC. Used to derive a calendar day from an instant without a time-zone
 * database — the same value in Node (UTC) and in the browser (UTC+3).
 */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

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
function manualDate(date: Date, withTime: boolean, offsetMs: number = NAIROBI_OFFSET_MS): string {
  const shifted = new Date(date.getTime() + offsetMs); // Africa/Nairobi (UTC+3, no DST) unless told otherwise
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = `${pad(shifted.getUTCDate())} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
  return withTime ? `${day}, ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` : day;
}

/**
 * The `YYYY-MM-DD` Nairobi calendar day containing `instant` (default: now).
 *
 * This is the *server's* answer to "what day is it for the customer", and the value hydration
 * must agree on: a server in UTC calling `new Date().toISOString().slice(0, 10)` at 21:30 reports
 * yesterday's Nairobi date, which is exactly the class of mismatch (#418) this module exists to
 * remove. Callers that render a day-dependent list compute it once on the server and pass it
 * down, so the browser renders from the same input instead of from its own clock.
 */
export function nairobiCalendarDay(instant: Date | number = new Date()): string {
  const shifted = new Date((instant instanceof Date ? instant.getTime() : instant) + NAIROBI_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * `count` consecutive Nairobi calendar days starting at `from` (`YYYY-MM-DD`).
 *
 * Each day is the Nairobi day itself, never a UTC conversion of local midnight: the previous
 * implementation built days from browser-local midnights and serialized them with
 * `toISOString()`, which in UTC+3 named the day *before* the one it displayed — a customer
 * tapping "Mon, 12 Oct" booked the 11th. Nairobi has no daylight saving, so adding whole days to
 * a Nairobi-midnight instant is exact.
 */
export function calendarDayList(from: string, count: number): string[] {
  const start = parseCalendarDay(from);
  if (!start || !Number.isFinite(count) || count <= 0) return [];
  const days: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    days.push(nairobiCalendarDay(start.getTime() + offset * DAY_MS));
  }
  return days;
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
const bookingFormatter = new Intl.DateTimeFormat(JATA_LOCALE, {
  timeZone: JATA_BOOKING_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * A booking instant on the clock it was booked against (see JATA_BOOKING_TIME_ZONE).
 * Deterministic: no ambient time zone, so the server and the browser always agree.
 */
export function formatBookingDateTime(value: DateInput, fallback = "—"): string {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return bookingFormatter.format(date);
  } catch {
    return manualDate(date, true, 0);
  }
}

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
