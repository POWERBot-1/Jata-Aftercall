import { describe, expect, it } from "vitest";
import { decodeReportCursor, encodeReportCursor } from "@/lib/agents/referral-report-cursor";

const valid = { endExclusive: new Date("2026-01-01T21:00:00.000Z"), periodKey: "daily:2026-01-01" };

describe("agent referral report cursor", () => {
  it("round-trips a canonical position and treats a missing cursor as the first page", () => {
    const encoded = encodeReportCursor(valid);
    const decoded = decodeReportCursor(encoded);
    expect(decoded).toEqual({ ok: true, cursor: valid });
    expect(decodeReportCursor(null)).toEqual({ ok: true, cursor: null });
  });

  it("refuses empty, oversized, non-base64url, non-JSON and wrongly shaped values", () => {
    const bad = [
      "",
      "a".repeat(257),
      "not base64!",
      "+/==",
      Buffer.from("not json", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([1, 2]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ e: "2026-01-01T21:00:00.000Z" }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ e: "2026-01-01T21:00:00.000Z", k: "daily:2026-01-01", applicationId: "other" }), "utf8").toString("base64url"),
    ];
    for (const raw of bad) expect(decodeReportCursor(raw)).toEqual({ ok: false });
  });

  it("refuses invalid dates, non-canonical dates and period keys outside the reporting format", () => {
    const make = (e: unknown, k: unknown) => Buffer.from(JSON.stringify({ e, k }), "utf8").toString("base64url");
    expect(decodeReportCursor(make("not-a-date", "daily:2026-01-01"))).toEqual({ ok: false });
    // Same instant, different spelling: rejected so there is exactly one canonical cursor per position.
    expect(decodeReportCursor(make("2026-01-01T21:00:00Z", "daily:2026-01-01"))).toEqual({ ok: false });
    expect(decodeReportCursor(make("2026-01-01T21:00:00.000Z", "../../etc"))).toEqual({ ok: false });
    expect(decodeReportCursor(make("2026-01-01T21:00:00.000Z", "weekly:2026-01"))).toEqual({ ok: false });
    expect(decodeReportCursor(make(42, "daily:2026-01-01"))).toEqual({ ok: false });
    // Same shape the schema check AgentReferralReportSnapshot_period_check enforces: monthly keys have no day.
    expect(decodeReportCursor(make("2026-01-01T21:00:00.000Z", "monthly:2026-01-01"))).toEqual({ ok: false });
    expect(decodeReportCursor(make("2026-01-01T21:00:00.000Z", "monthly:2026-01"))).toEqual({ ok: true, cursor: { endExclusive: new Date("2026-01-01T21:00:00.000Z"), periodKey: "monthly:2026-01" } });
  });
});
