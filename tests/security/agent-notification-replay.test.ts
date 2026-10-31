import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), replay: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: mocks.limit }));
vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/agents/admin-notification-replay", () => ({ replayAdminNotification: mocks.replay }));
import { POST } from "@/app/api/admin/agents/notification-replay/route";
const old = { ...process.env };
const body = { applicationId: "app", recipientKey: "a".repeat(64), requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const req = (origin = "https://fixture.test", data: unknown = body) => new Request("https://fixture.test/api/admin/agents/notification-replay", { method: "POST", headers: { host: "fixture.test", origin, "content-type": "application/json" }, body: JSON.stringify(data) });
describe("notification replay authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true"; process.env.AGENT_ADMIN_NOTIFICATION_REPLAY_ENABLED = "true"; mocks.session.mockResolvedValue({ userId: "admin", role: "ADMIN" }); mocks.limit.mockReturnValue({ allowed: true }); mocks.replay.mockResolvedValue("created"); });
  afterEach(() => { process.env = { ...old }; });
  it("rejects unauthorized, cross-origin, disabled, malformed and rate-limited requests", async () => {
    expect((await POST(req("https://evil.test"))).status).toBe(403);
    mocks.session.mockResolvedValueOnce(null); expect((await POST(req())).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ userId: "customer", role: "CUSTOMER" }); expect((await POST(req())).status).toBe(403);
    process.env.AGENT_ADMIN_NOTIFICATION_REPLAY_ENABLED = "false"; expect((await POST(req())).status).toBe(503);
    process.env.AGENT_ADMIN_NOTIFICATION_REPLAY_ENABLED = "true"; mocks.limit.mockReturnValueOnce({ allowed: false }); expect((await POST(req())).status).toBe(429);
    expect((await POST(req("https://fixture.test", { ...body, recipientKey: "bad" }))).status).toBe(400);
    expect(mocks.replay).not.toHaveBeenCalled();
  });
  it("handles authoritative role rejection, conflict and idempotent replay without leaking errors", async () => {
    mocks.replay.mockResolvedValueOnce("forbidden"); expect((await POST(req())).status).toBe(403);
    mocks.replay.mockResolvedValueOnce("conflict"); expect((await POST(req())).status).toBe(409);
    mocks.replay.mockResolvedValueOnce("already"); expect(await (await POST(req())).json()).toEqual({ ok: true, alreadyAuthorized: true, deliveryVerified: false });
    mocks.replay.mockRejectedValueOnce(new Error("private")); const res = await POST(req()); expect(res.status).toBe(503); expect(await res.text()).not.toContain("private");
  });
});
