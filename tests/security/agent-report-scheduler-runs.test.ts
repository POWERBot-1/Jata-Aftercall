import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), transaction: vi.fn(), role: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: m.limit }));
vi.mock("@/lib/db", () => ({ default: { $transaction: m.transaction } }));
import { GET } from "@/app/api/admin/agents/report-scheduler-runs/route";
const env = { ...process.env };
const tx = { $queryRaw: m.role, agentReferralReportScheduleRun: { findMany: m.list } };
describe("administrator-only referral scheduler history", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_REFERRAL_REPORT_OPERATIONS_ENABLED = "true"; m.session.mockResolvedValue({ userId: "admin", role: "ADMIN" }); m.limit.mockReturnValue({ allowed: true }); m.transaction.mockImplementation((fn) => fn(tx)); m.role.mockResolvedValue([{ role: "ADMIN" }]); m.list.mockResolvedValue([]); });
  afterEach(() => { process.env = { ...env }; });
  it("rejects anonymous, non-admin, disabled and throttled requests", async () => {
    m.session.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    m.session.mockResolvedValueOnce({ userId: "other", role: "CUSTOMER" }); expect((await GET()).status).toBe(403);
    process.env.AGENT_REFERRAL_REPORT_OPERATIONS_ENABLED = "false"; expect((await GET()).status).toBe(503);
    process.env.AGENT_REFERRAL_REPORT_OPERATIONS_ENABLED = "true"; m.limit.mockReturnValueOnce({ allowed: false }); expect((await GET()).status).toBe(429); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("rechecks database role, bounds results, and hides database errors", async () => {
    m.role.mockResolvedValueOnce([{ role: "CUSTOMER" }]); expect((await GET()).status).toBe(403); expect(m.list).not.toHaveBeenCalled();
    m.list.mockResolvedValueOnce(Array(101).fill({ status: "RUNNING" })); const response = await GET(); const data = await response.json();
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(data.items).toHaveLength(100); expect(data.truncated).toBe(true); expect(data.delivery).toBe("NOT_AVAILABLE");
    m.transaction.mockRejectedValueOnce(new Error("private sql")); const failed = await GET(); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private sql");
  });
});
