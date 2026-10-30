import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockMessagingProvider, registerProvider, resetProviderRegistry } from "@/lib/messaging/providers";

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $queryRaw: mocks.query, agentRegistrationThrottle: { deleteMany: mocks.cleanup } } }));
import { verificationConfig, verificationLimit } from "@/lib/agents/phone-verification";
import { POST as requestCode } from "@/app/api/agents/verification/request/route";
import { POST as confirmCode } from "@/app/api/agents/verification/confirm/route";

const env = { ...process.env };
function request(origin = "https://example.test") {
  return new Request("https://example.test/api/agents/verification/confirm", { method: "POST", headers: { host: "example.test", origin, "content-type": "application/json" }, body: JSON.stringify({ code: "123456" }) });
}

describe("agent phone verification boundaries", () => {
  beforeEach(() => { vi.resetAllMocks(); resetProviderRegistry(); mocks.cleanup.mockResolvedValue({ count: 0 }); mocks.session.mockResolvedValue({ userId: "u1" }); });
  afterEach(() => { process.env = { ...env }; resetProviderRegistry(); });
  it("refuses unconfigured or sandbox providers even when flags are set", () => {
    process.env.AGENT_PHONE_VERIFICATION_ENABLED = "true";
    process.env.MESSAGING_LIVE_ENABLED = "true";
    process.env.AGENT_VERIFICATION_HMAC_SECRET = "synthetic-secret-with-more-than-32-characters";
    process.env.AGENT_VERIFICATION_SENDER_ID = "test";
    process.env.AGENT_VERIFICATION_PROVIDER_KEY = "mock";
    registerProvider(new MockMessagingProvider());
    expect(verificationConfig()).toBeNull();
  });
  it("prefers explicitly template-capable WhatsApp and falls back only to configured SMS", () => {
    process.env.AGENT_PHONE_VERIFICATION_ENABLED = "true";
    process.env.MESSAGING_LIVE_ENABLED = "true";
    process.env.AGENT_VERIFICATION_HMAC_SECRET = "synthetic-secret-with-more-than-32-characters";
    process.env.AGENT_VERIFICATION_PROVIDER_KEY = "sms-fixture";
    process.env.AGENT_VERIFICATION_SENDER_ID = "sms";
    process.env.AGENT_VERIFICATION_WHATSAPP_PROVIDER_KEY = "wa-fixture";
    process.env.AGENT_VERIFICATION_WHATSAPP_SENDER_ID = "wa";
    process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_NAME = "auth_fixture";
    process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_LANGUAGE = "en";
    const sms = new MockMessagingProvider(); sms.key = "sms-fixture"; sms.live = true;
    const wa = new MockMessagingProvider() as MockMessagingProvider & { supportsWhatsAppAuthenticationTemplates: boolean };
    wa.key = "wa-fixture"; wa.live = true; wa.channel = "WHATSAPP"; wa.supportsWhatsAppAuthenticationTemplates = true;
    registerProvider(sms); registerProvider(wa);
    expect(verificationConfig()).toBeNull();
    process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_APPROVED = "true";
    expect(verificationConfig()?.provider).toBe(wa);
    wa.supportsWhatsAppAuthenticationTemplates = false;
    expect(verificationConfig()).toBeNull();
    delete process.env.AGENT_VERIFICATION_WHATSAPP_PROVIDER_KEY;
    expect(verificationConfig()?.provider).toBe(sms);
    sms.configured = false;
    expect(verificationConfig()).toBeNull();
  });
  it("denies anonymous and cross-origin requests without accessing storage", async () => {
    expect((await requestCode(request("https://evil.test"))).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await requestCode(request())).status).toBe(401);
    expect((await confirmCode(request())).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("fails closed with no approved provider, for both issuance and confirmation", async () => {
    delete process.env.AGENT_PHONE_VERIFICATION_ENABLED;
    expect((await requestCode(request())).status).toBe(503);
    expect((await confirmCode(request())).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("uses keyed per-account atomic limits and rejects fallback data", async () => {
    mocks.query.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ "?column?": 1 }]);
    const secret = "test-secret";
    expect(await verificationLimit(secret, "private-user", "issue")).toBe(true);
    expect(await verificationLimit(secret, "private-user", "issue")).toBe(false);
    expect(await verificationLimit(secret, "private-user", "confirm")).toBe(false);
    expect(mocks.query.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.query.mock.calls[0][1]).not.toContain("private-user");
  });
});
