/**
 * The M-PESA readiness endpoint is admin-only, read-only, and never reveals a secret — even when
 * the configuration it describes is broken.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/auth";
import { GET } from "@/app/api/admin/payments/mpesa/readiness/route";
import { TEST_MPESA, applyMpesaEnv } from "@/tests/helpers/mpesaEnv";

const session = getSession as unknown as ReturnType<typeof vi.fn>;
let restore: () => void = () => undefined;

beforeEach(() => {
  restore = applyMpesaEnv();
});
afterEach(() => {
  restore();
  session.mockReset();
});

describe("GET /api/admin/payments/mpesa/readiness", () => {
  it.each([
    ["an anonymous caller", null],
    ["a merchant owner", { userId: "u1", email: "o@example.com", role: "OWNER" }],
    ["a customer", { userId: "u2", email: "c@example.com", role: "CUSTOMER" }],
  ])("refuses %s", async (_label, who) => {
    session.mockResolvedValue(who);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin only." });
  });

  it("tells an admin the connector state, uncached", async () => {
    session.mockResolvedValue({ userId: "admin", email: "admin@example.com", role: "ADMIN" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.mpesa).toMatchObject({ environment: "sandbox", collectionReady: true, reversalReady: true, missing: [], invalid: [] });
    expect(body.mpesa.callbackUrls.stk).toBe("https://jata.test/api/payments/webhooks/daraja/stk?token=[redacted]");
  });

  it("names what is wrong, and the rule it broke, without ever echoing a value", async () => {
    restore();
    restore = applyMpesaEnv({
      MPESA_ENV: "prod",
      MPESA_CALLBACK_TOKEN: "bad token & secret!",
      MPESA_CONSUMER_KEY: "key with spaces in it",
      MPESA_PASSKEY: undefined,
      PUBLIC_BASE_URL: "http://localhost:3000",
    });
    session.mockResolvedValue({ userId: "admin", email: "admin@example.com", role: "ADMIN" });
    const body = await (await GET()).json();
    expect(body.mpesa.collectionReady).toBe(false);
    expect(body.mpesa.environment).toBeNull();
    expect(body.mpesa.missing).toContain("MPESA_PASSKEY");
    expect(body.mpesa.invalid.join(" ")).toMatch(/MPESA_ENV must be exactly/);
    expect(body.mpesa.invalid.join(" ")).toMatch(/MPESA_CALLBACK_TOKEN must be 24–128 URL-safe/);
    const text = JSON.stringify(body);
    for (const secret of ["bad token & secret!", "key with spaces in it", TEST_MPESA.MPESA_CONSUMER_SECRET, TEST_MPESA.MPESA_SECURITY_CREDENTIAL]) {
      expect(text).not.toContain(secret);
    }
  });

  it("has no write path", async () => {
    const route = await import("@/app/api/admin/payments/mpesa/readiness/route");
    expect(Object.keys(route).filter((key) => ["POST", "PUT", "PATCH", "DELETE"].includes(key))).toEqual([]);
  });
});
