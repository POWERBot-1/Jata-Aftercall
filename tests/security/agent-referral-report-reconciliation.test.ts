import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), transaction: vi.fn(), query: vi.fn(), prior: vi.fn(), current: vi.fn(), create: vi.fn(), execute: vi.fn(), one: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: m.limit }));
vi.mock("@/lib/db", () => ({ default: { $transaction: m.transaction } }));
import { GET, POST } from "@/app/api/agents/reports/referrals/reconcile/route";
const env = { ...process.env };
const date = new Date("2026-01-01T12:00:00Z");
const tx = { $queryRaw: m.query, $executeRaw: m.execute, agentReferralReportRevision: { findFirst: m.prior, findUnique: m.one, create: m.create }, agentReferralAttribution: { findMany: m.current } };
const request = (body: unknown = { periodKey: "daily:2026-01-01" }, origin = "https://agent.test") => new Request("https://agent.test/api/agents/reports/referrals/reconcile", { method: "POST", headers: { host: "agent.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const prior = { revision: 1, registrationCount: BigInt(1), existingApplicationCount: BigInt(0), members: [{ eventId: "event-1", source: "REGISTRATION", eventCreatedAt: date }] };
describe("own-agent referral report reconciliation", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true"; process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED = "true"; m.session.mockResolvedValue({ userId: "own-user" }); m.limit.mockReturnValue({ allowed: true }); m.transaction.mockImplementation((fn) => fn(tx)); m.query.mockResolvedValueOnce([{ id: "own-app" }]).mockResolvedValueOnce([{ startInclusive: date, endExclusive: new Date("2026-01-02T12:00:00Z") }]); m.prior.mockResolvedValue(prior); m.current.mockResolvedValue([{ id: "event-1", source: "REGISTRATION", createdAt: date }]); });
  afterEach(() => { process.env = { ...env }; });
  it("rejects unauthenticated, disabled, cross-origin, malformed and cross-tenant requests", async () => {
    m.session.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(401);
    process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED = "false"; expect((await POST(request())).status).toBe(503); process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED = "true";
    expect((await POST(request({}, "https://evil.test"))).status).toBe(403);
    expect((await POST(request({ periodKey: "daily:2026-01-01", applicationId: "other" }))).status).toBe(400);
    expect((await POST(request({ periodKey: "../../bad" }))).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("keeps unchanged membership idempotent and labels financial claims unchecked", async () => {
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toMatchObject({ status: "UNCHANGED", revision: 1, added: 0, removed: 0, changed: 0, sales: "NOT_CHECKED", commission: "NOT_CHECKED" });
    expect(m.create).not.toHaveBeenCalled(); expect(JSON.stringify(body)).not.toContain("event-1");
  });
  it("inspects a revision's evidence only after authorizing the current agent", async () => {
    m.query.mockReset(); m.query.mockResolvedValueOnce([{ id: "own-app" }]).mockResolvedValueOnce([{ status: "RECONCILIATION_REQUIRED" }]);
    m.one.mockResolvedValueOnce({ ...prior, kind: "BASELINE", createdAt: date, addedCount: 0, removedCount: 0, changedCount: 0 });
    const response = await GET(new Request("https://agent.test/api/agents/reports/referrals/reconcile?periodKey=daily%3A2026-01-01&revision=1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evidenceStatus).toBe("RECONCILIATION_REQUIRED");
    expect(body.commission).toBe("NOT_CHECKED");
    expect(m.one.mock.calls[0][0].where.applicationId_periodKey_revision.applicationId).toBe("own-app");
    expect(m.execute).toHaveBeenCalledOnce();
  });
  it("paginates large retained revisions only within the authenticated agent", async () => {
    m.query.mockReset(); m.query.mockResolvedValueOnce([{ id: "own-app" }]).mockResolvedValueOnce([{ status: "MATCHED" }]);
    const members = Array.from({ length: 5001 }, (_, i) => ({ eventId: `event-${String(i).padStart(5, "0")}`, source: "REGISTRATION", eventCreatedAt: date }));
    m.one.mockResolvedValueOnce({ ...prior, members, kind: "BASELINE", createdAt: date, addedCount: 0, removedCount: 0, changedCount: 0 });
    const response = await GET(new Request("https://agent.test/api/agents/reports/referrals/reconcile?periodKey=daily%3A2026-01-01&revision=1&after=event-00000"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.members).toHaveLength(5000);
    expect(body.nextCursor).toBe("event-04999");
    expect(body.sales).toBe("NOT_CHECKED");
    expect(m.one.mock.calls[0][0]).toMatchObject({ where: { applicationId_periodKey_revision: { applicationId: "own-app" } }, include: { members: { where: { eventId: { gt: "event-00000" } }, take: 5001 } } });
  });
  it("rejects duplicate, malformed or cross-tenant pagination parameters", async () => {
    const base = "https://agent.test/api/agents/reports/referrals/reconcile?periodKey=daily%3A2026-01-01&revision=1";
    for (const extra of ["&after=", "&after=../bad", "&after=x&after=y", "&applicationId=other"]) expect((await GET(new Request(base + extra))).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("fails closed for legacy snapshots or unbounded membership", async () => {
    m.prior.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(409); expect(m.current).not.toHaveBeenCalled();
    m.query.mockResolvedValueOnce([{ id: "own-app" }]).mockResolvedValueOnce([{ startInclusive: date, endExclusive: new Date("2026-01-02T12:00:00Z") }]);
    m.prior.mockResolvedValueOnce({ ...prior, members: Array(5001).fill(prior.members[0]) }); expect((await POST(request())).status).toBe(409); expect(m.create).not.toHaveBeenCalled();
  });
});
