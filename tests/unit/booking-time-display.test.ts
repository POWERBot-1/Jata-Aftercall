/**
 * Booking instants and the clock they are shown on.
 *
 * Superseded convention (pinned here until 2026-10-14): bookings were anchored to the *server's*
 * zone — UTC on Vercel — so a customer who tapped "09:00" was stored as 09:00Z and the surfaces
 * showed that clock. The owner then decided the booking-time contract (release report §J.1): a new
 * booking's date + time are Nairobi wall-clock values, converted to a UTC instant before storage,
 * and every surface renders a row on the clock it was anchored to.
 *
 * That leaves exactly two display clocks, and this file pins both:
 *   * a booking created under the contract (marker `Africa/Nairobi`) renders on the business
 *     clock — the time the customer chose;
 *   * a row written before the contract (no marker) renders on the legacy clock that produced it,
 *     so no historical appointment silently moves three hours.
 * Neither path reads the ambient zone, and the Nairobi-pinned helpers that govern payments,
 * reports and subscriptions are unchanged.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.resetModules();
});

const root = path.resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** 09:00 Nairobi on 14 Oct 2026, stored under the contract. */
const CONTRACT_STORED = "2026-10-14T06:00:00.000Z";
/** The same appointment written before the contract, when the server was UTC. */
const LEGACY_STORED = "2026-10-14T09:00:00.000Z";

describe("a booking created under the contract shows the time the customer chose", () => {
  it("is byte-identical under a UTC server, a Nairobi server, a US server and a UTC+14 server", async () => {
    const seen: string[] = [];
    for (const tz of ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      vi.resetModules();
      const { formatBookingDateTime } = await import("@/lib/dateFormat");
      const { bookingRowTimeZone, contractBookingMarker } = await import("@/lib/experience/booking");
      seen.push(formatBookingDateTime(CONTRACT_STORED, "—", bookingRowTimeZone(contractBookingMarker())));
    }
    expect(new Set(seen).size, `different output per TZ: ${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toBe("14 Oct 2026, 09:00");
  });

  it("shows the booked wall clock across the Nairobi midnight boundary", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatBookingDateTime, formatDateTime } = await import("@/lib/dateFormat");
    const { bookingRowTimeZone } = await import("@/lib/experience/booking");
    // 00:30 on the 13th in Nairobi is 21:30Z on the 12th: the contract row reads 13 Oct 00:30,
    // while the same instant written before the contract reads 12 Oct 21:30 (legacy clock).
    const stored = "2026-10-12T21:30:00.000Z";
    expect(formatBookingDateTime(stored, "—", bookingRowTimeZone("Africa/Nairobi"))).toBe("13 Oct 2026, 00:30");
    expect(formatBookingDateTime(stored, "—", bookingRowTimeZone(null))).toBe("12 Oct 2026, 21:30");
    // The Nairobi-pinned helper (payments, reports, subscriptions) is unchanged and still shifts.
    expect(formatDateTime(new Date(stored))).toBe("13 Oct 2026, 00:30");
    const shared = await import("@/lib/format");
    expect(shared.formatDateTime(new Date(stored))).toBe("13 Oct 2026 · 00:30");
  });

  it("does not read the clock: the same instant renders the same before and after midnight", async () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    const { formatBookingDateTime } = await import("@/lib/dateFormat");
    vi.setSystemTime(new Date("2026-10-13T20:59:00.000Z"));
    const before = formatBookingDateTime(CONTRACT_STORED);
    vi.setSystemTime(new Date("2026-10-13T21:00:30.000Z"));
    const after = formatBookingDateTime(CONTRACT_STORED);
    expect(after).toBe(before);
  });

  it("survives nonsense and the empty case without throwing", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatBookingDateTime } = await import("@/lib/dateFormat");
    const { bookingRowTimeZone } = await import("@/lib/experience/booking");
    expect(formatBookingDateTime("not-a-date")).toBe("—");
    expect(formatBookingDateTime(null)).toBe("—");
    expect(formatBookingDateTime(undefined)).toBe("—");
    // An unknown marker is never trusted: it falls back to the legacy clock rather than throwing.
    expect(formatBookingDateTime(LEGACY_STORED, "—", bookingRowTimeZone("Mars/Olympus_Mons"))).toBe("14 Oct 2026, 09:00");
    expect(formatBookingDateTime(new Date("2028-02-29T23:30:00.000Z"))).toBe("1 Mar 2028, 02:30");
  });
});

describe("the booking surfaces use each row's own clock", () => {
  it("dashboard board, customer booking page and the owner notification agree", () => {
    expect(read("components/dashboard/BookingBoard.tsx")).toContain("formatBookingDateTime(booking.startAt, bookingRowTimeZone(booking.bookingTimeZone))");
    expect(read("app/b/[slug]/booking/[id]/page.tsx")).toContain("formatBookingDateTime(booking.startAt, bookingRowTimeZone(booking.bookingTimeZone))");
    // A new booking always carries the marker, so the notification renders on the same clock the
    // board does; the legacy clock is never used to announce a new booking.
    const payments = read("lib/experience/payments.ts");
    expect(payments).toContain("formatBookingDateTime(params.startAt)");
    expect(payments).not.toMatch(/params\.startAt\.toLocaleString/);
    expect(read("app/dashboard/businesses/[id]/bookings/page.tsx")).toContain("bookingTimeZone: booking.bookingTimeZone");
  });
});

describe("no user-visible surface formats with the runtime locale or time zone", () => {
  it("keeps toLocale* out of app/ and components/", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (/\.(tsx|ts)$/.test(entry)) files.push(full.slice(root.length + 1));
      }
    };
    walk(path.join(root, "app"));
    walk(path.join(root, "components"));

    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(path.join(root, file), "utf8").split("\n").forEach((line, index) => {
        if (/toLocale(String|DateString|TimeString|UpperCase|LowerCase)\(/.test(line)) {
          offenders.push(`${file}:${index + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders, "use formatDate/formatTime/formatDateTime/formatBookingDateTime/formatNumber/formatKES from @/lib/format").toEqual([]);
  });
});
