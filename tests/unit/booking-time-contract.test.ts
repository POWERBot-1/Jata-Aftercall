/**
 * The booking-time contract (§9, §29 — owner decision 2026-10-14, release report §J.1).
 *
 * A booking request's `date` + `time` are Nairobi wall-clock values; what is stored is the
 * unambiguous UTC instant they denote, and every reader renders the row on the clock it was
 * anchored to. These tests pin the four things that decision rests on:
 *
 *   1. the conversion (including the Nairobi midnight boundary),
 *   2. the host-independence of every value and label (UTC, Nairobi, Los Angeles, Kiritimati),
 *   3. the legacy rule — a row written before the contract keeps its stored instant and is read on
 *      the clock that produced it, with no rewrite and no reinterpretation,
 *   4. the safety properties that must survive the change: validation, duration, overlap/capacity,
 *      tenant scoping and the server-side re-check that stops a double booking.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_BOOKING_TIME_ZONE,
  DEFAULT_AVAILABILITY,
  bookingEndAt,
  bookingRowTimeZone,
  contractBookingMarker,
  dayWindowInZone,
  freeSlotsFor,
  isValidBookingTransition,
  openDays,
  validateBookingRequest,
} from "@/lib/experience/booking";
import { bookingCalendar } from "@/lib/experience/bookingCalendar";
import { addCalendarDays, calendarDayInZone, wallClockToInstant } from "@/lib/experience/bookingTime";

const ORIGINAL_TZ = process.env.TZ;
const HOST_ZONES = ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Pacific/Kiritimati"] as const;

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const root = path.resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** A Nairobi day comfortably in the future, so "choose a time in the future" never races the suite. */
function futureNairobiDay(offsetDays = 3): string {
  return addCalendarDays(calendarDayInZone(new Date()), offsetDays);
}

