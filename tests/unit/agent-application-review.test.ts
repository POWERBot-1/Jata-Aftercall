import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), transaction: vi.fn(), actor: vi.fn(), application: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
import { POST } from "@/app/api/admin/agents/applications/[id]/reject/route";

function request(body: unknown = { reason: "APPLICANT_REQUEST" }, origin = "https://example.test") {
  return new Request("https://example.test/api/admin/agents/applications/a1/reject", { method: "POST", headers: { host: "example.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ id: "a1" }) };

describe("agent application rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
    mocks.actor.mockResolvedValue({ role: "ADMIN" });
    mocks.application.mockResolvedValue({ userId: "applicant-1", status: "PENDING", agentStatus: "INACTIVE" });
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.audit.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn) => fn({ user: { findUnique: mocks.actor }, agentApplication: { findUnique: mocks.application, updateMany: mocks.update }, auditEvent: { create: mocks.audit } }));
  });
  it("requires same-origin and an administrator session", async () => {
    expect((await POST(request({}, "https://evil.test"), params)).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(), params)).status).toBe(401);
    mocks.session.mockResolvedValue({ userId: "user", role: "CUSTOMER" });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("checks the current database role and disallows self-review", async () => {
    mocks.actor.mockResolvedValue({ role: "CUSTOMER" });
    expect((await POST(request(), params)).status).toBe(403);
    mocks.actor.mockResolvedValue({ role: "ADMIN" });
    mocks.application.mockResolvedValue({ userId: "admin-1", status: "PENDING", agentStatus: "INACTIVE" });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("records a conditional transition and audit together", async () => {
    expect((await POST(request(), params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "a1", status: "PENDING", agentStatus: "INACTIVE" }, data: { status: "REJECTED" } });
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("is idempotent and does not duplicate audits on retries", async () => {
    mocks.application.mockResolvedValue({ userId: "applicant-1", status: "REJECTED", agentStatus: "INACTIVE" });
    expect((await POST(request(), params)).status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects arbitrary reasons and fails closed on storage errors", async () => {
    expect((await POST(request({ reason: "unapproved free text" }), params)).status).toBe(400);
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request(), params)).status).toBe(503);
  });
});
