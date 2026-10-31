import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ work: vi.fn(), callbacks: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/agents/admin-notification-worker", () => ({ processAdminNotificationBatch: m.work }));
vi.mock("@/lib/agents/admin-notification-callback", () => ({ applyAdminNotificationCallbacks: m.callbacks }));
vi.mock("@/lib/messaging/providers", () => ({ getMessagingProvider: m.provider }));
import { POST as worker } from "@/app/api/cron/agent-notification-worker/route";
import { POST as callback } from "@/app/api/webhooks/agent-admin-notifications/route";
const original = { ...process.env };
const secret = "synthetic-worker-secret-01234567890123456789";
const request = (auth = `Bearer ${secret}`) => new Request("https://agent.test/api/cron/agent-notification-worker", { method: "POST", headers: { authorization: auth } });
describe("notification worker and callback boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED = "true"; process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = "true"; process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED = "true"; process.env.AGENT_ADMIN_NOTIFICATION_WORKER_SECRET = secret; process.env.AGENT_ADMIN_NOTIFICATION_PROVIDER = "mock"; m.provider.mockReturnValue({ key: "mock" }); m.work.mockResolvedValue({ processed: 0, expired: 0, deliveryVerified: false }); m.callbacks.mockResolvedValue({ acceptedEvents: 1, verifiedDelivery: false }); });
  afterEach(() => { process.env = { ...original }; });
  it("does not invoke a provider or worker when disabled, misconfigured or unauthenticated", async () => {
    delete process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED; expect((await worker(request())).status).toBe(503);
    process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED = "true"; process.env.AGENT_ADMIN_NOTIFICATION_WORKER_SECRET = "short"; expect((await worker(request())).status).toBe(503);
    process.env.AGENT_ADMIN_NOTIFICATION_WORKER_SECRET = secret; expect((await worker(request("Bearer invalid"))).status).toBe(401);
    expect(m.provider).not.toHaveBeenCalled(); expect(m.work).not.toHaveBeenCalled();
    const response = await worker(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store"); expect(m.work).toHaveBeenCalledTimes(1);
  });
  it("rejects disabled, oversized, malformed and unauthenticated callbacks without leaking errors", async () => {
    const req = (body: BodyInit) => new Request("https://agent.test/api/webhooks/agent-admin-notifications", { method: "POST", body });
    delete process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED; expect((await callback(req("{}"))).status).toBe(503); expect(m.provider).not.toHaveBeenCalled();
    process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED = "true"; expect((await callback(req("x".repeat(65537)))).status).toBe(413);
    expect((await callback(req(new Uint8Array([0xff])))).status).toBe(400);
    m.callbacks.mockRejectedValueOnce(new Error("NOTIFICATION_CALLBACK_UNAUTHORIZED")); expect((await callback(req("{}"))).status).toBe(401);
    m.callbacks.mockRejectedValueOnce(new Error("private-provider-error")); const result = await callback(req("{}")); expect(result.status).toBe(503); expect(await result.text()).not.toContain("private-provider-error");
    expect((await callback(req("{}"))).status).toBe(200);
  });
});
