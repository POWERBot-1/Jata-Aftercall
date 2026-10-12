import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingClient } from "@/components/storefront/BookingClient";
import { bookingCalendar } from "@/lib/experience/bookingCalendar";

// Captured server calendar: the client must render these same facts, not rebuild them from its own clock.
const calendar = [
  { date: "2026-10-12", label: "Mon, 12 Oct" },
  { date: "2026-10-13", label: "Tue, 13 Oct" },
];
const props = {
  slug: "qa-salon", businessId: "qa-owned", calendar,
  bookables: [{ id: "qa-service", name: "Owned service", kind: "service" as const, durationMinutes: 60,
    depositKES: 0, price: 1200, pricingType: "FIXED", imageUrl: null, description: null }],
  preselectedId: "qa-service", ctaLabel: "Book now", confirmationLabel: "Booking requested", requireDate: true,
};
const originalTZ = process.env.TZ;
function initialHtml(time: string, timezone: string) {
  process.env.TZ = timezone;
  vi.setSystemTime(new Date(time));
  return renderToString(React.createElement(BookingClient, props));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });

describe("booking initial SSR/client rendering", () => {
  it.each(["Africa/Nairobi", "Asia/Kathmandu", "Pacific/Auckland", "America/New_York"])("keeps identical initial HTML in %s", (timezone) => {
    const server = initialHtml("2026-10-12T06:24:00Z", "UTC");
    expect(initialHtml("2026-10-12T06:24:00Z", timezone)).toBe(server);
  });
  it("keeps the server calendar when hydration crosses UTC midnight", () => {
    const server = initialHtml("2026-10-12T23:59:59Z", "UTC");
    expect(initialHtml("2026-10-13T00:00:01Z", "UTC")).toBe(server);
  });
  it("retains readable date choices, real service fields and the submit control in server HTML", () => {
    const html = initialHtml("2026-10-12T06:24:00Z", "UTC");
    expect(html).toContain("Mon, 12 Oct");
    expect(html).toContain("Tue, 13 Oct");
    expect(html).toContain("Owned service");
    expect(html).toContain('id="bk-name"');
    expect(html).toContain('id="bk-phone"');
    expect(html).toContain("Book now");
    expect(html).not.toContain("suppressHydrationWarning");
  });
});

describe("server booking calendar", () => {
  it("captures fourteen deterministic date-only choices without changing the input", () => {
    const now = new Date("2026-10-12T06:24:00Z");
    const result = bookingCalendar(now);
    expect(result).toHaveLength(14);
    expect(result[0]).toEqual({ date: "2026-10-12", label: "Mon, 12 Oct" });
    expect(result[13]).toEqual({ date: "2026-10-25", label: "Sun, 25 Oct" });
    expect(new Set(result.map((day) => day.date)).size).toBe(14);
    expect(now.toISOString()).toBe("2026-10-12T06:24:00.000Z");
  });
  it.each(["Africa/Nairobi", "America/New_York", "Pacific/Auckland"])("uses the same server date keys and labels in %s", (timezone) => {
    const now = new Date("2026-10-12T00:01:00Z");
    process.env.TZ = "UTC";
    const server = bookingCalendar(now);
    process.env.TZ = timezone;
    expect(bookingCalendar(now)).toEqual(server);
  });
  it("crosses leap-day and year boundaries correctly", () => {
    expect(bookingCalendar(new Date("2028-02-28T23:59:59Z")).slice(0, 3).map((day) => day.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(bookingCalendar(new Date("2026-12-31T23:59:59Z")).slice(0, 2).map((day) => day.date)).toEqual(["2026-12-31", "2027-01-01"]);
  });
  it("fails safely for an invalid server clock", () => {
    expect(bookingCalendar(new Date("invalid"))).toEqual([]);
  });
});
