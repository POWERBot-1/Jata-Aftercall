import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { agentApplication: { findUnique: mocks.find } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: (path: string) => { throw Object.assign(new Error("redirect"), { path }); } }));
import AgentDashboardPage from "@/app/agents/dashboard/page";

const originalEnv = { ...process.env };
describe("personal agent application status", () => {
  afterEach(() => { process.env = { ...originalEnv }; });
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "account-a" }); mocks.find.mockResolvedValue(null); });
  it("redirects anonymous visitors without querying private applications", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(AgentDashboardPage()).rejects.toMatchObject({ path: "/login?next=agents" });
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("reads only the signed-in account and does not present invented sales data", async () => {
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "PENDING", createdAt: new Date("2026-10-29T10:00:00Z") });
    const html = renderToStaticMarkup(await AgentDashboardPage());
    expect(mocks.find).toHaveBeenCalledWith({ where: { userId: "account-a" }, select: { fullName: true, status: true, agentStatus: true, createdAt: true, phoneVerifiedAt: true } });
    expect(html).toContain("Awaiting verification");
    expect(html).toContain("not available yet");
    expect(html).not.toContain("Active agent");
  });
  it("renders reviewed states without exposing other accounts or claiming commissions", async () => {
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "PENDING", agentStatus: "ACTIVE", createdAt: new Date("2026-10-29T10:00:00Z"), phoneVerifiedAt: new Date() });
    expect(renderToStaticMarkup(await AgentDashboardPage())).toContain("Active after administrator review");
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "PENDING", agentStatus: "SUSPENDED", createdAt: new Date("2026-10-29T10:00:00Z"), phoneVerifiedAt: new Date() });
    expect(renderToStaticMarkup(await AgentDashboardPage())).toContain("Agent access suspended");
  });
  it("shows registration evidence only to an active account when explicitly enabled", async () => {
    process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600";
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "PENDING", agentStatus: "ACTIVE", createdAt: new Date("2026-10-29T10:00:00Z"), phoneVerifiedAt: new Date() });
    const active = renderToStaticMarkup(await AgentDashboardPage());
    expect(active).toContain("Consented registration referrals");
    expect(active).toContain("not verified sales or commission eligibility");
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "PENDING", agentStatus: "SUSPENDED", createdAt: new Date("2026-10-29T10:00:00Z"), phoneVerifiedAt: new Date() });
    expect(renderToStaticMarkup(await AgentDashboardPage())).not.toContain("Consented registration referrals");
    delete process.env.AGENT_REGISTRATION_REFERRALS_ENABLED;
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "PENDING", agentStatus: "ACTIVE", createdAt: new Date("2026-10-29T10:00:00Z"), phoneVerifiedAt: new Date() });
    expect(renderToStaticMarkup(await AgentDashboardPage())).not.toContain("Consented registration referrals");
  });
  it("distinguishes rejected and missing applications, and fails safely on storage errors", async () => {
    mocks.find.mockResolvedValue({ fullName: "A Person", status: "REJECTED", createdAt: new Date("2026-10-29T10:00:00Z") });
    expect(renderToStaticMarkup(await AgentDashboardPage())).toContain("Application rejected");
    mocks.find.mockResolvedValue(null);
    expect(renderToStaticMarkup(await AgentDashboardPage())).toContain("No application is recorded");
    mocks.find.mockRejectedValue(new Error("private database details"));
    const html = renderToStaticMarkup(await AgentDashboardPage());
    expect(html).toContain("We could not load your application");
    expect(html).not.toContain("private database details");
  });
});
