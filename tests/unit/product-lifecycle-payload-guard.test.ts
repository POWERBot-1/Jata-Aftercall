import { describe, expect, it } from "vitest";
import { assertSafeLifecyclePayload } from "@/lib/admin/product-lifecycle-payload-guard";

describe("lifecycle payload safety guard", () => {
  it("requires the JSON payload root to be a plain object contract", () => {
    for (const value of [null, undefined, "EXPIRED", 1, true, [], ["EXPIRED"]]) {
      expect(() => assertSafeLifecyclePayload(value)).toThrow("LIFECYCLE_PAYLOAD_INVALID_ROOT");
    }
    expect(() => assertSafeLifecyclePayload({})).not.toThrow();
  });
  it("accepts bounded operational metadata", () => {
    expect(() => assertSafeLifecyclePayload({
      observationState: "EXPIRED",
      reasonCode: "EXPLICIT_EXPIRY",
      attempt: 2,
      fixture: true,
    })).not.toThrow();
  });

  it("rejects credential and personal-data field names", () => {
    for (const key of ["password", "apiKey", "authorization", "email", "phone", "address", "transcript"]) {
      expect(() => assertSafeLifecyclePayload({ [key]: "value" })).toThrow("LIFECYCLE_PAYLOAD_FORBIDDEN_FIELD");
    }
  });

  it("rejects email addresses, phone-like values and provider credentials", () => {
    for (const value of ["person@example.com", "+254 712 345 678", "sk_live_123456789"]) {
      expect(() => assertSafeLifecyclePayload({ note: value })).toThrow("LIFECYCLE_PAYLOAD_SENSITIVE_VALUE");
    }
  });

  it("bounds nested complexity, field count, array length and string length", () => {
    expect(() => assertSafeLifecyclePayload({ note: "x".repeat(513) })).toThrow("LIFECYCLE_PAYLOAD_SENSITIVE_VALUE");
    expect(() => assertSafeLifecyclePayload({ items: Array(65).fill("x") })).toThrow("LIFECYCLE_PAYLOAD_ARRAY_LIMIT");
    expect(() => assertSafeLifecyclePayload(Object.fromEntries(Array.from({ length: 65 }, (_, i) => ["field" + i, i])))).toThrow("LIFECYCLE_PAYLOAD_FIELD_LIMIT");
    let nested: unknown = "leaf";
    for (let i = 0; i < 10; i++) nested = { child: nested };
    expect(() => assertSafeLifecyclePayload(nested)).toThrow("LIFECYCLE_PAYLOAD_COMPLEXITY_LIMIT");
  });

  it("rejects non-finite numbers, class instances and prototype-sensitive keys", () => {
    expect(() => assertSafeLifecyclePayload({ value: Number.NaN })).toThrow("LIFECYCLE_PAYLOAD_INVALID_NUMBER");
    expect(() => assertSafeLifecyclePayload({ value: Number.POSITIVE_INFINITY })).toThrow("LIFECYCLE_PAYLOAD_INVALID_NUMBER");
    expect(() => assertSafeLifecyclePayload({ value: new Date() })).toThrow("LIFECYCLE_PAYLOAD_INVALID_OBJECT");
    expect(() => assertSafeLifecyclePayload(JSON.parse('{"constructor":{"polluted":true}}'))).toThrow("LIFECYCLE_PAYLOAD_FORBIDDEN_FIELD");
  });

  it("rejects unsupported values and circular objects", () => {
    expect(() => assertSafeLifecyclePayload({ value: undefined })).toThrow("LIFECYCLE_PAYLOAD_INVALID_TYPE");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertSafeLifecyclePayload(circular)).toThrow("LIFECYCLE_PAYLOAD_CIRCULAR");
  });
});
