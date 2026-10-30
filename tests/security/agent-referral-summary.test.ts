import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $queryRaw: mocks.query } }));
import { GET } from "@/app/api/agents/referrals/summary/route";
const original = { ...process.env };
describe("agent registration referral summary", () => {
  beforeEach(() => { vi.resetAllMocks(); delete process.env.AGENT_REGISTRATION_REFERRALS_ENABLED; delete process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS; });
  afterEach(() => { process.env = { ...original }; });
  it("rejects anonymous or disabled requests before database access", async () => {
    mocks.session.mockResolvedValueOnce(null).mockResolvedValue({ userId: "user-a" });
    expect((await GET()).status).toBe(401);
    expect((await GET()).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("uses only the current session for an active-owner aggregate and returns no private records", async () => {
    process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600";
    mocks.session.mockResolvedValue({ userId: "user-a" }); mocks.query.mockResolvedValue([{ registrationCount: 3 }]);
    const response = await GET();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ registrationCount: 3 });
    expect(mocks.query.mock.calls[0][1]).toBe("user-a");
    const sql = mocks.query.mock.calls[0][0].join("?");
    expect(sql).toContain('a."userId" = ?'); expect(sql).toContain('a."agentStatus" = \'ACTIVE\'');
    expect(sql).not.toMatch(/email|phone|tokenHash/i);
  });
  it("denies non-active accounts and fails closed for invalid data or errors", async () => {
    process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600";
    mocks.session.mockResolvedValue({ userId: "user-a" });
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ registrationCount: -1 }]).mockRejectedValueOnce(new Error("sensitive error"));
    expect((await GET()).status).toBe(403);
    expect((await GET()).status).toBe(503);
    const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("sensitive error");
  });
});
