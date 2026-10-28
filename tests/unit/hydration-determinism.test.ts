/**
 * React hydration mismatch (error #418) — deterministic formatting enforcement.
 *
 * The reported intermittent hydration failure has two reproducible mechanisms in this codebase,
 * both caused by formatting a value with the *runtime* environment instead of a fixed one:
 *
 *   1. Default locale: `new Date(x).toLocaleString()` renders with the server's default locale
 *      in Node and with the customer's locale in the browser (e.g. "10/12/2026" vs "12/10/2026").
 *   2. Default time zone: `new Date(x).toLocaleString("en-KE")` renders in UTC on the server and
 *      in Africa/Nairobi (UTC+3) in the browser, so any timestamp between 21:00 and 24:00 UTC
 *      produces a different day — exactly the kind of difference that appears only "sometimes".
 *
 * The fix is a single deterministic formatter (lib/dateFormat.ts) that pins both the locale and
 * the time zone. These tests prove the formatter is environment-independent and that no client
 * component bypasses it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.resetModules();
});

async function loadFormatter() {
  vi.resetModules();
  return import("@/lib/dateFormat");
}

describe("date formatting is environment-independent", () => {
  it("renders the same string under any server time zone", async () => {
    const instant = "2026-10-12T21:30:00.000Z"; // 00:30 on 13 Oct in Africa/Nairobi
    const seen: string[] = [];
    for (const tz of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Africa/Nairobi"]) {
      process.env.TZ = tz;
      const { formatDate, formatDateTime, formatTime } = await loadFormatter();
      seen.push(`${formatDate(instant)}|${formatDateTime(instant)}|${formatTime(instant)}`);
    }
    expect(new Set(seen).size, `different output per TZ: ${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toBe("13 Oct 2026|13 Oct 2026, 00:30|00:30");
  });

  it("pins the platform locale and business time zone in the source", () => {
    const source = readFileSync("lib/dateFormat.ts", "utf8");
    expect(source).toContain('export const JATA_LOCALE = "en-KE"');
    expect(source).toContain('export const JATA_TIME_ZONE = "Africa/Nairobi"');
    // Booking instants are shown on the clock they were booked against — Africa/Nairobi for a
    // booking created under the 2026-10-14 contract (release report §J.1), and UTC for a row that
    // predates it (LEGACY_BOOKING_TIME_ZONE). Everything else uses the business zone. Every Intl
    // date formatter must pin one of those declared constants — never the ambient time zone — and
    // the set of declared zones is itself pinned here, so a fourth zone cannot appear unnoticed.
    expect(source).toContain('export const JATA_BOOKING_TIME_ZONE = "Africa/Nairobi"');
    expect(source).toContain('export const LEGACY_BOOKING_TIME_ZONE = "UTC"');
    const formatters = source.match(/new Intl\.[A-Za-z]+\([^)]*\)/g) ?? [];
    expect(formatters.length).toBeGreaterThan(4);
    for (const formatter of formatters) {
      if (formatter.startsWith("new Intl.NumberFormat")) continue;
      expect(formatter, formatter).toMatch(/timeZone: (JATA_(BOOKING_)?TIME_ZONE|LEGACY_BOOKING_TIME_ZONE)/);
    }
    const declaredZones = new Set(
      (source.match(/timeZone: (JATA_[A-Z_]+|LEGACY_[A-Z_]+)/g) ?? []).map((entry) => entry.split(" ")[1]),
    );
    expect(declaredZones).toEqual(new Set(["JATA_TIME_ZONE", "JATA_BOOKING_TIME_ZONE", "LEGACY_BOOKING_TIME_ZONE"]));
  });

  it("formats numbers identically to the pinned locale", async () => {
    const { formatNumber, formatKes } = await loadFormatter();
    expect(formatNumber(1500)).toBe("1,500");
    expect(formatKes(1500)).toBe("KES 1,500");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(null)).toBe("—");
  });

  it("parses booking calendar days as Nairobi days, not UTC midnights", async () => {
    const { parseCalendarDay, formatWeekdayDate } = await loadFormatter();
    const day = parseCalendarDay("2026-10-12");
    expect(day).not.toBeNull();
    expect(formatWeekdayDate(day)).toBe("Mon, 12 Oct");
    expect(parseCalendarDay("not-a-day")).toBeNull();
  });
});

/** Every file under components/ and app/ that ships code to the browser. */
function clientComponentFiles(): string[] {
  const roots = ["components", "app"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx|ts)$/.test(entry)) continue;
      const source = readFileSync(full, "utf8");
      if (source.startsWith('"use client"') || source.startsWith("'use client'")) files.push(full);
    }
  };
  for (const root of roots) walk(root);
  return files;
}

describe("no client component formats with the runtime environment", () => {
  it("has client components to check", () => {
    expect(clientComponentFiles().length).toBeGreaterThan(10);
  });

  it("bans toLocaleString/toLocaleDateString/toLocaleTimeString in client components", () => {
    const offenders = clientComponentFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return source
        .split("\n")
        .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
        .filter((entry) => /\.toLocale(String|DateString|TimeString)\(/.test(entry.text));
    });
    expect(
      offenders.map((entry) => `${entry.file}:${entry.line} ${entry.text}`),
      "use formatDate/formatDateTime/formatTime/formatNumber from @/lib/dateFormat instead",
    ).toEqual([]);
  });

  it("keeps the root layout's pre-paint theme script, which is hydration-safe by design", () => {
    // The boot script writes to <html> before paint and <html> is suppressHydrationWarning, so a
    // saved theme choice cannot produce a mismatch. This test protects that invariant.
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain("productThemeBootScript()");
  });
});
