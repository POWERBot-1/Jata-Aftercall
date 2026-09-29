import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFERRAL_ATTRIBUTION_DAYS,
  REFERRAL_CODE_LENGTH,
  REFERRAL_COOKIE_NAME,
  attributionExpiry,
  generateReferralCode,
  hashReferralToken,
  isSelfReferral,
  isValidReferralCode,
  issueReferralToken,
  normalizeReferralCode,
  normalizeReferralToken,
  publicReferralInvite,
  readReferralCookie,
  referralCookieOptions,
  referralLink,
  referralPath,
} from "@/lib/referral";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("referral code format", () => {
  it("generates a fixed-length opaque code from the allowed alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    }
  });

  it("generates unique codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateReferralCode()));
    expect(codes.size).toBe(200);
  });

  it("never emits look-alike characters (I, L, O, U)", () => {
    const codes = Array.from({ length: 100 }, () => generateReferralCode()).join("");
    expect(codes).not.toMatch(/[ILOU]/);
  });
});

describe("referral code validation", () => {
  it("accepts a well-formed code and normalises case and whitespace", () => {
    const code = generateReferralCode();
    expect(normalizeReferralCode(code)).toBe(code);
    expect(normalizeReferralCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(isValidReferralCode(code)).toBe(true);
  });

  it("rejects tampered, malformed and non-string codes", () => {
    const code = generateReferralCode();
    expect(normalizeReferralCode(`${code}X`)).toBeNull();
    expect(normalizeReferralCode(code.slice(0, -1))).toBeNull();
    expect(normalizeReferralCode(code.replace(/./, "!"))).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode("business-a")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
    expect(normalizeReferralCode(12345)).toBeNull();
    expect(normalizeReferralCode({ code })).toBeNull();
    expect(isValidReferralCode(`${code}!`)).toBe(false);
  });

  it("does not leak a tenant id or slug through the code", () => {
    const code = generateReferralCode();
    expect(code).not.toContain("cuid");
    expect(code).not.toMatch(/@/);
    expect(code).not.toMatch(/[^0-9A-HJKMNP-TV-Z]/);
  });
});

describe("referral links", () => {
  it("builds a path-based link from the configured base url", () => {
    expect(referralPath("ABC123")).toBe("/r/ABC123");
    expect(referralLink("ABC123", "https://jata.example/")).toBe("https://jata.example/r/ABC123");
    expect(referralLink("ABC123", "https://jata.example")).toBe("https://jata.example/r/ABC123");
  });
});

describe("attribution token handling", () => {
  it("issues unique url-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issueReferralToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes tokens deterministically and without embedding the raw value", () => {
    const token = issueReferralToken();
    const hash = hashReferralToken(token);
    expect(hash).toBe(hashReferralToken(token));
    expect(hash).not.toBe(hashReferralToken(issueReferralToken()));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("rejects malformed, oversized and non-string tokens", () => {
    expect(normalizeReferralToken(issueReferralToken())).toBeTruthy();
    expect(normalizeReferralToken("")).toBeNull();
    expect(normalizeReferralToken("bad token!")).toBeNull();
    expect(normalizeReferralToken("a".repeat(600))).toBeNull();
    expect(normalizeReferralToken(null)).toBeNull();
    expect(normalizeReferralToken(undefined)).toBeNull();
    expect(normalizeReferralToken({ token: "x" })).toBeNull();
  });

  it("reads the attribution token from a cookie header", () => {
    const token = issueReferralToken();
    const req = new Request("https://jata.test/register", { headers: { cookie: `other=1; ${REFERRAL_COOKIE_NAME}=${token}; x=y` } });
    expect(readReferralCookie(req)).toBe(token);
    expect(readReferralCookie(new Request("https://jata.test/register"))).toBeNull();
    expect(readReferralCookie(new Request("https://jata.test/register", { headers: { cookie: "other=1" } }))).toBeNull();
  });

  it("stores the token in an httpOnly, host-scoped, lax cookie", () => {
    const options = referralCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60);
    expect(options.secure).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(referralCookieOptions().secure).toBe(true);
  });

  it("expires attribution after the configured window", () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    const expires = attributionExpiry(now);
    expect(expires.getTime() - now.getTime()).toBe(REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe("self-referral guard", () => {
  it("detects a matching email", () => {
    expect(isSelfReferral({ ownerEmail: "Owner@Example.test", ownerPhone: "0700000000" }, { email: "owner@example.test", phone: "0711111111" })).toBe(true);
  });

  it("detects a matching phone regardless of formatting", () => {
    expect(isSelfReferral({ ownerEmail: "a@example.test", ownerPhone: "0722123456" }, { email: "b@example.test", phone: "+254722123456" })).toBe(true);
  });

  it("does not block an unrelated recipient", () => {
    expect(isSelfReferral({ ownerEmail: "owner@example.test", ownerPhone: "0722123456" }, { email: "new@example.test", phone: "0733333333" })).toBe(false);
  });

  it("is false when the referrer is unknown or contact details are missing", () => {
    expect(isSelfReferral(null, { email: "new@example.test", phone: "0733333333" })).toBe(false);
    expect(isSelfReferral({ ownerEmail: null, ownerPhone: null }, { email: "new@example.test", phone: "0733333333" })).toBe(false);
    expect(isSelfReferral({ ownerEmail: "owner@example.test", ownerPhone: "0722123456" }, {})).toBe(false);
  });
});

describe("public referral projection", () => {
  it("exposes only the public business name", () => {
    const invite = publicReferralInvite({
      businessId: "biz-1",
      businessName: "Mary's Beauty Studio",
      ownerId: "user-1",
      ownerEmail: "owner@example.test",
      ownerPhone: "0722123456",
      isPublished: true,
      status: "ACTIVE",
    });
    expect(invite).toEqual({ businessName: "Mary's Beauty Studio" });
    expect(JSON.stringify(invite)).not.toContain("owner");
    expect(JSON.stringify(invite)).not.toContain("biz-1");
  });

  it("returns null when there is nothing public to show", () => {
    expect(publicReferralInvite(null)).toBeNull();
    expect(publicReferralInvite({ businessId: "biz", businessName: "  ", ownerId: "u", ownerEmail: null, ownerPhone: null, isPublished: true, status: "ACTIVE" })).toBeNull();
  });
});
