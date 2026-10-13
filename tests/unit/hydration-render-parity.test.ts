/**
 * React hydration error #418 — the second mechanism, and a *render-level* check.
 *
 * The formatting sweep covered text that differed by locale/time zone. This file covers the other
 * reproducible mechanism: a client component that derives a value from the *runtime clock* during
 * render. `components/storefront/BookingClient.tsx` did exactly that for the booking date chips —
 *
 *     const today = new Date();
 *     days.push(new Date(y, m, d + offset).toISOString().slice(0, 10));
 *
 * — which failed twice over:
 *
 *   1. Hydration: the server (UTC) and the customer's browser (Africa/Nairobi, UTC+3) do not
 *      always agree on "today", so between 21:00 and 24:00 UTC the chip list was rendered from a
 *      different day on the two sides — the intermittent #418.
 *   2. Correctness: `toISOString()` serializes a *local midnight* to UTC, which in UTC+3 is the
 *      previous day, so the day a customer tapped was named one day later than the day booked.
 *
 * The fix removes the runtime clock from the render path: the server computes today's Nairobi
 * calendar day once (`nairobiCalendarDay()`) and passes it down as `today`, and the chip list comes
 * from `calendarDayList()` — pure, deterministic arithmetic. These tests render the real component
 * to a string (server rendering, which is what hydration compares against) under several server
 * time zones and two different system clocks and require the output to be byte-identical.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
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

const props = {
  slug: "demo",
  businessId: "biz_1",
  bookables: [
    {
      id: "svc_1",
      name: "Haircut",
      kind: "service" as const,
      durationMinutes: 30,
      depositKES: null,
      price: 1500,
      pricingType: "FIXED",
      imageUrl: null,
      description: null,
    },
  ],
  ctaLabel: "Book now",
  confirmationLabel: "We will confirm shortly",
  requireDate: true,
  today: "2026-10-12", // a Monday, in Africa/Nairobi
};

async function renderBooking(today = props.today): Promise<string> {
  vi.resetModules();
  const { BookingClient } = await import("@/components/storefront/BookingClient");
  return renderToString(createElement(BookingClient, { ...props, today }));
}

/** The rendered chip labels, in order: `<button …>Mon, 12 Oct</button>` → `Mon, 12 Oct`. */
function chipLabels(html: string): string[] {
  const chips = html.match(/class="eb-chip[^"]*"[^>]*>([^<]+)</g) ?? [];
  return chips.map((chip) => chip.slice(chip.indexOf(">") + 1, -1));
}

