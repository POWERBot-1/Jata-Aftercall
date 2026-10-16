/**
 * Accounting-period policy, pinned as an owner decision (D-3b-2 Option A — release report §K.6).
 *
 * The owner selected Option A: keep the reporting-period boundaries and daily buckets exactly as
 * they are, rather than converting them to `Africa/Nairobi`. The policy that follows from that
 * choice, and what this file proves, is:
 *
 *   1. the accounting period is the **server's day** — 00:00:00.000 to 23:59:59.999 of the ambient
 *      zone, which in production (Vercel, UTC) means a UTC day, i.e. 03:00–03:00 Nairobi;
 *   2. period boundaries are **deterministic**: the same injected `now` always yields the same
 *      bounds, and a daily bucket keeps the same dates/labels however the series is recomputed;
 *   3. **labels are not periods.** Report rows print the business clock (Nairobi) while the bucket
 *      they are counted in stays UTC, so a 00:30 EAT sale reads "14 Oct … 00:30" and is counted in
 *      the 13 Oct bucket. Both halves are asserted below, because the separation is the whole point
 *      of the decision — it is what stops a presentation fix from silently restating the accounts;
 *   4. what the decision therefore **accepts**: a Nairobi business day is not the accounting day.
 *      That is pinned, not hidden, so a future change to it has to be a deliberate, visible one.
 *
 * Nothing here changes behaviour: `lib/pos/reports.ts` is untouched by the Directive-7 change set.
 * These tests exist so the policy is a contract rather than an accident. Companion coverage for the
 * day bucket and the Nairobi row labels lives in `pos-financial-timezone.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { dayRange, dailySeries, monthRange, summarizeSales, weekRange, type SaleRecord } from "@/lib/pos/reports";
import { formatDateTime } from "@/lib/format";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** A Wednesday, so the Monday-first week has visible days on both sides of it. */
const NOW = new Date("2026-10-14T09:00:00.000Z");

/** 22:30 Nairobi on 14 Oct 2026 — same UTC and Nairobi date. */
const LATE_SALE = "2026-10-14T19:30:00.000Z";
/** 00:30 Nairobi on 14 Oct 2026 — the UTC date is the 13th. */
const AFTER_MIDNIGHT_SALE = "2026-10-13T21:30:00.000Z";
/** 00:30 Nairobi on 12 Oct 2026 (a Monday) — the UTC date is Sunday the 11th, the previous week. */
const WEEK_BOUNDARY_SALE = "2026-10-11T21:30:00.000Z";
/** 00:30 Nairobi on 1 Nov 2026 — the UTC date is 31 Oct, so the previous month. */
const MONTH_BOUNDARY_SALE = "2026-10-31T21:30:00.000Z";

function sale(createdAt: string, totalKES = 300): SaleRecord {
  return {
    id: `sale_${createdAt}`,
    receiptNumber: "MW-000014",
    createdAt: new Date(createdAt),
    status: "PAID",
    subtotalKES: totalKES,
    discountKES: 0,
    taxKES: 0,
    totalKES,
    paidKES: totalKES,
    balanceKES: 0,
  };
}

