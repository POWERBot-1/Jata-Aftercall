import { describe, expect, it } from "vitest";
import { previousDailyPeriod, previousMonthlyPeriod } from "@/lib/agents/report-periods";

describe("closed Nairobi reporting periods", () => {
  it("uses Nairobi midnight and excludes the end of a daily period", () => {
    const period = previousDailyPeriod(new Date("2026-03-01T21:00:00.000Z"));
    expect(period.key).toBe("daily:2026-03-01");
    expect(period.startInclusive.toISOString()).toBe("2026-02-28T21:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-03-01T21:00:00.000Z");
    expect(previousDailyPeriod(new Date("2026-03-02T17:00:00.000Z")).key).toBe(period.key);
  });
  it("handles year rollover and leap-year February", () => {
    const december = previousMonthlyPeriod(new Date("2026-01-01T00:01:00Z"));
    expect(december.key).toBe("monthly:2025-12");
    expect(december.startInclusive.toISOString()).toBe("2025-11-30T21:00:00.000Z");
    expect(december.endExclusive.toISOString()).toBe("2025-12-31T21:00:00.000Z");
    const february = previousMonthlyPeriod(new Date("2024-03-15T09:00:00Z"));
    expect(february.key).toBe("monthly:2024-02");
    expect(february.startInclusive.toISOString()).toBe("2024-01-31T21:00:00.000Z");
    expect(february.endExclusive.toISOString()).toBe("2024-02-29T21:00:00.000Z");
  });
  it("rejects invalid instants rather than producing a report key", () => {
    expect(() => previousDailyPeriod(new Date("invalid"))).toThrow(RangeError);
    expect(() => previousMonthlyPeriod(new Date("invalid"))).toThrow(RangeError);
  });
});
