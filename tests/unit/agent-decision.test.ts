import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mock.session }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mock.transaction } }));
import { POST } from "@/app/api/admin/agents/applications/[id]/decision/route";
const env = { ...process.env };
const params = Promise.resolve({ id: "fixture" });
const req = (body: unknown, origin = "https://example.test") => new Request("https://example.test/api/admin/agents/applications/fixture/decision", { method: "POST", headers: { host: "example.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
describe("agent review authorization", () => {
  beforeEach(() => { vi.resetAllMocks(); delete process.env.AGENT_ACTIVATION_ENABLED; });
  afterEach(() => { process.env = { ...env }; });
  it("rejects cross-origin, signed-out and non-admin requests before storage", async () => {
    expect((await POST(req({}, "https://evil.test"), { params })).status).toBe(403);
    mock.session.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: "u", role: "CUSTOMER" });
    expect((await POST(req({}), { params })).status).toBe(401);
    expect((await POST(req({}), { params })).status).toBe(403);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it("keeps approval disabled and rejects unapproved actions and reasons", async () => {
    mock.session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
    expect((await POST(req({ action: "approve", reason: "MANUAL_ELIGIBILITY_REVIEW" }), { params })).status).toBe(503);
    expect((await POST(req({ action: "reinstate", reason: "COMPLIANCE_REVIEW" }), { params })).status).toBe(400);
    expect((await POST(req({ action: "suspend", reason: "other" }), { params })).status).toBe(400);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
