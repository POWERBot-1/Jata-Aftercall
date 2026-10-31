import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateAgentRegistration, readSmallJson } from "@/lib/agent-registration";

const mocks = vi.hoisted(() => ({ session: vi.fn(), hash: vi.fn(), createUser: vi.fn(), createApplication: vi.fn(), audit: vi.fn(), transaction: vi.fn(), allowed: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session, hashPassword: mocks.hash }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
vi.mock("@/lib/agent-registration", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agent-registration")>();
  return { ...original, allowAgentRegistration: mocks.allowed };
});
import { POST } from "@/app/api/agents/register/route";

const valid = { fullName: "Jane Doe", email: "  JANE@example.com ", phone: "0712 345 678", password: "password123", privacyAccepted: true, termsAccepted: true };
function request(body: unknown, origin = "https://example.test") {
  return new Request("https://example.test/api/agents/register", { method: "POST", headers: { host: "example.test", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("agent-only registration validation", () => {
  it("normalizes email and mobile and requires both acknowledgements", () => {
    expect(validateAgentRegistration(valid)).toEqual({ fullName: "Jane Doe", email: "jane@example.com", phoneE164: "+254712345678", password: "password123" });
    expect(validateAgentRegistration({ ...valid, termsAccepted: false })).toBeNull();
    expect(validateAgentRegistration({ ...valid, privacyAccepted: false })).toBeNull();
    expect(validateAgentRegistration({ ...valid, email: "invalid" })).toBeNull();
    expect(validateAgentRegistration({ ...valid, password: "é".repeat(37) })).toBeNull();
    expect(validateAgentRegistration({ ...valid, phone: "0712words345678" })).toBeNull();
  });
  it("rejects oversized request bodies", async () => {
    await expect(readSmallJson(request({ payload: "x".repeat(5000) }))).rejects.toThrow();
  });
});

describe("agent-only registration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_SELF_SERVICE_REGISTRATION_ENABLED = "true";
    mocks.session.mockResolvedValue(null);
    mocks.allowed.mockResolvedValue(true);
    mocks.hash.mockResolvedValue("hash");
    mocks.createUser.mockResolvedValue({ id: "u1" });
    mocks.createApplication.mockResolvedValue({ id: "a1" });
    mocks.audit.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn) => fn({ user: { create: mocks.createUser }, agentApplication: { create: mocks.createApplication }, auditEvent: { create: mocks.audit } }));
  });
  afterEach(() => { delete process.env.AGENT_SELF_SERVICE_REGISTRATION_ENABLED; });
  it("is disabled unless explicitly enabled", async () => {
    delete process.env.AGENT_SELF_SERVICE_REGISTRATION_ENABLED;
    expect((await POST(request(valid))).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("refuses cross-origin requests and fails closed on limiter failure", async () => {
    expect((await POST(request(valid, "https://evil.test"))).status).toBe(403);
    mocks.allowed.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request(valid))).status).toBe(503);
    mocks.allowed.mockResolvedValue(false);
    expect((await POST(request(valid))).status).toBe(429);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("creates only a customer account, application and audit within one transaction", async () => {
    expect((await POST(request(valid))).status).toBe(200);
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "jane@example.com", role: "CUSTOMER", passwordHash: "hash" }) }));
    expect(mocks.createApplication).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u1", phoneE164: "+254712345678" }) }));
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
  it("returns the same response for a duplicate email without changing the existing user", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2002", meta: { target: ["email"] } });
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    mocks.transaction.mockRejectedValue({ code: "P2002", meta: { target: ["other"] } });
    expect((await POST(request(valid))).status).toBe(503);
  });
  it("refuses an existing session and never accepts a browser supplied role", async () => {
    mocks.session.mockResolvedValue({ userId: "u2" });
    expect((await POST(request({ ...valid, role: "ADMIN" }))).status).toBe(409);
    mocks.session.mockResolvedValue(null);
    expect((await POST(request({ ...valid, role: "ADMIN" }))).status).toBe(200);
    expect(mocks.createUser.mock.calls[0][0].data.role).toBe("CUSTOMER");
  });
});
