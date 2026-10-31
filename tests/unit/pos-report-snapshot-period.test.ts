import { describe, expect, it } from "vitest";
import { snapshotPeriod } from "@/lib/pos/report-snapshots";

describe("finalized report periods", () => {
  const now = new Date("2026-11-03T10:00:00Z");
  it("uses completed inclusive UTC dates and an exclusive end", () => {
    const range = snapshotPeriod("2026-11-01", "2026-11-02", now);
    expect(range.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });
  it("rejects invalid, current, reversed and excessively long ranges", () => {
    for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-11-03", "2026-11-03"], ["2026-11-02", "2026-11-01"], ["2024-01-01", "2026-11-02"]]) {
      expect(() => snapshotPeriod(from, to, now)).toThrow();
    }
  });
});
