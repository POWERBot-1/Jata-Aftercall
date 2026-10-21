/**
 * Candidate-only diagnostics (not part of the recovered patch).
 *
 * Safe, offline checks for the deployment-identity behaviour introduced by the candidate:
 *   - trustedClientIp only trusts X-Forwarded-For when VERCEL=1
 *   - rate limiting keys on that identity, so a non-Vercel process collapses all callers into
 *     one bucket
 *   - the M-PESA callback IP allowlist uses the same helper, so it fails closed off-Vercel
 *
 * No network, no database, no provider call. The M-PESA credentials below are dummy literals
 * that exist only inside this test process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit, rateLimitByIdentity, trustedClientIp } from "@/lib/rate-limit";
import { createMpesaAdapter } from "@/lib/payments/providers/mpesa";
import { adapterContext } from "@/lib/payments/context";

function headers(values: Record<string, string> = {}): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(values)) h.set(k, v);
  return h;
}

function requestWith(values: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/probe", { headers: headers(values) });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trustedClientIp", () => {
  it("ignores X-Forwarded-For entirely when VERCEL is not set", () => {
    vi.stubEnv("VERCEL", "");
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.9" }))).toBeNull();
  });

  it("treats VERCEL=0 as not Vercel", () => {
    vi.stubEnv("VERCEL", "0");
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.9" }))).toBeNull();
  });

  it("returns a literal client IP on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("takes only the leftmost hop and requires it to be a literal IP", () => {
    vi.stubEnv("VERCEL", "1");
    expect(trustedClientIp(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.4" }))).toBe("203.0.113.9");
    expect(trustedClientIp(headers({ "x-forwarded-for": "unknown, 203.0.113.9" }))).toBeNull();
    expect(trustedClientIp(headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(trustedClientIp(headers({}))).toBeNull();
  });

  it("does not fall back to X-Real-IP", () => {
    vi.stubEnv("VERCEL", "1");
    expect(trustedClientIp(headers({ "x-real-ip": "203.0.113.9" }))).toBeNull();
  });
});

describe("rate limiter identity", () => {
  it("isolates callers by IP on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const options = { key: `audit-per-ip-${Math.random()}`, max: 1, windowMs: 60_000 };
    expect(rateLimit(requestWith({ "x-forwarded-for": "203.0.113.10" }), options).allowed).toBe(true);
    expect(rateLimit(requestWith({ "x-forwarded-for": "203.0.113.11" }), options).allowed).toBe(true);
  });

  it("collapses every caller into one bucket when VERCEL is unset", () => {
    vi.stubEnv("VERCEL", "");
    const options = { key: `audit-collapse-${Math.random()}`, max: 1, windowMs: 60_000 };
    expect(rateLimit(requestWith({ "x-forwarded-for": "203.0.113.10" }), options).allowed).toBe(true);
    // A different client is throttled because both map to the same "untrusted-proxy" identity.
    expect(rateLimit(requestWith({ "x-forwarded-for": "203.0.113.11" }), options).allowed).toBe(false);
  });

  it("shares one bucket for a missing identity", () => {
    const options = { key: `audit-null-identity-${Math.random()}`, max: 1, windowMs: 60_000 };
    expect(rateLimitByIdentity(null, options).allowed).toBe(true);
    expect(rateLimitByIdentity(undefined, options).allowed).toBe(false);
    expect(rateLimitByIdentity("203.0.113.12", options).allowed).toBe(true);
  });
});

describe("M-PESA callback IP allowlist", () => {
  const TOKEN = "candidate-audit-token";

  function stubMpesaEnv(): void {
    vi.stubEnv("MPESA_CONSUMER_KEY", "audit-key");
    vi.stubEnv("MPESA_CONSUMER_SECRET", "audit-secret");
    vi.stubEnv("MPESA_SHORTCODE", "174379");
    vi.stubEnv("MPESA_PASSKEY", "audit-passkey");
    vi.stubEnv("MPESA_CALLBACK_TOKEN", TOKEN);
    vi.stubEnv("MPESA_ALLOWED_IPS", "203.0.113.9");
  }

  function stkRequest(xff: string): Parameters<ReturnType<typeof createMpesaAdapter>["verifyEvent"]>[0] {
    return {
      rawBody: "{}",
      headers: headers({ "x-forwarded-for": xff }),
      payload: { Body: { stkCallback: { CheckoutRequestID: "ws_CO_AUDIT_1", ResultCode: 0 } } },
      url: new URL(`https://example.invalid/api/payments/webhooks/mpesa/stk?token=${TOKEN}`),
    };
  }

  it("accepts an allowed provider address on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    stubMpesaEnv();
    const result = await createMpesaAdapter().verifyEvent(stkRequest("203.0.113.9"), adapterContext());
    expect(result.ok).toBe(true);
  });

  it("rejects a non-allowlisted address on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    stubMpesaEnv();
    const result = await createMpesaAdapter().verifyEvent(stkRequest("198.51.100.7"), adapterContext());
    expect(result).toMatchObject({ ok: false, code: "CALLBACK_IP_REJECTED" });
  });

  it("rejects every callback off-Vercel, even from the allowlisted address", async () => {
    vi.stubEnv("VERCEL", "");
    stubMpesaEnv();
    const result = await createMpesaAdapter().verifyEvent(stkRequest("203.0.113.9"), adapterContext());
    expect(result).toMatchObject({ ok: false, code: "CALLBACK_IP_REJECTED" });
  });
});
