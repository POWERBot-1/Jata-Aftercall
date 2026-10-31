import { nairobiCalendarDay, parseCalendarDay } from "@/lib/dateFormat";

/** Only period boundaries. No report generation, scheduler or delivery is implemented here. */
export type ReportingPeriod = { key: string; startInclusive: Date; endExclusive: Date };
const DAY_MS = 86_400_000;

function currentNairobiMidnight(instant: Date): Date {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new RangeError("Invalid reporting instant");
  const midnight = parseCalendarDay(nairobiCalendarDay(instant));
  if (!midnight || !Number.isFinite(midnight.getTime())) throw new RangeError("Invalid reporting instant");
  return midnight;
}

/** The last completed Nairobi calendar day, regardless of the server's timezone. */
export function previousDailyPeriod(instant: Date): ReportingPeriod {
  const endExclusive = currentNairobiMidnight(instant);
  const startInclusive = new Date(endExclusive.getTime() - DAY_MS);
  return { key: `daily:${nairobiCalendarDay(startInclusive)}`, startInclusive, endExclusive };
}

/** The last completed Nairobi calendar month. The key is independent of retries. */
export function previousMonthlyPeriod(instant: Date): ReportingPeriod {
  const day = nairobiCalendarDay(currentNairobiMidnight(instant));
  const [year, month] = day.split("-").map(Number);
  const firstOfCurrentMonth = parseCalendarDay(`${day.slice(0, 7)}-01`);
  if (!firstOfCurrentMonth) throw new RangeError("Invalid reporting instant");
  // UTC Date handles January rollover and leap years. Anchor the result to Nairobi midnight.
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const previousMonth = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
  const startInclusive = parseCalendarDay(`${previousMonth}-01`);
  if (!startInclusive) throw new RangeError("Invalid reporting instant");
  return { key: `monthly:${previousMonth}`, startInclusive, endExclusive: firstOfCurrentMonth };
}
