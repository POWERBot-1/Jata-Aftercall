import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ batch: vi.fn(), recover: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/agents/referral-report-scheduler-run", () => ({ runReferralReportBatch: m.batch, recoverStaleReferralReportRuns: m.recover }));
import { GET } from "@/app/api/cron/agent-referral-reports/route";
import { reportScheduleStart } from "@/lib/agents/referral-report-scheduler";
const env = { ...process.env };
const secret = "synthetic-secret-only-012345678901234567890123456789";
const request = (auth = `Bearer ${secret}`) => new Request("https://agent.test/api/cron/agent-referral-reports", { headers: { authorization: auth } });
describe("disabled report scheduler entry point", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_REFERRAL_REPORT_SCHEDULER_ENABLED = "true"; process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true"; process.env.AGENT_REFERRAL_REPORT_SCHEDULE_START_DAY = "2026-01-01"; process.env.AGENT_REFERRAL_REPORT_SCHEDULER_SECRET = secret; m.recover.mockResolvedValue(0); m.batch.mockResolvedValue({ status: "CAUGHT_UP", processed: 0 }); });
  afterEach(() => { process.env = { ...env }; });
  it("requires an explicit valid first-of-month start and does not silently backfill", () => {
    for (const value of [undefined, "", "2026-02-02", "2026-13-01", "2026-01-01z", "2026-02-30"]) expect(reportScheduleStart(value)).toBeNull();
    expect(reportScheduleStart("2026-01-01")?.toISOString()).toBe("2025-12-31T21:00:00.000Z");
  });
  it("does not transact when disabled, misconfigured or unauthorized", async () => {
    delete process.env.AGENT_REFERRAL_REPORT_SCHEDULER_ENABLED; expect((await GET(request())).status).toBe(503);
    process.env.AGENT_REFERRAL_REPORT_SCHEDULER_ENABLED = "true"; delete process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED; expect((await GET(request())).status).toBe(503);
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true"; process.env.AGENT_REFERRAL_REPORT_SCHEDULER_SECRET = "short"; expect((await GET(request())).status).toBe(503);
    process.env.AGENT_REFERRAL_REPORT_SCHEDULER_SECRET = secret; expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(m.batch).not.toHaveBeenCalled(); expect(m.recover).not.toHaveBeenCalled();
  });
  it("runs bounded independent period transactions and reports no delivery", async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json(); expect(body.delivery).toBe("NOT_AVAILABLE"); expect(body.recoveredRuns).toBe(0); expect(m.recover).toHaveBeenCalledTimes(1); expect(m.batch).toHaveBeenCalledTimes(2);
    expect(m.batch.mock.calls.map((c) => c[1])).toEqual(["DAILY", "MONTHLY"]);
    m.batch.mockRejectedValueOnce(new Error("private sql")); const failed = await GET(request()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private sql");
  });
  it("attempts the other period when either batch fails without leaking its error", async () => {
    for (const failedPeriod of ["DAILY", "MONTHLY"]) {
      m.batch.mockReset();
      m.batch.mockImplementation(async (_db, period) => {
        if (period === failedPeriod) throw new Error("private SQL or connection details");
        return { status: "CAUGHT_UP", processed: 0 };
      });
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private SQL");
      expect(m.batch.mock.calls.map((c) => c[1])).toEqual(["DAILY", "MONTHLY"]);
    }
  });
  it("does not start batches if stale-run recovery fails", async () => {
    m.recover.mockRejectedValueOnce(new Error("private recovery details"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private recovery");
    expect(m.batch).not.toHaveBeenCalled();
  });

});
