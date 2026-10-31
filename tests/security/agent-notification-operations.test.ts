import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), transaction: vi.fn(), query: vi.fn(), list: vi.fn(), find: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: mocks.limit }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
import { GET, POST } from "@/app/api/admin/agents/notification-operations/route";
const env = { ...process.env };
const tx = { $queryRaw: mocks.query, agentAdminNotificationClaimState: { findMany: mocks.list }, agentAdminNotificationReview: { findUnique: mocks.find, create: mocks.create }, auditEvent: { create: mocks.audit } };
const valid = { applicationId: "app-1", recipientKey: "a".repeat(64), action: "ACKNOWLEDGE_NO_RETRY" };
const request = (body: unknown = valid, origin = "https://agent.test") => new Request("https://agent.test/api/admin/agents/notification-operations", { method: "POST", headers: { host: "agent.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
describe("admin notification operator acknowledgements", () => {
  beforeEach(() => {
    vi.clearAllMocks(); process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true";
    mocks.session.mockResolvedValue({ userId: "admin", role: "ADMIN" }); mocks.limit.mockReturnValue({ allowed: true });
    mocks.transaction.mockImplementation((fn) => fn(tx)); mocks.query.mockResolvedValue([{ role: "ADMIN" }]); mocks.find.mockResolvedValue(null); mocks.list.mockResolvedValue([]);
  });
  afterEach(() => { process.env = { ...env }; });
  it("rejects anonymous, non-admin, disabled, rate-limited and cross-origin access", async () => {
    mocks.session.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ userId: "user", role: "CUSTOMER" }); expect((await GET()).status).toBe(403);
    process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "false"; expect((await GET()).status).toBe(503);
    process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true"; mocks.limit.mockReturnValueOnce({ allowed: false }); expect((await GET()).status).toBe(429);
    expect((await POST(request(valid, "https://evil.test"))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("bounds the private queue and rechecks authoritative roles", async () => {
    mocks.query.mockResolvedValueOnce([{ role: "CUSTOMER" }]); expect((await GET()).status).toBe(403); expect(mocks.list).not.toHaveBeenCalled();
    mocks.list.mockResolvedValueOnce(Array(101).fill({ applicationId: "fixture", recipientKey: "a".repeat(64), state: "UNKNOWN", attempts: 1 }));
    const response = await GET(); const data = await response.json();
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(data.items).toHaveLength(100); expect(data.truncated).toBe(true); expect(data.deliveryVerified).toBe(false);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ take: 101, where: { state: { in: ["UNKNOWN", "DEAD"] }, review: { is: null } } }));
  });
  it("only acknowledges terminal uncertain/dead items, without retrying or asserting delivery", async () => {
    expect((await POST(request({ ...valid, action: "RETRY" }))).status).toBe(400);
    expect((await POST(request({ ...valid, recipientKey: "../../bad" }))).status).toBe(400);
    mocks.query.mockResolvedValueOnce([{ role: "CUSTOMER" }]); expect((await POST(request())).status).toBe(403);
    mocks.query.mockResolvedValueOnce([{ role: "ADMIN" }]).mockResolvedValueOnce([{ state: "CLAIMED" }]); expect((await POST(request())).status).toBe(409);
    mocks.query.mockResolvedValueOnce([{ role: "ADMIN" }]).mockResolvedValueOnce([{ state: "UNKNOWN" }]);
    const response = await POST(request()); expect(await response.json()).toEqual({ ok: true, alreadyReviewed: false, action: "ACKNOWLEDGE_NO_RETRY", deliveryVerified: false });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][0].data).toEqual({ applicationId: "app-1", recipientKey: valid.recipientKey, reviewedState: "UNKNOWN", reviewedBy: "admin" });
  });
  it("is idempotent and hides database errors", async () => {
    mocks.query.mockResolvedValueOnce([{ role: "ADMIN" }]).mockResolvedValueOnce([{ state: "DEAD" }]); mocks.find.mockResolvedValueOnce({});
    expect((await (await POST(request())).json()).alreadyReviewed).toBe(true); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
    mocks.transaction.mockRejectedValueOnce(new Error("private database string")); const res = await GET(); expect(res.status).toBe(503); expect(await res.text()).not.toContain("private database string");
  });
});
