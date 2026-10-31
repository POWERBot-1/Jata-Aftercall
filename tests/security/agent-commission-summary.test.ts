import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $queryRaw: mocks.query } }));
import { GET } from "@/app/api/agents/commissions/summary/route";
const env = { ...process.env };

describe("own commission ledger storage summary", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_COMMISSION_SUMMARY_ENABLED = "true"; mocks.session.mockResolvedValue({ userId: "agent-a" }); mocks.query.mockResolvedValue([{ entryCount: "2", accrualMinor: "90071992547409930000", reversalMinor: "-50", netMinor: "90071992547409929950" }]); });
  afterEach(() => { process.env = { ...env }; });
  it("blocks anonymous, default-off and non-active requests", async () => {
    mocks.session.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    delete process.env.AGENT_COMMISSION_SUMMARY_ENABLED; expect((await GET()).status).toBe(503); expect(mocks.query).not.toHaveBeenCalled();
    process.env.AGENT_COMMISSION_SUMMARY_ENABLED = "true"; mocks.query.mockResolvedValueOnce([]); expect((await GET()).status).toBe(403);
  });
  it("returns precise strings and explicitly disclaims verification, entitlement and payouts", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ scope: "OWN_LEDGER_STORAGE_ONLY", currency: "KES", entryCount: "2", accrualMinor: "90071992547409930000", reversalMinor: "-50", netMinor: "90071992547409929950", verification: "NOT_CHECKED", entitlement: "NOT_DETERMINED", payout: "NOT_AVAILABLE" });
    const [sql, userId] = mocks.query.mock.calls[0];
    expect(userId).toBe("agent-a");
    expect(sql.join("?")).toContain('a."userId" = ?');
    expect(sql.join("?")).toContain('a."agentStatus" = \'ACTIVE\'');
  });
  it("fails closed on malformed or inconsistent aggregates and hides internal errors", async () => {
    for (const row of [ { entryCount: "1", accrualMinor: "3.0", reversalMinor: "0", netMinor: "3" }, { entryCount: "2", accrualMinor: "3", reversalMinor: "-4", netMinor: "-1" }, { entryCount: "2", accrualMinor: "3", reversalMinor: "-1", netMinor: "3" }, { entryCount: "0", accrualMinor: "3", reversalMinor: "-1", netMinor: "2" } ]) {
      mocks.query.mockResolvedValueOnce([row]); expect((await GET()).status).toBe(503);
    }
    mocks.query.mockRejectedValueOnce(new Error("secret connection detail")); const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