describe("the accounting period is the server day (D-3b-2 Option A)", () => {
  it("produces exact UTC bounds in the production configuration", () => {
    process.env.TZ = "UTC";
    // The deployment target is UTC, so this is the boundary every production report already uses.
    const day = dayRange(NOW);
    expect(day.from.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(day.to.toISOString()).toBe("2026-10-14T23:59:59.999Z");

    // Monday-first, seven days: 12 Oct (Mon) through 18 Oct (Sun).
    const week = weekRange(NOW);
    expect(week.from.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(week.to.toISOString()).toBe("2026-10-18T23:59:59.999Z");

    // Calendar month, ending on the last day's final millisecond.
    const month = monthRange(NOW);
    expect(month.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(month.to.toISOString()).toBe("2026-10-31T23:59:59.999Z");
  });

  it("derives every boundary from the ambient server day, not from Nairobi", () => {
    // Zone-agnostic form of the same contract: whatever day the server is having, the period is the
    // hour-zero-to-last-millisecond of *that* day. This is what "keep the existing boundaries" means
    // once it is written down, and it holds whichever zone the runner is in.
    const day = dayRange(NOW);
    const expectedFrom = new Date(NOW);
    expectedFrom.setHours(0, 0, 0, 0);
    expect(day.from.getTime()).toBe(expectedFrom.getTime());
    expect(day.to.getTime()).toBe(expectedFrom.getTime() + 86_400_000 - 1);
    expect(day.from.getDate()).toBe(NOW.getDate());

    const week = weekRange(NOW);
    expect(week.from.getDay()).toBe(1); // Monday
    expect(week.from.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(week.to.getTime() - week.from.getTime()).toBe(7 * 86_400_000 - 1);

    const month = monthRange(NOW);
    expect(month.from.getDate()).toBe(1);
    expect(month.from.getMonth()).toBe(NOW.getMonth());
    expect(month.to.getMonth()).toBe(NOW.getMonth());
    expect(month.to.getDate()).toBe(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate());
  });

  it("is deterministic: the same instant always yields the same period", () => {
    process.env.TZ = "UTC";
    // Repeated derivation, and derivation from a re-created Date with the same instant.
    expect(dayRange(NOW)).toEqual(dayRange(NOW));
    expect(dayRange(new Date(NOW.getTime())).from.toISOString()).toBe(dayRange(NOW).from.toISOString());
    expect(weekRange(new Date(NOW)).to.toISOString()).toBe(weekRange(NOW).to.toISOString());
    expect(monthRange(new Date(NOW)).from.toISOString()).toBe(monthRange(NOW).from.toISOString());
    // The bounds are half-open in the safe direction: nothing falls in two periods at once.
    for (const range of [dayRange(NOW), weekRange(NOW), monthRange(NOW)]) {
      expect(range.to.getTime()).toBeGreaterThan(range.from.getTime());
      expect(range.to.getTime() - range.from.getTime()).toBeLessThan(32 * 86_400_000);
    }
    // A period never depends on when the report is run, only on the instant it is run for.
    const sales = [sale(LATE_SALE), sale(AFTER_MIDNIGHT_SALE)];
    expect(dailySeries(sales, 2, NOW)).toEqual(dailySeries(sales, 2, new Date(NOW.getTime())));
  });

  it("counts a boundary-crossing sale in the UTC bucket while labelling it in Nairobi", () => {
    process.env.TZ = "UTC";

    // Daily: the 00:30 EAT sale sits in the previous UTC day's bucket...
    const series = dailySeries([sale(AFTER_MIDNIGHT_SALE), sale(LATE_SALE)], 2, NOW);
    expect(series.map((point) => point.date)).toEqual(["2026-10-13", "2026-10-14"]);
    expect(series[0].count).toBe(1); // the 13 Oct bucket holds the 00:30 EAT sale
    expect(series[1].count).toBe(1);
    // ...while every row still prints the Nairobi wall clock.
    expect(formatDateTime(AFTER_MIDNIGHT_SALE)).toBe("14 Oct 2026 · 00:30");
    expect(formatDateTime(LATE_SALE)).toBe("14 Oct 2026 · 22:30");

    // Monthly: a sale at 00:30 EAT on 1 November is accounted in **October**, because its UTC
    // instant is 31 Oct — and it is labelled 1 Nov at the same time. This is the decision visible.
    const october = monthRange(NOW);
    expect(summarizeSales([sale(MONTH_BOUNDARY_SALE)], october).count).toBe(1);
    const november = monthRange(new Date("2026-11-15T09:00:00.000Z"));
    expect(summarizeSales([sale(MONTH_BOUNDARY_SALE)], november).count).toBe(0);
    expect(formatDateTime(MONTH_BOUNDARY_SALE)).toBe("01 Nov 2026 · 00:30");

    // Weekly: a sale at 00:30 EAT on Monday 12 October is accounted in the previous week.
    const week = weekRange(NOW); // 12–18 Oct
    expect(summarizeSales([sale(WEEK_BOUNDARY_SALE)], week).count).toBe(0);
    const previousWeek = weekRange(new Date("2026-10-08T09:00:00.000Z")); // 5–11 Oct
    expect(summarizeSales([sale(WEEK_BOUNDARY_SALE)], previousWeek).count).toBe(1);
    expect(formatDateTime(WEEK_BOUNDARY_SALE)).toBe("12 Oct 2026 · 00:30");
  });

  it("records the accepted consequence of the decision, so a change to it must be deliberate", () => {
    process.env.TZ = "UTC";
    // A Nairobi business day runs 03:00–03:00 in accounting terms. This is the cost of Option A and
    // it is asserted rather than described: the first three hours of a Nairobi day belong to the
    // previous accounting period.
    const day = dayRange(NOW);
    const nairobiMidnight = new Date("2026-10-13T21:00:00.000Z"); // 00:00 EAT on the 14th
    expect(nairobiMidnight.getTime() < day.from.getTime()).toBe(true);
    const nairobiThreeAm = new Date("2026-10-14T00:00:00.000Z"); // 03:00 EAT on the 14th
    expect(nairobiThreeAm.getTime() === day.from.getTime()).toBe(true);
  });
});
