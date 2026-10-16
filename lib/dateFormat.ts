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
 * The owner decided on 2026-10-14 (release report §J.1) that a booking is a Nairobi wall-clock
 * appointment: the customer's "09:00" is converted to the unambiguous UTC instant 06:00Z before
 * it is stored, and it is *displayed* on the same Nairobi clock, so the customer, the owner's
 * board and the owner notification all read 09:00. The conversion itself lives in
 * `lib/experience/bookingTime.ts` — this constant is the display half of the same contract.
 *
 * Rows written before the contract were anchored to the server's ambient zone (UTC on Vercel)
 * and carry no marker. They keep being read on that legacy clock, so no historical appointment
 * silently moves three hours — see `LEGACY_BOOKING_TIME_ZONE` and
 * `bookingRowTimeZone()`.
 */
export const JATA_BOOKING_TIME_ZONE = "Africa/Nairobi";

/**
 * The clock legacy (unmarked) booking rows were written on: `new Date(...)` in the server's
 * ambient zone, which is UTC on Vercel. Used only to *read* rows that predate the contract —
 * never to write, and never to reinterpret a stored instant.
 */
export const LEGACY_BOOKING_TIME_ZONE = "UTC";

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
const bookingFormatters: Record<string, Intl.DateTimeFormat> = {
  [JATA_BOOKING_TIME_ZONE]: new Intl.DateTimeFormat(JATA_LOCALE, {
    timeZone: JATA_BOOKING_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }),
  [LEGACY_BOOKING_TIME_ZONE]: new Intl.DateTimeFormat(JATA_LOCALE, {
    timeZone: LEGACY_BOOKING_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }),
};

/**
 * A booking instant on the clock it was booked against.
 *
 * New bookings are Nairobi-anchored (`JATA_BOOKING_TIME_ZONE`, the default here); rows that
 * predate the contract are read on the legacy clock
 * (`LEGACY_BOOKING_TIME_ZONE`) by passing the zone `bookingRowTimeZone()` returns for the row.
 * Deterministic either way: no ambient time zone, so the server and the browser always agree and
 * a legacy row never moves when the contract changes.
 */
export function formatBookingDateTime(value: DateInput, fallback = "—", timeZone: string = JATA_BOOKING_TIME_ZONE): string {
  const date = toDate(value);
  if (!date) return fallback;
  const formatter = bookingFormatters[timeZone] ?? bookingFormatters[JATA_BOOKING_TIME_ZONE];
  try {
    return formatter.format(date);
  } catch {
    return manualDate(date, true, timeZone === LEGACY_BOOKING_TIME_ZONE ? 0 : NAIROBI_OFFSET_MS);
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
