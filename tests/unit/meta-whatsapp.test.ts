import { createHmac } from "node:crypto";
vi.mock("@/lib/db", () => ({ default: {} }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaWhatsAppProvider, metaConfig, verifyMetaSignature } from "@/lib/messaging/meta-whatsapp";
import { parseMetaStatuses, verifyWebhookToken } from "@/lib/messaging/meta-whatsapp-webhook";

const config = { token: "synthetic-token-only-123456", phoneNumberId: "12345678", appSecret: "synthetic-app-secret", template: "fixture_auth", language: "en" };
const request = { to: "+254700000001", body: "", senderId: config.phoneNumberId, idempotencyKey: "fixture", channel: "WHATSAPP" as const, authenticationTemplate: { name: config.template, language: config.language, code: "742516" } };
const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); });

describe("Meta WhatsApp adapter — mocked transport only", () => {
  it("fails closed unless explicitly enabled with pinned version and complete settings", () => {
    delete process.env.META_WHATSAPP_CLOUD_ENABLED;
    expect(metaConfig()).toBeNull();
    Object.assign(process.env, { META_WHATSAPP_CLOUD_ENABLED: "true", META_WHATSAPP_WEBHOOK_ENABLED: "true", META_WHATSAPP_VERIFY_TOKEN: "synthetic-verify-token", META_WHATSAPP_GRAPH_VERSION: "v26.0", META_WHATSAPP_ACCESS_TOKEN: config.token, META_WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId, META_WHATSAPP_APP_SECRET: config.appSecret, AGENT_VERIFICATION_WHATSAPP_TEMPLATE_NAME: config.template, AGENT_VERIFICATION_WHATSAPP_TEMPLATE_LANGUAGE: config.language, AGENT_VERIFICATION_WHATSAPP_TEMPLATE_APPROVED: "true" });
    expect(metaConfig()?.phoneNumberId).toBe(config.phoneNumberId);
    process.env.META_WHATSAPP_GRAPH_VERSION = "v1.0";
    expect(metaConfig()).toBeNull();
  });
  it("sends the approved copy-code template over pinned HTTPS and returns acceptance, never verification", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.synthetic1" }] }), { status: 200 }));
    const provider = createMetaWhatsAppProvider(config, transport as unknown as typeof fetch);
    expect(await provider.send(request)).toEqual({ outcome: "ACCEPTED", providerMessageId: "wamid.synthetic1" });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v26.0/12345678/messages");
    expect(init.headers.Authorization).toBe(`Bearer ${config.token}`);
    const body = JSON.parse(init.body);
    expect(body.template.components[0].parameters[0].text).toBe("742516");
    expect(body.template.components[1].parameters[0].text).toBe("742516");
    expect(body.to).toBe("254700000001");
  });
  it.each([
    [400, { error: { code: 132001 } }, "FAILED", "META_REJECTED", true],
    [400, { error: { code: 131026 } }, "FAILED", "META_REJECTED", true],
    [401, { error: { code: 190 } }, "FAILED", "AUTH_FAILED", undefined],
    [429, { error: { code: 130429 } }, "UNKNOWN", "RATE_LIMITED", undefined],
    [500, { error: { code: 1 } }, "UNKNOWN", "PROVIDER_UNAVAILABLE", undefined],
    [200, { messages: [] }, "UNKNOWN", "MALFORMED_RESPONSE", undefined],
  ])("classifies response %s without leaking provider bodies", async (status, body, outcome, code, safe) => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    const result = await createMetaWhatsAppProvider(config, transport as unknown as typeof fetch).send(request);
    expect(result).toMatchObject({ outcome, code });
    expect(result.safeToFallback).toBe(safe);
    expect(JSON.stringify(result)).not.toContain(config.token);
  });
  it("treats network exceptions and malformed JSON as uncertain and never uses real fetch", async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const provider = createMetaWhatsAppProvider(config, transport as unknown as typeof fetch);
    expect(await provider.send(request)).toMatchObject({ outcome: "UNKNOWN", code: "NETWORK_OR_TIMEOUT" });
    expect(await provider.send(request)).toMatchObject({ outcome: "UNKNOWN", code: "MALFORMED_RESPONSE" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("refuses a template mismatch before any network request", async () => {
    const transport = vi.fn();
    expect(await createMetaWhatsAppProvider(config, transport as unknown as typeof fetch).send({ ...request, authenticationTemplate: { ...request.authenticationTemplate, name: "wrong" } })).toMatchObject({ outcome: "FAILED" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("Meta webhook verification", () => {
  it("checks raw-byte HMAC and subscription token in constant-time comparisons", () => {
    const body = Buffer.from('{"test":true}');
    const signature = "sha256=" + createHmac("sha256", config.appSecret).update(body).digest("hex");
    expect(verifyMetaSignature(body, signature, config.appSecret)).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{"test":false}'), signature, config.appSecret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=invalid", config.appSecret)).toBe(false);
    expect(verifyWebhookToken("fixture-token", "fixture-token")).toBe(true);
    expect(verifyWebhookToken("wrong", "fixture-token")).toBe(false);
  });
  it("validates sender and statuses and refuses malformed or future events", () => {
    const payload = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: config.phoneNumberId }, statuses: [{ id: "wamid.synthetic1", status: "delivered", timestamp: "1700000000" }] } }] }] };
    expect(parseMetaStatuses(payload, config.phoneNumberId)).toHaveLength(1);
    expect(parseMetaStatuses(payload, "wrong")).toBeNull();
    payload.entry[0].changes[0].value.statuses[0].status = "nonsense";
    expect(parseMetaStatuses(payload, config.phoneNumberId)).toBeNull();
  });
});
