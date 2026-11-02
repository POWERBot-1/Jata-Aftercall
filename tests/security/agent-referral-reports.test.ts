import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), transaction: vi.fn(), query: vi.fn(), execute: vi.fn(), list: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: m.limit }));
vi.mock("@/lib/db", () => ({ default: { $transaction: m.transaction } }));
import { GET, POST } from "@/app/api/agents/reports/referrals/route";
import { decodeReportCursor, encodeReportCursor } from "@/lib/agents/referral-report-cursor";
const env = { ...process.env };
const tx = { $queryRaw: m.query, $executeRaw: m.execute, agentReferralReportSnapshot: { findMany: m.list, findUniqueOrThrow: m.find } };
const report = { periodKey: "daily:2026-01-01", periodType: "DAILY", startInclusive: new Date("2025-12-31T21:00:00Z"), endExclusive: new Date("2026-01-01T21:00:00Z"), registrationCount: BigInt(2), existingApplicationCount: BigInt(1), createdAt: new Date("2026-01-02T00:00:00Z"), applicationId: "private-id" };
const request = (body: unknown = { period: "DAILY" }, origin = "https://agent.test") => new Request("https://agent.test/api/agents/reports/referrals", { method: "POST", headers: { host: "agent.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
describe("private referral evidence report snapshots", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true"; m.session.mockResolvedValue({ userId: "own-user", role: "CUSTOMER" }); m.limit.mockReturnValue({ allowed: true }); m.transaction.mockImplementation((fn) => fn(tx)); m.query.mockResolvedValue([{ id: "own-app" }]); m.execute.mockResolvedValue(1); m.find.mockResolvedValue(report); m.list.mockResolvedValue([]); });
  afterEach(() => { process.env = { ...env }; });
  it("rejects anonymous, disabled, throttled, cross-origin and caller-supplied identifiers", async () => {
    m.session.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "false"; expect((await GET()).status).toBe(503);
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true"; m.limit.mockReturnValueOnce({ allowed: false }); expect((await GET()).status).toBe(429);
    expect((await POST(request({ period: "DAILY" }, "https://evil.test"))).status).toBe(403);
    expect((await POST(request({ period: "DAILY", applicationId: "another" }))).status).toBe(400);
    expect((await POST(request({ period: "WEEKLY" }))).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("locks current active status and returns only labelled own snapshots", async () => {
    m.query.mockResolvedValueOnce([]); expect((await POST(request())).status).toBe(403); expect(m.execute).not.toHaveBeenCalled();
    const res = await POST(request()); const data = await res.json();
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toContain("no-store");
    expect(data.scope).toBe("OWN_REFERRAL_EVIDENCE_SNAPSHOT_ONLY"); expect(data.sales).toBe("NOT_CHECKED"); expect(data.commission).toBe("NOT_CHECKED"); expect(data.delivery).toBe("NOT_AVAILABLE");
    expect(data.item.registrationCount).toBe("2"); expect(data.item).not.toHaveProperty("applicationId");
    expect(m.find.mock.calls[0][0].where.applicationId_periodKey.applicationId).toBe("own-app");
  });
  it("refuses malformed cursors before any database access and keyset-pages within the own scope", async () => {
    const get = (cursor: string) => GET(new Request(`https://agent.test/api/agents/reports/referrals?cursor=${cursor}`));
    for (const bad of ["%%%", "not-valid", "eyJlIjoxfQ"]) expect((await get(bad)).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
    const cursor = encodeReportCursor({ endExclusive: new Date("2026-01-02T21:00:00.000Z"), periodKey: "daily:2026-01-02" });
    m.list.mockResolvedValueOnce([report]);
    const res = await get(encodeURIComponent(cursor));
    expect(res.status).toBe(200);
    const where = m.list.mock.calls[0][0].where;
    expect(where.applicationId).toBe("own-app");
    expect(where.OR).toHaveLength(2);
    expect(await res.json()).toMatchObject({ truncated: false, nextCursor: null });
  });
  it("returns an opaque nextCursor only when more own snapshots exist", async () => {
    m.list.mockResolvedValueOnce(Array(101).fill(report)); const data = await (await GET(new Request("https://agent.test/api/agents/reports/referrals"))).json();
    expect(typeof data.nextCursor).toBe("string");
    expect(decodeReportCursor(data.nextCursor)).toEqual({ ok: true, cursor: { endExclusive: report.endExclusive, periodKey: report.periodKey } });
    m.list.mockResolvedValueOnce([report]); expect((await (await GET()).json()).nextCursor).toBeNull();
  });
  it("returns at most 100 records and hides internal errors", async () => {
    m.list.mockResolvedValueOnce(Array(101).fill(report)); const res = await GET(); const data = await res.json();
    expect(data.items).toHaveLength(100); expect(data.truncated).toBe(true); expect(data.items[0]).not.toHaveProperty("applicationId");
    expect(m.list.mock.calls[0][0]).toMatchObject({ where: { applicationId: "own-app" }, take: 101 });
    m.transaction.mockRejectedValueOnce(new Error("private sql")); const failed = await GET(); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private sql");
  });
});
