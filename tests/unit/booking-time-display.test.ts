/**
 * Booking instants and the clock they are shown on.
 *
 * `validateBookingRequest` builds a booking from the availability slot string in the *server's*
 * zone, and the server is UTC on Vercel: a customer who taps "09:00" is stored as 09:00Z. Showing
 * that instant with the Nairobi-pinned helpers moved every appointment three hours ("12:00"),
 * disagreeing with the slot the customer chose and with the owner's notification message, which
 * used the server clock. The booking surfaces therefore render on the clock the booking was made
 * against (`formatBookingDateTime`, JATA_BOOKING_TIME_ZONE).
 *
 * This is an interim, semantics-preserving convention — it changes no stored instant and no
 * business rule. Whether bookings should instead be *anchored* to the Nairobi wall clock is an
 * open product decision recorded in the release report (§H.4); these tests pin the display rule
 * and the fact that the Nairobi-pinned helpers still govern payment/report timestamps.
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

/** The 09:00 slot a customer taps in Nairobi; stored UTC-anchored by the booking route. */
const TAPPED = "2026-10-14T09:00:00.000Z";

describe("booking instants render on the clock they were booked against", () => {
  it("is byte-identical under a UTC server, a Nairobi server, a US server and a UTC+14 server", async () => {
    const seen: string[] = [];
    for (const tz of ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      vi.resetModules();
      const { formatBookingDateTime } = await import("@/lib/dateFormat");
      seen.push(formatBookingDateTime(new Date(TAPPED)));
    }
    expect(new Set(seen).size, `different output per TZ: ${JSON.stringify(seen)}`).toBe(1);
    // The slot the customer actually chose — not the 12:00 the Nairobi-pinned helper would show.
    expect(seen[0]).toBe("14 Oct 2026, 09:00");
  });

  it("shows the booked wall clock across the Nairobi midnight boundary", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatBookingDateTime, formatDateTime } = await import("@/lib/dateFormat");
    // 21:30 UTC is 00:30 on the 13th in Nairobi. The chip the customer tapped is 2026-10-12 and
    // the slot is 21:30, so the booking surface must say 12 Oct 21:30.
    expect(formatBookingDateTime(new Date("2026-10-12T21:30:00.000Z"))).toBe("12 Oct 2026, 21:30");
    // The Nairobi-pinned helper (payments, reports, subscriptions) is unchanged and still shifts.
    expect(formatDateTime(new Date("2026-10-12T21:30:00.000Z"))).toBe("13 Oct 2026, 00:30");
    const shared = await import("@/lib/format");
    expect(shared.formatDateTime(new Date("2026-10-12T21:30:00.000Z"))).toBe("13 Oct 2026 · 00:30");
  });

  it("does not read the clock: the same instant renders the same before and after midnight", async () => {
    process.env.TZ = "UTC";
    vi.useFakeTimers();
    const { formatBookingDateTime } = await import("@/lib/dateFormat");
    vi.setSystemTime(new Date("2026-10-12T20:59:00.000Z"));
    const before = formatBookingDateTime(new Date(TAPPED));
    vi.setSystemTime(new Date("2026-10-12T21:00:30.000Z"));
    const after = formatBookingDateTime(new Date(TAPPED));
    expect(after).toBe(before);
  });

  it("survives nonsense and the empty case without throwing", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatBookingDateTime } = await import("@/lib/dateFormat");
    expect(formatBookingDateTime("not-a-date")).toBe("—");
    expect(formatBookingDateTime(null)).toBe("—");
    expect(formatBookingDateTime(undefined)).toBe("—");
    expect(formatBookingDateTime(new Date("2028-02-29T23:30:00.000Z"))).toBe("29 Feb 2028, 23:30");
  });
});

describe("the booking surfaces use the booking clock", () => {
  it("dashboard board, customer booking page and the owner notification agree", () => {
    expect(read("components/dashboard/BookingBoard.tsx")).toContain("formatBookingDateTime(booking.startAt)");
    expect(read("app/b/[slug]/booking/[id]/page.tsx")).toContain("formatBookingDateTime(booking.startAt)");
    const payments = read("lib/experience/payments.ts");
    expect(payments).toContain("formatBookingDateTime(params.startAt)");
    // The notification used to print the server clock next to a Nairobi-rendered board.
    expect(payments).not.toMatch(/params\.startAt\.toLocaleString/);
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
