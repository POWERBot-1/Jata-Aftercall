import { describe, expect, it } from "vitest";
import { signAutomationPayload, validateAutomationEvent, verifyAutomationSignature } from "@/lib/automation/events";

const secret = "test-only-automation-hmac-secret-32chars";
const event = { id: "evt_12345678", type: "payment.verified", occurredAt: new Date().toISOString(), tenantId: "biz_12345678", source: "jata", data: { reference: "test-ref" } };

describe("automation event boundary", () => {
  it("accepts a valid, tenant-addressed event and rejects malformed or tenantless input", () => {
    expect(validateAutomationEvent(event)).toBe(true);
    expect(validateAutomationEvent({ ...event, tenantId: "" })).toBe(false);
    expect(validateAutomationEvent({ ...event, data: [] })).toBe(false);
  });
  it("verifies signatures, rejects tampering and rejects absent signatures", () => {
    const raw = JSON.stringify(event);
    const signature = signAutomationPayload(raw, secret);
    expect(verifyAutomationSignature(raw, signature, secret)).toBe(true);
    expect(verifyAutomationSignature(`${raw} `, signature, secret)).toBe(false);
    expect(verifyAutomationSignature(raw, null, secret)).toBe(false);
  });
  it("requires a sufficiently strong shared secret", () => {
    expect(() => signAutomationPayload("{}", "short")).toThrow("AUTOMATION_SECRET_INVALID");
  });
});
