/**
 * Booking-time contract (§9, §29 — owner decision 2026-10-14, release report §J.1)
 *
 * A business booking is a *wall-clock appointment*: the customer taps "09:00", the owner reads
 * "09:00", and both mean the business's own clock. The contract is therefore explicit and lives
 * here, in one place:
 *
 *   A booking request's date + time are interpreted as `Africa/Nairobi` wall-clock values and
 *   converted to an unambiguous UTC instant before storage. The stored column keeps holding an
 *   instant, so every existing query, index, ordering and comparison keeps its meaning.
 *
 * Why the conversion is not `new Date(\`${date}T${time}:00\`)`
 * ---------------------------------------------------------
 * A zone-less ISO string is parsed in the *server's* ambient zone, so the same tap produced a
 * different instant on a UTC server, a Nairobi laptop and a Los Angeles container. That is the
 * defect this module removes: the anchor is a named zone, never the host.
 *
 * Nairobi has been UTC+3 all year since 1940 (no daylight saving), so no wall time is ambiguous
 * or nonexistent there. The conversion below still validates the round trip for a general zone,
 * so a future per-business zone cannot silently accept a time that a DST transition deletes.
 */

import { JATA_BOOKING_TIME_ZONE, LEGACY_BOOKING_TIME_ZONE } from "@/lib/dateFormat";

/** The zone new bookings are anchored to. Same constant the display helpers pin. */
export const CONTRACT_BOOKING_TIME_ZONE = JATA_BOOKING_TIME_ZONE;

/**
 * The clock bookings were anchored to *before* the contract (`new Date(...)` in the server's
 * ambient zone — UTC on Vercel). Rows without a marker keep being read and shown on this clock.
 */
export const LEGACY_BOOKING_TIME_ZONE_VALUE = LEGACY_BOOKING_TIME_ZONE;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    // `hourCycle: "h23"` keeps midnight at 00 rather than 24, on every ICU version.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

type ZoneParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The calendar/clock fields an instant shows in `timeZone`. Never the ambient zone. */
export function partsInZone(instant: Date, timeZone: string = CONTRACT_BOOKING_TIME_ZONE): ZoneParts {
  const parts = partFormatter(timeZone).formatToParts(instant);
  const read = (type: string): number => {
    const entry = parts.find((part) => part.type === type);
    return entry ? Number(entry.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of `timeZone` from UTC at that instant, in milliseconds (Nairobi: +3h). */
export function zoneOffsetMs(instant: Date, timeZone: string = CONTRACT_BOOKING_TIME_ZONE): number {
  const parts = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026-10-14` — the calendar day an instant falls on in that zone. */
export function calendarDayInZone(instant: Date, timeZone: string = CONTRACT_BOOKING_TIME_ZONE): string {
  const parts = partsInZone(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** `2026-10-14` + n days, as pure calendar arithmetic (no zone, no clock). */
export function addCalendarDays(day: string, offset: number): string {
  const match = DATE_PATTERN.exec(day);
  if (!match) return day;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const shifted = new Date(start + Math.round(offset) * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday for a calendar day, independent of any host clock. */
export function dayOfWeekForCalendarDay(day: string): number {
  const match = DATE_PATTERN.exec(day);
  if (!match) return Number.NaN;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** True when the string is a real calendar date (2026-02-31 is not). */
export function isCalendarDay(day: string): boolean {
  const match = DATE_PATTERN.exec(day);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (year < 1970 || year > 3000 || month < 1 || month > 12 || date < 1 || date > 31) return false;
  return calendarDayInZone(new Date(Date.UTC(year, month - 1, date))) === day;
}

/**
 * The instant a wall-clock date + time denotes in `timeZone`.
 *
 * Returns `null` for an impossible input: a malformed date/time, a calendar date that does not
 * exist, or a local time a DST spring-forward deleted (checked by round trip, so the caller can
 * never store an instant that displays as a different time than the one the customer chose).
 * For an *ambiguous* fall-back time the earlier of the two instants is returned, which is the
 * conventional reading; Africa/Nairobi has neither case.
 */
export function wallClockToInstant(
  date: string,
  time: string,
  timeZone: string = CONTRACT_BOOKING_TIME_ZONE,
): Date | null {
  if (!isCalendarDay(date) || !TIME_PATTERN.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes);

  const firstOffset = zoneOffsetMs(new Date(wallAsUtc), timeZone);
  let instantMs = wallAsUtc - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(instantMs), timeZone);
  if (secondOffset !== firstOffset) instantMs = wallAsUtc - secondOffset;

  const instant = new Date(instantMs);
  const check = partsInZone(instant, timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hours ||
    check.minute !== minutes
  ) {
    return null;
  }
  return instant;
}

/** Half-open `[00:00, next 00:00)` for one business day, used by slot and overlap queries. */
export function dayWindowInZone(
  day: string,
  timeZone: string = CONTRACT_BOOKING_TIME_ZONE,
): { start: Date; end: Date } | null {
  if (!isCalendarDay(day)) return null;
  const start = wallClockToInstant(day, "00:00", timeZone);
  const end = wallClockToInstant(addCalendarDays(day, 1), "00:00", timeZone);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/**
 * The clock one booking row is read on.
 *
 * Only the contract marker is trusted. Anything else — `null` from every row written before the
 * contract (their stored meaning must not change), a value from a future contract version, or
 * junk — is read on the legacy clock, so no historical row is silently reinterpreted.
 */
export function bookingRowTimeZone(marker: string | null | undefined): string {
  return marker === CONTRACT_BOOKING_TIME_ZONE ? CONTRACT_BOOKING_TIME_ZONE : LEGACY_BOOKING_TIME_ZONE_VALUE;
}

/** The marker value written for a booking created under the contract. */
export function contractBookingMarker(): string {
  return CONTRACT_BOOKING_TIME_ZONE;
}
