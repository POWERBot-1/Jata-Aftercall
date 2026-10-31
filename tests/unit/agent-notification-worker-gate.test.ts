import { afterEach, describe, expect, it, vi } from "vitest";
import { processAdminNotificationBatch } from "@/lib/agents/admin-notification-worker";
import { applyAdminNotificationCallbacks } from "@/lib/agents/admin-notification-callback";
import { MockMessagingProvider } from "@/lib/messaging/providers";
const old = { ...process.env };
afterEach(() => { process.env = { ...old }; vi.unstubAllEnvs(); });
describe("notification worker fail-closed gates", () => {
  it("never queries or sends when disabled", async () => {
    delete process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED;
    const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn() } as never;
    const provider = new MockMessagingProvider();
    await expect(processAdminNotificationBatch(db, provider)).rejects.toThrow("NOTIFICATION_WORKER_DISABLED");
    expect(provider.sent).toHaveLength(0);
  });
  it("refuses mock providers and unapproved live providers outside tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_LIVE_DELIVERY_APPROVED = "true";
    const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn() } as never;
    const provider = new MockMessagingProvider();
    await expect(processAdminNotificationBatch(db, provider)).rejects.toThrow("NOTIFICATION_PROVIDER_UNAVAILABLE");
    provider.live = true; delete process.env.AGENT_ADMIN_NOTIFICATION_LIVE_DELIVERY_APPROVED;
    await expect(processAdminNotificationBatch(db, provider)).rejects.toThrow("NOTIFICATION_PROVIDER_UNAVAILABLE");
    expect(provider.sent).toHaveLength(0);
    process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED = "true";
    await expect(applyAdminNotificationCallbacks(db, provider, "{}", {})).rejects.toThrow("NOTIFICATION_CALLBACK_UNAVAILABLE");
  });
});
