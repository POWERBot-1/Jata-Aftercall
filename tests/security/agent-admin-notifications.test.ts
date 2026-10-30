import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/adminGuard", () => ({ requireAdminPage: async () => ({ userId: "admin" }) }));
vi.mock("@/lib/db", () => ({ default: { user: { findUnique: async () => ({ role: "ADMIN" }) }, agentApplication: { findMany: async () => [] } } }));
import AgentApplications from "@/app/admin/agents/page";
const old = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS;
afterEach(() => { if (old === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS; else process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = old; });

describe("admin notification readiness presentation", () => {
  it("shows a generic readiness state without rendering recipient values or claiming delivery", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
    const html = renderToStaticMarkup(await AgentApplications({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Recipient configuration is present");
    expect(html).toContain("notifications are not sent");
    expect(html).not.toContain("0700000001"); expect(html).not.toContain("0700000002");
    expect(html).not.toContain("254700000001");
  });
});