describe("the booking date chips are identical on every server", () => {
  it("renders the same HTML under a UTC server, a Nairobi server and a US server", async () => {
    const rendered: Record<string, string> = {};
    for (const tz of ["UTC", "Africa/Nairobi", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      rendered[tz] = await renderBooking();
    }
    const [, reference] = Object.entries(rendered)[0];
    for (const [tz, html] of Object.entries(rendered)) {
      expect(html, `output differs for TZ=${tz}`).toBe(reference);
    }
    // And the days are the Nairobi days, starting from the server-provided one.
    expect(chipLabels(reference)).toEqual([
      "Mon, 12 Oct",
      "Tue, 13 Oct",
      "Wed, 14 Oct",
      "Thu, 15 Oct",
      "Fri, 16 Oct",
      "Sat, 17 Oct",
      "Sun, 18 Oct",
      "Mon, 19 Oct",
      "Tue, 20 Oct",
      "Wed, 21 Oct",
    ]);
  });

  it("does not change when the clock crosses Nairobi midnight between render and hydration", async () => {
    process.env.TZ = "UTC";
    // 21:00 UTC = 13 Oct 00:00 in Nairobi; 20:59 UTC is still 12 Oct there. A component that read
    // the clock would produce different chips for the two instants. This one may not: `today` is an
    // input, so the server HTML and the hydration render agree whenever the server rendered.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T20:59:00.000Z"));
    const beforeMidnight = await renderBooking();
    vi.setSystemTime(new Date("2026-10-12T21:00:30.000Z"));
    const afterMidnight = await renderBooking();

    expect(afterMidnight).toBe(beforeMidnight);
    expect(chipLabels(afterMidnight)[0]).toBe("Mon, 12 Oct");
  });

  it("takes the day from the prop, so a stale page still books the day it displayed", async () => {
    process.env.TZ = "UTC";
    const html = await renderBooking("2026-12-31");
    expect(chipLabels(html)[0]).toBe("Thu, 31 Dec");
    expect(chipLabels(html)[1]).toBe("Fri, 1 Jan");
  });
});

describe("calendarDayList / nairobiCalendarDay", () => {
  it("produces the day after the one now, not the day before", async () => {
    const { calendarDayList, nairobiCalendarDay } = await import("@/lib/dateFormat");
    expect(calendarDayList("2026-10-12", 3)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    // 21:30 UTC is already the next day in Nairobi — the value the server must report.
    expect(nairobiCalendarDay(new Date("2026-10-12T21:30:00.000Z"))).toBe("2026-10-13");
    expect(nairobiCalendarDay(new Date("2026-10-12T20:30:00.000Z"))).toBe("2026-10-12");
    // Month, year and leap-day boundaries.
    expect(calendarDayList("2028-02-28", 3)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(calendarDayList("2026-12-31", 2)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("is environment-independent and refuses nonsense", async () => {
    const seen: string[] = [];
    for (const tz of ["UTC", "Africa/Nairobi", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      vi.resetModules();
      const { calendarDayList } = await import("@/lib/dateFormat");
      seen.push(calendarDayList("2026-10-12", 4).join(","));
    }
    expect(new Set(seen).size).toBe(1);

    vi.resetModules();
    const { calendarDayList } = await import("@/lib/dateFormat");
    expect(calendarDayList("not-a-day", 4)).toEqual([]);
    expect(calendarDayList("2026-10-12", 0)).toEqual([]);
    expect(calendarDayList("2026-10-12", -3)).toEqual([]);
  });

  it("supersedes the historical computation that caused the mismatch", async () => {
    const { calendarDayList } = await import("@/lib/dateFormat");
    // The previous implementation, reproduced exactly: local midnights serialized with
    // toISOString(). Two things to hold onto: it is time-zone dependent (the mismatch), and in
    // Nairobi it names the wrong day (the booking bug).
    const historical = (now: Date, count: number) => {
      const days: string[] = [];
      for (let offset = 0; offset < count; offset += 1) {
        days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).toISOString().slice(0, 10));
      }
      return days;
    };

    process.env.TZ = "Africa/Nairobi";
    vi.resetModules();
    const nairobi = historical(new Date("2026-10-12T06:00:00.000Z"), 3);
    process.env.TZ = "UTC";
    vi.resetModules();
    const utc = historical(new Date("2026-10-12T06:00:00.000Z"), 3);

    expect(nairobi, "the historical computation was not time-zone dependent — this test is stale").not.toEqual(utc);
    // 06:00 UTC on the 12th is 09:00 on the 12th in Nairobi, so the correct first day is the 12th;
    // the historical one starts on the 11th.
    expect(nairobi[0]).toBe("2026-10-11");
    expect(calendarDayList("2026-10-12", 3)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
  });
});

describe("the shared format helpers cannot regress to the runtime time zone", () => {
  it("keeps lib/format.ts date and time output identical in every server time zone", async () => {
    const seen: string[] = [];
    for (const tz of ["UTC", "Africa/Nairobi", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      vi.resetModules();
      const { formatDate, formatTime, formatDateTime } = await import("@/lib/format");
      const instant = new Date("2026-10-12T21:30:00.000Z"); // 00:30 on the 13th in Nairobi
      seen.push(`${formatDate(instant)}|${formatTime(instant)}|${formatDateTime(instant)}`);
    }
    expect(new Set(seen).size, `different output per TZ: ${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toBe("13 Oct 2026|00:30|13 Oct 2026 · 00:30");
  });

  it("bans the ambient time zone from the shared formatter's source", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "..", "lib/format.ts"), "utf8");
    expect(source).not.toContain("toLocaleDateString");
    expect(source).not.toContain("toLocaleTimeString");
    expect(source).toContain('from "./dateFormat"');
  });
});

describe("no client component derives a calendar day from the runtime clock", () => {
  const root = path.resolve(__dirname, "..", "..");

  function clientComponents(): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx|ts)$/.test(entry)) continue;
        if (/^["']use client["']/.test(readFileSync(full, "utf8"))) files.push(full.slice(root.length + 1));
      }
    };
    walk(path.join(root, "components"));
    walk(path.join(root, "app"));
    return files;
  }

  it("keeps the runtime clock and the ambient time zone out of storefront templates", () => {
    // Both idioms render different text on a UTC server and in a UTC+3 browser, and
    // `toISOString()` turns a local midnight into the previous day. Server components are exempt
    // (their output is computed once), client components are not.
    const offenders: string[] = [];
    for (const file of clientComponents()) {
      const source = readFileSync(path.join(root, file), "utf8");
      source.split("\n").forEach((line, index) => {
        if (/\.toISOString\(\)\.slice\(0, 10\)/.test(line) || /\bgetHours\(\)|\bgetDate\(\)|\bgetMonth\(\)|\bgetFullYear\(\)/.test(line)) {
          offenders.push(`${file}:${index + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders, "use nairobiCalendarDay()/calendarDayList() from @/lib/dateFormat").toEqual([]);
  });

  it("keeps the runtime clock out of BookingClient's render path", () => {
    const source = readFileSync(path.join(root, "components/storefront/BookingClient.tsx"), "utf8");
    expect(source, "BookingClient must receive `today` as a prop instead of reading the clock").not.toMatch(/new Date\(\s*\)/);
    expect(source).toContain("today: string;");
    expect(source).toContain("calendarDayList(today, 14)");

    const page = readFileSync(path.join(root, "app/b/[slug]/book/page.tsx"), "utf8");
    expect(page).toContain("today={nairobiCalendarDay()}");
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });
});
