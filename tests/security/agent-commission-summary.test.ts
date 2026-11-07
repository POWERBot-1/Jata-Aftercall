import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  agentFind: vi.fn(),
  query: vi.fn(),
  monthly: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
vi.mock("@/lib/agents/commission-accrual", () => ({ getAgentMonthlyCommissionEligibility: mocks.monthly }));

import { GET } from "@/app/api/agents/commissions/summary/route";
const env = { ...process.env };
const accrualMinor = BigInt("90071992547409930000");
const reversalMinor = BigInt(50);
const netMinor = BigInt("90071992547409929950");

describe("own agent commission summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_COMMISSION_SUMMARY_ENABLED = "true";
    mocks.session.mockResolvedValue({ userId: "agent-a" });
    mocks.agentFind.mockResolvedValue({
      id: "application-a", status: "PENDING", agentStatus: "ACTIVE", phoneVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    });
    mocks.query.mockResolvedValue([{
      entryCount: "2", accrualMinor: accrualMinor.toString(), reversalMinor: "-50", netMinor: netMinor.toString(),
    }]);
    mocks.monthly.mockResolvedValue({
      eligible: true, month: "2026-11", qualifyingPlanSales: 10, minimumMonthlyPlanSales: 10,
      accruedMinor: accrualMinor, reversedMinor: reversalMinor, payableMinor: netMinor,
    });
    mocks.transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => work({
      agentApplication: { findUnique: mocks.agentFind },
      $queryRaw: mocks.query,
    }));
  });
  afterEach(() => { process.env = { ...env }; });

  it("blocks anonymous, default-off and non-active requests", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);

    delete process.env.AGENT_COMMISSION_SUMMARY_ENABLED;
    expect((await GET()).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();

    process.env.AGENT_COMMISSION_SUMMARY_ENABLED = "true";
    mocks.agentFind.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns exact own-ledger totals and the recomputed monthly payment threshold", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      scope: "OWN_AGENT_LEDGER",
      currency: "KES",
      entryCount: "2",
      accrualMinor: accrualMinor.toString(),
      reversalMinor: "-50",
      netMinor: netMinor.toString(),
      month: "2026-11",
      qualifyingPlanSales: 10,
      minimumMonthlyPlanSales: 10,
      eligibleForPayment: true,
      monthlyAccruedMinor: accrualMinor.toString(),
      monthlyReversedMinor: reversalMinor.toString(),
      monthlyNetAccruedMinor: netMinor.toString(),
      payoutEligibleMinor: netMinor.toString(),
      verification: "LOCAL_PROVIDER_VERIFIED_SETTLEMENT_RECORDS",
      payout: "NOT_AVAILABLE_NO_TRANSFER_EXECUTED",
    });
    expect(mocks.agentFind).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "agent-a" } }));
    const [sql, userId] = mocks.query.mock.calls[0];
    expect(userId).toBe("agent-a");
    expect(sql.join("?")).toContain('WHERE a."userId" = ?');
    expect(sql.join("?")).toContain('a."agentStatus" = \'ACTIVE\'');
    expect(mocks.monthly).toHaveBeenCalledWith(expect.any(Object), "application-a");
  });

  it("fails closed on malformed or inconsistent aggregates and hides internal errors", async () => {
    const invalidRows = [
      { entryCount: "1", accrualMinor: "3.0", reversalMinor: "0", netMinor: "3" },
      { entryCount: "2", accrualMinor: "3", reversalMinor: "-4", netMinor: "-1" },
      { entryCount: "2", accrualMinor: "3", reversalMinor: "-1", netMinor: "3" },
      { entryCount: "0", accrualMinor: "3", reversalMinor: "-1", netMinor: "2" },
    ];
    for (const row of invalidRows) {
      mocks.query.mockResolvedValueOnce([row]);
      expect((await GET()).status).toBe(503);
    }
    mocks.query.mockRejectedValueOnce(new Error("secret connection detail"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
