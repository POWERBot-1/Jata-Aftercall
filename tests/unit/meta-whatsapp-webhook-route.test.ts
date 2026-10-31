import { createHmac } from "node:crypto";
vi.mock("@/lib/db", () => ({ default: {} }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/messaging/meta-whatsapp-webhook", async (original) => ({ ...await original<typeof import("@/lib/messaging/meta-whatsapp-webhook")>(), applyMetaStatus: mocks.apply }));
import { GET, POST } from "@/app/api/webhooks/meta-whatsapp/route";
const env = { ...process.env };
const secret = "synthetic-app-secret-for-tests";
const token = "synthetic-webhook-verify-token";
const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "12345678" }, statuses: [{ id: "wamid.synthetic", status: "sent", timestamp: "1700000000" }] } }] }] });
function request(body = payload, signature?: string) {
  const sig = signature ?? "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://example.test/api/webhooks/meta-whatsapp", { method: "POST", headers: { "x-hub-signature-256": sig }, body });
}
describe("Meta webhook HTTP boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); Object.assign(process.env, { META_WHATSAPP_WEBHOOK_ENABLED: "true", META_WHATSAPP_APP_SECRET: secret, META_WHATSAPP_VERIFY_TOKEN: token, META_WHATSAPP_PHONE_NUMBER_ID: "12345678" }); mocks.apply.mockResolvedValue("applied"); });
  afterEach(() => { process.env = { ...env }; });
  it("requires configured challenge token and returns only the challenge", async () => {
    expect((await GET(new Request(`https://example.test/api/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc`))).status).toBe(200);
    expect((await GET(new Request("https://example.test/api/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=abc"))).status).toBe(403);
    delete process.env.META_WHATSAPP_WEBHOOK_ENABLED;
    expect((await GET(new Request("https://example.test"))).status).toBe(503);
  });
  it("rejects forged and malformed payloads before storage", async () => {
    expect((await POST(request(payload, "sha256=" + "0".repeat(64)))).status).toBe(401);
    expect((await POST(request("{"))).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("acknowledges exact duplicate without reapplying and retries unmatched", async () => {
    mocks.apply.mockResolvedValueOnce("duplicate").mockResolvedValueOnce("unmatched");
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(503);
  });
});
