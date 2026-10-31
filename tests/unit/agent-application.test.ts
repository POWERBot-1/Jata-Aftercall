import { describe, expect, it, vi, beforeEach } from "vitest";
import { isSameOriginRequest, validateAgentApplication } from "@/lib/agent-application";

const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), create: vi.fn(), audit: vi.fn(), transaction: vi.fn(), allowed: vi.fn() }));
vi.mock("@/lib/agent-application-throttle", () => ({ allowAgentApplication: mocks.allowed }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { agentApplication: { findUnique: mocks.find }, $transaction: mocks.transaction } }));
import { GET, POST } from "@/app/api/agents/application/route";

const valid = { fullName: "Jane Doe", phone: "0712 345 678", privacyAccepted: true };
function request(body: unknown, origin = "https://example.test") {
  return new Request("https://example.test/api/agents/application", { method: "POST", headers: { host: "example.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("agent application input and security", () => {
  it("normalizes Kenyan numbers and validates acknowledgement and inputs", () => {
    expect(validateAgentApplication(valid)).toEqual({ fullName: "Jane Doe", phoneE164: "+254712345678" });
    expect(validateAgentApplication({ ...valid, phone: "0712 abc 345678" })).toBeNull();
    expect(validateAgentApplication({ ...valid, phone: "123" })).toBeNull();
    expect(validateAgentApplication({ ...valid, privacyAccepted: false })).toBeNull();
    expect(validateAgentApplication({ ...valid, fullName: "<script>" })).toBeNull();
  });
  it("rejects cross-origin and missing-origin requests", () => {
    expect(isSameOriginRequest(request(valid))).toBe(true);
    expect(isSameOriginRequest(request(valid, "https://evil.test"))).toBe(false);
    expect(isSameOriginRequest(new Request("https://example.test", { headers: { host: "example.test" } }))).toBe(false);
  });
});

describe("application route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: "u1" });
    mocks.allowed.mockResolvedValue(true);
    mocks.find.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "a1" });
    mocks.audit.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn) => fn({ agentApplication: { findUnique: mocks.find, create: mocks.create }, auditEvent: { create: mocks.audit } }));
  });
  it("requires authentication and rejects cross-origin mutations", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request(valid))).status).toBe(401);
    expect((await POST(request(valid, "https://evil.test"))).status).toBe(403);
  });
  it("fails closed if the shared limiter rejects or is unavailable", async () => {
    mocks.allowed.mockResolvedValue(false);
    expect((await POST(request(valid))).status).toBe(429);
    mocks.allowed.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request(valid))).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("atomically saves only the signed-in user's application and audit", async () => {
    expect((await POST(request(valid))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u1", phoneE164: "+254712345678" }) }));
    expect(mocks.audit).toHaveBeenCalledWith({ data: { actorId: "u1", action: "AGENT_APPLICATION_SUBMITTED", targetType: "AGENT_APPLICATION", targetId: "a1" } });
  });
  it("treats a repeated application as a no-op and never updates contact details", async () => {
    mocks.find.mockResolvedValue({ status: "REJECTED" });
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "REJECTED" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("resolves a concurrent uniqueness conflict only when this account has an application", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2002" });
    mocks.find.mockResolvedValue({ status: "PENDING" });
    expect((await POST(request(valid))).status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith({ where: { userId: "u1" }, select: { status: true } });
    mocks.find.mockResolvedValue(null);
    expect((await POST(request(valid))).status).toBe(503);
  });
  it("reads status only for the signed-in account", async () => {
    mocks.find.mockResolvedValue({ status: "PENDING", createdAt: new Date("2026-01-01T00:00:00Z") });
    const response = await GET();
    expect(mocks.find).toHaveBeenCalledWith({ where: { userId: "u1" }, select: { createdAt: true, status: true } });
    expect(await response.json()).toEqual({ applied: true, status: "PENDING", createdAt: "2026-01-01T00:00:00.000Z" });
  });
  it("does not claim success when audit or storage fails", async () => {
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request(valid))).status).toBe(503);
  });
});
