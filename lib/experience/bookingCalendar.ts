/**
 * Initial booking choices are server facts, not a second client clock calculation.
 *
 * Date keys are business (`Africa/Nairobi`) calendar days — the same clock the booking contract
 * anchors a stored instant to (see `lib/experience/bookingTime.ts`). Before the contract these
 * were UTC days: at 22:30 in Nairobi a customer was offered "today" as a day that had already
 * ended on the business clock, so the last day of the picker was wrong for the last three hours
 * of every Nairobi day. Labels are deterministic English/en-KE text derived from the date string
 * itself, so no browser time zone or ICU version can change hydration. Availability, past-time,
 * capacity and deposits are still validated by the server booking routes.
 */
import { addCalendarDays, calendarDayInZone, dayOfWeekForCalendarDay } from "./bookingTime";

export type BookingDay = Readonly<{ date: string; label: string }>;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function bookingCalendar(now: Date): BookingDay[] {
  if (!Number.isFinite(now.getTime())) return [];
  const start = calendarDayInZone(now);
  return Array.from({ length: 14 }, (_, offset) => {
    const date = addCalendarDays(start, offset);
    const weekday = WEEKDAYS[dayOfWeekForCalendarDay(date)] ?? "";
    // Month/day for the label come from the date string, so the label cannot disagree with the key.
    const [, month, day] = date.split("-").map(Number);
    return { date, label: `${weekday}, ${day} ${MONTHS[month - 1]}` };
  });
}
