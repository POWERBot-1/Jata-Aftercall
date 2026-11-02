/**
 * Access control for the agent referral report PAGE (server component), rendered with mocked
 * session and database. This proves the refusal states disclose nothing; the real browser journey
 * in scripts/browser/agent-reports.check.mjs proves the same against the running application.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/db", () => ({ default: { agentApplication: { findUnique: m.findUnique } } }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
}));

import AgentReportsPage from "@/app/agents/reports/page";

const env = { ...process.env };
const render = async () => renderToStaticMarkup(await AgentReportsPage());

describe("agent referral report page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true";
  });
  afterEach(() => { process.env = { ...env }; });

  it("sends an anonymous visitor to sign-in before reading anything", async () => {
    m.session.mockResolvedValueOnce(null);
    await expect(AgentReportsPage()).rejects.toThrow("NEXT_REDIRECT:/login?next=agents");
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN who has no active agent application, with no report data and no admin read path", async () => {
    m.session.mockResolvedValueOnce({ userId: "admin-user", role: "ADMIN", email: "a@test.invalid" });
    m.findUnique.mockResolvedValueOnce(null);
    const html = await render();
    expect(html).toContain("An active agent account is required");
    expect(html).not.toContain("Load older snapshots");
    expect(html).not.toContain("Referral evidence by completed period");
    // Lookup is keyed only on the caller's own user id; no other agent is selected.
    expect(m.findUnique.mock.calls[0][0]).toEqual({ where: { userId: "admin-user" }, select: { status: true, agentStatus: true } });
  });

  it("refuses a suspended or rejected agent the same way", async () => {
    m.session.mockResolvedValueOnce({ userId: "u1", role: "CUSTOMER", email: "b@test.invalid" });
    m.findUnique.mockResolvedValueOnce({ status: "PENDING", agentStatus: "SUSPENDED" });
    expect(await render()).toContain("An active agent account is required");
  });

  it("says the feature is off, without fetching anything, when the switch is disabled", async () => {
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "false";
    m.session.mockResolvedValueOnce({ userId: "u1", role: "CUSTOMER", email: "c@test.invalid" });
    m.findUnique.mockResolvedValueOnce({ status: "PENDING", agentStatus: "ACTIVE" });
    const html = await render();
    expect(html).toContain("not switched on");
    expect(html).not.toContain("Referral evidence by completed period");
  });

  it("renders the authorised loading shell for an active agent, without any other agent's data", async () => {
    m.session.mockResolvedValueOnce({ userId: "u1", role: "CUSTOMER", email: "d@test.invalid" });
    m.findUnique.mockResolvedValueOnce({ status: "PENDING", agentStatus: "ACTIVE" });
    const html = await render();
    expect(html).toContain("Referral evidence by completed period");
    expect(html).toContain("Loading your referral report snapshots");
    expect(html).not.toMatch(/applicationId|phoneE164|fullName/);
  });

  it("shows a safe message when the eligibility lookup fails", async () => {
    m.session.mockResolvedValueOnce({ userId: "u1", role: "CUSTOMER", email: "e@test.invalid" });
    m.findUnique.mockRejectedValueOnce(new Error("connection string postgresql://secret@db"));
    const html = await render();
    expect(html).toContain("We could not check your agent access");
    expect(html).not.toContain("postgresql://");
  });
});
