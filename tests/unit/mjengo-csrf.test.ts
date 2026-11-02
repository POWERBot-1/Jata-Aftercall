/**
 * CSRF / origin boundary for MJENGO OS mutations.
 *
 * Scope note: this proves the origin predicate and the rate-limit identity source. It is NOT a
 * browser CSRF suite — no cookie jar, no cross-site form submission, no real Chromium. Those are
 * reported NOT TESTED in the implementation report; claiming otherwise would be false.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: {}, prisma: {} }));

import { verifyMjengoOrigin } from "../../lib/mjengo/csrf";
import { trustedClientIp } from "../../lib/rate-limit";

const HOST = "jataaftercall.co.ke";

function post(headers: Record<string, string> = {}, url = `https://${HOST}/api/mjengo/branding`) {
  return new Request(url, { method: "POST", headers });
}

describe("mjengo: origin check — mutation requests", () => {
  it("accepts a same-origin request", () => {
    expect(verifyMjengoOrigin(post({ origin: `https://${HOST}`, host: HOST })).ok).toBe(true);
  });

  it("accepts a request with no Origin (same-origin form post or non-browser client)", () => {
    // Allowed by design: a non-browser client carries no ambient cookie, and authentication is
    // still enforced separately by every route.
    expect(verifyMjengoOrigin(post({ host: HOST })).ok).toBe(true);
  });

  it("refuses a foreign origin", () => {
    const result = verifyMjengoOrigin(post({ origin: "https://evil.example", host: HOST }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/origin-host/);
  });

  it("refuses an origin that is a suffix or prefix of the real host", () => {
    for (const origin of [
      `https://${HOST}.evil.example`,
      `https://evil${HOST}`,
      `https://sub.${HOST}`,
      `http://${HOST}:8443`,
    ]) {
      expect({ origin, ok: verifyMjengoOrigin(post({ origin, host: HOST })).ok }).toEqual({ origin, ok: false });
    }
  });

  it("refuses a javascript:, data: and file: origin", () => {
    for (const origin of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "null"]) {
      expect({ origin, ok: verifyMjengoOrigin(post({ origin, host: HOST })).ok }).toEqual({ origin, ok: false });
    }
  });

  it("refuses a malformed X-Forwarded-Proto and a malformed Host", () => {
    expect(verifyMjengoOrigin(post({ origin: `https://${HOST}`, host: HOST, "x-forwarded-proto": "ftp" })).ok).toBe(false);
    expect(verifyMjengoOrigin(post({ origin: `https://${HOST}`, host: `${HOST}/evil` })).ok).toBe(false);
  });

  it("accepts a proxy chain that starts with https", () => {
    expect(verifyMjengoOrigin(post({ origin: `https://${HOST}`, host: HOST, "x-forwarded-proto": "https, http" })).ok).toBe(true);
  });

  it("refuses a request the browser labelled cross-site, even with no Origin", () => {
    expect(verifyMjengoOrigin(post({ host: HOST, "sec-fetch-site": "cross-site" })).ok).toBe(false);
    expect(verifyMjengoOrigin(post({ host: HOST, "sec-fetch-site": "same-site" })).ok).toBe(false);
    expect(verifyMjengoOrigin(post({ host: HOST, "sec-fetch-site": "same-origin" })).ok).toBe(true);
  });

  it("does not consult spoofable headers as an origin substitute", () => {
    // An attacker can set these freely; the check must ignore them rather than trust them.
    const spoofed = post({
      origin: "https://evil.example",
      host: HOST,
      "x-forwarded-host": HOST,
      "x-real-ip": "127.0.0.1",
      "x-forwarded-for": "127.0.0.1",
    });
    expect(verifyMjengoOrigin(spoofed).ok).toBe(false);
  });

  it("does not apply to safe methods (reads are still authenticated separately)", () => {
    const read = new Request(`https://${HOST}/api/mjengo/journal?businessId=bizA`, {
      method: "GET",
      headers: { origin: "https://evil.example", host: HOST },
    });
    expect(verifyMjengoOrigin(read).ok).toBe(true);
  });
});

describe("mjengo: rate-limit identity cannot be spoofed", () => {
  it("ignores X-Forwarded-For unless the deployment is Vercel", () => {
    const previous = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
      expect(trustedClientIp(headers)).toBeNull();
    } finally {
      if (previous !== undefined) process.env.VERCEL = previous;
    }
  });

  it("accepts only a well-formed IP from the first proxy hop on Vercel", () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(trustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
      expect(trustedClientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
      expect(trustedClientIp(new Headers({ "x-forwarded-for": "<script>" }))).toBeNull();
      expect(trustedClientIp(new Headers({}))).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
});
