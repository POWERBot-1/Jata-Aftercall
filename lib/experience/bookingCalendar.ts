/**
 * Initial booking choices are server facts, not a second client clock calculation.
 * Date keys remain UTC date-only keys, matching the existing UTC deployment/booking API.
 * Labels are deterministic English/en-KE text; no browser timezone or ICU version can change hydration.
 * Availability, past-time, capacity and deposits are still validated by the server booking routes.
 */
export type BookingDay = Readonly<{ date: string; label: string }>;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function bookingCalendar(now: Date): BookingDay[] {
  if (!Number.isFinite(now.getTime())) return [];
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 14 }, (_, offset) => {
    const day = new Date(start + offset * 86_400_000);
    return {
      date: day.toISOString().slice(0, 10),
      label: `${WEEKDAYS[day.getUTCDay()]}, ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`,
    };
  });
}