describe("1. the contract conversion (Africa/Nairobi wall clock → UTC instant)", () => {
  it("anchors representative Nairobi times to the right instants", () => {
    // Nairobi is UTC+3 all year, so the shift is a constant three hours — not a host default.
    expect(wallClockToInstant("2026-10-14", "09:00")?.toISOString()).toBe("2026-10-14T06:00:00.000Z");
    expect(wallClockToInstant("2026-10-14", "12:00")?.toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect(wallClockToInstant("2026-10-14", "23:00")?.toISOString()).toBe("2026-10-14T20:00:00.000Z");
    expect(wallClockToInstant("2026-10-14", "00:30")?.toISOString()).toBe("2026-10-13T21:30:00.000Z");
    expect(wallClockToInstant("2026-10-14", "00:00")?.toISOString()).toBe("2026-10-13T21:00:00.000Z");
    expect(CONTRACT_BOOKING_TIME_ZONE).toBe("Africa/Nairobi");
  });

  it("accepts a request and stores the instant the customer's tap denotes", () => {
    const day = futureNairobiDay();
    const validated = validateBookingRequest({
      serviceId: "s1",
      date: day,
      time: "09:00",
      customerName: "Amina",
      customerPhone: "0722123456",
    });
    expect(validated.kind).toBe("ok");
    if (validated.kind !== "ok") return;
    expect(validated.startAt.toISOString()).toBe(wallClockToInstant(day, "09:00")!.toISOString());
    // The old `new Date(y, m-1, d, h, min)` anchoring is gone: under TZ=UTC it stored 09:00Z,
    // which is a different appointment from the 06:00Z the business clock means.
    expect(validated.startAt.toISOString()).not.toBe(`${day}T09:00:00.000Z`);
  });

  it("rejects an impossible date or time instead of silently rolling it over", () => {
    const valid = { customerName: "Amina", customerPhone: "0722123456", time: "10:00" };
    // 31 February is not a calendar date; the old Date constructor rolled it into March.
    expect(validateBookingRequest({ ...valid, date: "2026-02-31" }).kind).toBe("error");
    expect(validateBookingRequest({ ...valid, date: "2026-13-01" }).kind).toBe("error");
    expect(validateBookingRequest({ ...valid, date: "not-a-date" }).kind).toBe("error");
    expect(validateBookingRequest({ date: futureNairobiDay(), time: "25:00", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("error");
    expect(validateBookingRequest({ date: futureNairobiDay(), time: "10:60", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("error");
    // A date in the past is still refused, on the business clock.
    expect(validateBookingRequest({ date: "2020-01-01", time: "10:00", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("error");
  });
});

describe("2. a booking that crosses midnight", () => {
  it("keeps the late slot on the customer's day and ends on the next business day", () => {
    const start = wallClockToInstant("2026-10-14", "23:30")!;
    const end = bookingEndAt(start, 60);
    expect(start.toISOString()).toBe("2026-10-14T20:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-14T21:30:00.000Z");
    // In Nairobi that end instant is 00:30 on the 15th — the next calendar day, exactly as the
    // owner reading the board would expect, and not the 14th as UTC arithmetic would label it.
    expect(calendarDayInZone(end)).toBe("2026-10-15");
    expect(calendarDayInZone(start)).toBe("2026-10-14");
    // Duration is wall-clock duration: 23:30 → 00:30 is 60 minutes.
    expect(end.getTime() - start.getTime()).toBe(60 * 60_000);
  });

  it("anchors the last Nairobi slot of the day before the UTC day even turns", () => {
    // 21:30Z is 00:30 on the 12th in Nairobi; a 21:30 Nairobi slot on the 12th is 18:30Z.
    expect(wallClockToInstant("2026-10-12", "21:30")?.toISOString()).toBe("2026-10-12T18:30:00.000Z");
    // The business day window for 2026-10-12 is exactly the Nairobi day, not a UTC one.
    const window = dayWindowInZone("2026-10-12")!;
    expect(window.start.toISOString()).toBe("2026-10-11T21:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-12T21:00:00.000Z");
    expect(window.end.getTime() - window.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("3. start/end validation and duration", () => {
  it("never books less than the 15-minute floor and honours the requested minutes", () => {
    const start = wallClockToInstant("2026-10-14", "09:00")!;
    expect(bookingEndAt(start, 30).toISOString()).toBe("2026-10-14T06:30:00.000Z");
    expect(bookingEndAt(start, 90).toISOString()).toBe("2026-10-14T07:30:00.000Z");
    expect(bookingEndAt(start, 1).toISOString()).toBe("2026-10-14T06:15:00.000Z");
    expect(bookingEndAt(start, null).toISOString()).toBe("2026-10-14T06:30:00.000Z");
  });

  it("moves a booking only along allowed transitions, so a cancel cannot be undone", () => {
    expect(isValidBookingTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(isValidBookingTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(isValidBookingTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(isValidBookingTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
  });
});

describe("4. availability and overlap stay correct on the business clock", () => {
  const DAY = "2026-10-14"; // a Wednesday
  const SLOT_0900 = wallClockToInstant(DAY, "09:00")!;
  // `freeSlotsFor` never offers a slot whose instant has already started, so these checks inject
  // the clock explicitly instead of relying on the host's. With the ambient clock they passed only
  // while the runner's time was before 09:00 Nairobi on DAY, and failed for every later run — a
  // calendar-dependent test, never a property of the contract. The clock behaviour itself is
  // asserted separately below ("hides a slot once its Nairobi instant has passed").
  const BEFORE_OPEN = new Date(SLOT_0900.getTime() - 60 * 60_000);

  it("offers the day's slots and refuses a day that is closed", () => {
    // 2026-10-18 is a Sunday; DEFAULT_AVAILABILITY is closed on day 0.
    expect(freeSlotsFor({ date: "2026-10-18", availability: DEFAULT_AVAILABILITY, durationMinutes: 60 })).toHaveLength(0);
    expect(freeSlotsFor({ date: DAY, availability: DEFAULT_AVAILABILITY, durationMinutes: 60, now: BEFORE_OPEN })).toContain("09:00");
  });

  it("blocks a taken slot and its overlap, and frees it when the booking is cancelled", () => {
    const taken = [{ startAt: SLOT_0900, endAt: bookingEndAt(SLOT_0900, 60), status: "CONFIRMED" }];
    const slots = freeSlotsFor({ date: DAY, availability: DEFAULT_AVAILABILITY, durationMinutes: 60, taken, now: BEFORE_OPEN });
    expect(slots).not.toContain("09:00");
    expect(slots).toContain("10:00");
    // A cancelled booking never blocks the slot.
    const cancelled = [{ startAt: SLOT_0900, endAt: bookingEndAt(SLOT_0900, 60), status: "CANCELLED" }];
    expect(freeSlotsFor({ date: DAY, availability: DEFAULT_AVAILABILITY, durationMinutes: 60, taken: cancelled, now: BEFORE_OPEN })).toContain("09:00");
  });

  it("counts capacity, so a two-chair business can take two overlapping bookings", () => {
    const availability = { ...DEFAULT_AVAILABILITY, capacity: 2 };
    const taken = [{ startAt: SLOT_0900, endAt: bookingEndAt(SLOT_0900, 60), status: "CONFIRMED" }];
    expect(freeSlotsFor({ date: DAY, availability, durationMinutes: 60, taken, now: BEFORE_OPEN })).toContain("09:00");
    const full = [
      { startAt: SLOT_0900, endAt: bookingEndAt(SLOT_0900, 60), status: "CONFIRMED" },
      { startAt: SLOT_0900, endAt: bookingEndAt(SLOT_0900, 60), status: "PENDING" },
    ];
    expect(freeSlotsFor({ date: DAY, availability, durationMinutes: 60, taken: full, now: BEFORE_OPEN })).not.toContain("09:00");
  });

  it("hides a slot once its Nairobi instant has passed, whatever the host clock says", () => {
    const beforeSlot = new Date(SLOT_0900.getTime() - 60_000);
    expect(freeSlotsFor({ date: DAY, availability: DEFAULT_AVAILABILITY, durationMinutes: 60, now: beforeSlot })).toContain("09:00");
    const afterSlot = new Date(SLOT_0900.getTime() + 60_000);
    expect(freeSlotsFor({ date: DAY, availability: DEFAULT_AVAILABILITY, durationMinutes: 60, now: afterSlot })).not.toContain("09:00");
  });

  it("offers the business calendar from the Nairobi day, not the UTC day", async () => {
    // 22:30 in Nairobi on the 13th is 19:30Z on the 13th: the picker must still offer the 13th,
    // and at 00:30 Nairobi on the 14th (21:30Z on the 13th) it must offer the 14th.
    expect(bookingCalendar(new Date("2026-10-13T19:30:00Z"))[0].date).toBe("2026-10-13");
    expect(bookingCalendar(new Date("2026-10-13T21:30:00Z"))[0].date).toBe("2026-10-14");
    expect(bookingCalendar(new Date("2026-10-13T19:30:00Z"))[0].label).toBe("Tue, 13 Oct");
    // openDays starts from the same Nairobi day.
    const days = openDays(DEFAULT_AVAILABILITY, 3, new Date("2026-10-13T21:30:00Z"));
    expect(days[0]).toBe("2026-10-14");
  });
});

describe("5. rescheduling and notification consistency", () => {
  it("keeps the customer page, the owner board and the owner notification on one clock", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatBookingDateTime } = await import("@/lib/dateFormat");
    const day = "2026-10-14";
    const stored = wallClockToInstant(day, "09:00")!.toISOString();

    // The board and the customer page render a contract-marked row with the row's zone; a new
    // booking always carries the marker, so all three surfaces print the same 09:00.
    const boardLabel = formatBookingDateTime(stored, "", bookingRowTimeZone(contractBookingMarker()));
    expect(boardLabel).toBe("14 Oct 2026, 09:00");
    expect(boardLabel).toBe(formatBookingDateTime(stored, "", CONTRACT_BOOKING_TIME_ZONE));

    // The notification path (lib/experience/payments.ts) calls the same helper with the contract
    // default; assert the call site rather than trusting a copied string.
    const payments = read("lib/experience/payments.ts");
    expect(payments).toContain("formatBookingDateTime(params.startAt)");
    expect(formatBookingDateTime(stored)).toBe(boardLabel);

    // A reschedule today is cancel + rebook (there is no move endpoint): cancelling changes status
    // only and never the stored instant, so the new booking's time is the customer's new choice
    // on the same contract.
    const rescheduled = wallClockToInstant(day, "11:00")!.toISOString();
    expect(formatBookingDateTime(rescheduled)).toBe("14 Oct 2026, 11:00");
    expect(rescheduled).not.toBe(stored);
  });
});

describe("6. explicit time-zone behaviour on four hosts", () => {
  it("computes the same instant and the same label on UTC, Nairobi, LA and Kiritimati", async () => {
    const instants: string[] = [];
    const labels: string[] = [];
    const days: string[] = [];
    for (const zone of HOST_ZONES) {
      process.env.TZ = zone;
      vi.resetModules();
      const booking = await import("@/lib/experience/booking");
      const { formatBookingDateTime } = await import("@/lib/dateFormat");
      const instant = booking.wallClockToInstant("2026-10-14", "09:00")!;
      instants.push(instant.toISOString());
      labels.push(formatBookingDateTime(instant, "", booking.CONTRACT_BOOKING_TIME_ZONE));
      days.push(booking.openDays(booking.DEFAULT_AVAILABILITY, 2, new Date("2026-10-13T21:30:00Z")).join(","));
    }
    expect(new Set(instants).size, JSON.stringify(instants)).toBe(1);
    expect(instants[0]).toBe("2026-10-14T06:00:00.000Z");
    expect(new Set(labels).size, JSON.stringify(labels)).toBe(1);
    expect(labels[0]).toBe("14 Oct 2026, 09:00");
    expect(new Set(days).size, JSON.stringify(days)).toBe(1);
    expect(days[0]).toBe("2026-10-14,2026-10-15");
  });

  it("reads legacy rows identically on every host, on the legacy clock", async () => {
    const labels: string[] = [];
    for (const zone of HOST_ZONES) {
      process.env.TZ = zone;
      vi.resetModules();
      const { formatBookingDateTime } = await import("@/lib/dateFormat");
      const { bookingRowTimeZone: zoneFor } = await import("@/lib/experience/booking");
      labels.push(formatBookingDateTime("2026-10-14T09:00:00.000Z", "", zoneFor(null)));
    }
    expect(new Set(labels).size, JSON.stringify(labels)).toBe(1);
    expect(labels[0]).toBe("14 Oct 2026, 09:00");
  });
});

describe("7. legacy records are not rewritten or reinterpreted", () => {
  it("maps the marker to a display clock without touching the stored instant", () => {
    expect(bookingRowTimeZone(null)).toBe("UTC");
    expect(bookingRowTimeZone(undefined)).toBe("UTC");
    expect(bookingRowTimeZone("")).toBe("UTC");
    expect(bookingRowTimeZone("Pacific/Kiritimati")).toBe("UTC"); // unknown marker ⇒ never trusted
    expect(bookingRowTimeZone(contractBookingMarker())).toBe("Africa/Nairobi");
  });

  it("shows an unmarked row at the time it was entered, and a marked row on the business clock", async () => {
    process.env.TZ = "UTC";
    vi.resetModules();
    const { formatBookingDateTime } = await import("@/lib/dateFormat");
    const legacyStored = "2026-10-14T09:00:00.000Z"; // 09:00 tapped before the contract, stored 09:00Z
    const contractStored = wallClockToInstant("2026-10-14", "09:00")!.toISOString(); // 06:00Z after it

    expect(formatBookingDateTime(legacyStored, "", bookingRowTimeZone(null))).toBe("14 Oct 2026, 09:00");
    expect(formatBookingDateTime(contractStored, "", bookingRowTimeZone(contractBookingMarker()))).toBe("14 Oct 2026, 09:00");
    // Different instants (the contract changed the anchor), same wall clock the customer chose —
    // and the legacy instant is still exactly what was stored, never shifted to make them equal.
    expect(legacyStored).not.toBe(contractStored);
    expect(formatBookingDateTime(legacyStored, "", bookingRowTimeZone(contractBookingMarker()))).toBe("14 Oct 2026, 12:00");
  });

  it("writes the marker only on create, and the migration only adds a nullable column", () => {
    const schema = read("prisma/schema.prisma");
    const booking = schema.slice(schema.indexOf("model Booking"), schema.indexOf("model Offer"));
    expect(booking).toContain("bookingTimeZone String?");
    // No default and no NOT NULL: every existing row keeps NULL and keeps its meaning.
    expect(booking).not.toMatch(/bookingTimeZone\s+String\?\s+@default/);
    const migration = read("prisma/migrations/20261014000000_booking_time_zone_marker/migration.sql");
    expect(migration).toContain('ALTER TABLE "Booking" ADD COLUMN "bookingTimeZone" TEXT;');
    // Only statements are checked — the file's comments explain why each destructive form is absent.
    const statements = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/UPDATE|DELETE|DROP|NOT NULL|DEFAULT|SET /i);
    // Exactly one statement, and it is the additive one.
    expect(statements.split(";").filter((part) => part.trim().length)).toHaveLength(1);
  });

  it("never writes the legacy clock onto a new row", () => {
    expect(contractBookingMarker()).toBe("Africa/Nairobi");
    expect(contractBookingMarker()).not.toBe(bookingRowTimeZone(null));
    const route = read("app/api/storefront/booking/route.ts");
    expect(route).toContain("bookingTimeZone: contractBookingMarker()");
    // The old ambient-anchored construction is gone from the write path.
    expect(route).not.toContain("T00:00:00`)");
  });
});

describe("8. concurrency protection and tenant isolation survive the contract", () => {
  it("re-checks the slot server-side, scoped to the business and the service", () => {
    const route = read("app/api/storefront/booking/route.ts");
    // The browser's slot list is never authoritative: the create path re-reads the day's bookings
    // for this business + service, on the business day window, and refuses a taken slot.
    expect(route).toContain("Re-check availability server-side");
    expect(route).toMatch(/where: \{ businessId: business\.id, serviceId, startAt: \{ gte: window\.start, lt: window\.end \} \}/);
    expect(route).toContain('return NextResponse.json({ error: "That time has just been taken. Please choose another." }, { status: 409 })');
    expect(route).toContain("if (!available.includes(String(body.time)))");
    // Every read is tenant-scoped by the business that owns the slug.
    expect(route).toMatch(/business\.id, serviceId, startAt/);
  });

  it("keeps the owner board tenant-scoped and authenticated", () => {
    const management = read("app/api/bookings/route.ts");
    expect(management).toContain("guardTenantMutation(session, businessId)");
    expect(management).toContain("guardTenantMutation(session, booking.businessId)");
    expect(management).toMatch(/where: \{ businessId, \.\.\.\(status/);
    // Ownership is re-checked against the stored row, never trusted from the request body.
    expect(management).toContain("const booking = await prisma.booking.findUnique(");
    // The board exposes the row's clock, so a legacy row is not displayed on the wrong one.
    expect(management).toContain("bookingTimeZone: booking.bookingTimeZone");
  });

  it("documents where real database concurrency proof lives", () => {
    // A pure-function test cannot prove row-level behaviour against PostgreSQL. The DB-gated
    // suites (skipped without DATABASE_URL, run in the CI database workflow) are that evidence.
    const journey = read("tests/e2e/interactive-business-journey.test.ts");
    expect(journey).toMatch(/describe\.skipIf/);
    expect(read("tests/unit/booking-time-contract.test.ts")).toContain("cannot prove");
  });
});
