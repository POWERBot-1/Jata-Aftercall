import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: null as null | { userId: string; role: string }, role: "ADMIN", findMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => m.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: () => ({ allowed: true }) }));
vi.mock("@/lib/db", () => ({ default: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: async () => [{ role: m.role }], agentAdminNotificationAttempt: { findMany: m.findMany } }) } }));
import { GET } from "@/app/api/admin/agents/notification-attempts/route";
const original = process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED;
describe("notification attempt history", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true"; m.session = { userId: "test-admin", role: "ADMIN" }; m.role = "ADMIN"; m.findMany.mockResolvedValue([]); });
  afterEach(() => { if (original === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = original; });
  it("requires an enabled authoritative administrator role", async () => {
    m.session = null; expect((await GET()).status).toBe(401);
    m.session = { userId: "x", role: "CUSTOMER" }; expect((await GET()).status).toBe(403);
    m.session = { userId: "x", role: "ADMIN" }; delete process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED; expect((await GET()).status).toBe(503);
    process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true"; m.role = "CUSTOMER"; expect((await GET()).status).toBe(403); expect(m.findMany).not.toHaveBeenCalled();
  });
  it("bounds the list and events, and does not select message IDs or destinations", async () => {
    m.findMany.mockResolvedValue(Array.from({ length: 101 }, () => ({ applicationId: "synthetic", recipientKey: "a".repeat(64), attempt: 1, outcome: "ACCEPTED", providerKey: "mock", createdAt: new Date(), callbacks: Array.from({ length: 6 }, () => ({ status: "DELIVERED", createdAt: new Date() })) })));
    const response = await GET(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json(); expect(result.items).toHaveLength(100); expect(result.truncated).toBe(true); expect(result.deliveryVerified).toBe(false); expect(result.items[0].callbacks).toHaveLength(5); expect(result.items[0].callbackTruncated).toBe(true);
    const query = JSON.stringify(m.findMany.mock.calls[0][0]); expect(query).not.toContain("messageId"); expect(query).not.toContain("destination");
  });
});
