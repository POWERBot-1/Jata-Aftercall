import { afterEach, describe, expect, it, vi } from "vitest";
import { hasControlPermission, scopedBusinessIds, type ControlGrant } from "@/lib/control/access";
import { CONTROL_ROLE_NAMES, isControlPermission } from "@/lib/control/permissions";
import { createControlMfaSession, decryptTotpSecret, encryptTotpSecret, matchingTotpStep, verifyControlMfaSession } from "@/lib/control/mfa";
import { getCorrelationId, hasSameOrigin } from "@/lib/control/security";

const baselineEnv = { AUTH_SECRET: process.env.AUTH_SECRET, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET };

afterEach(() => {
  vi.unstubAllEnvs();
  if (baselineEnv.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = baselineEnv.AUTH_SECRET;
  if (baselineEnv.NEXTAUTH_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = baselineEnv.NEXTAUTH_SECRET;
});

describe("control-plane authorization boundaries", () => {
  it("recognizes the six canonical roles without granting capabilities by role name", () => {
    expect(CONTROL_ROLE_NAMES).toEqual(["SUPER_ADMIN", "PLATFORM_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN", "SECURITY_ADMIN", "READ_ONLY_AUDITOR"]);
    for (const role of CONTROL_ROLE_NAMES) {
      const grant: ControlGrant = { id: `fixture-${role}`, role, permissionKeys: [], scopeBusinessId: null };
      expect(hasControlPermission([grant], "businesses.read")).toBe(false);
      expect(hasControlPermission([grant], "businesses.suspend", "business-a")).toBe(false);
    }
    expect(isControlPermission("businesses.suspend")).toBe(true);
    expect(isControlPermission("SUPER_ADMIN")).toBe(false);
  });

  it("applies the same explicit action rules to every canonical role without inferring role defaults", () => {
    for (const role of CONTROL_ROLE_NAMES) {
      const grant: ControlGrant = { id: `matrix-${role}`, role, permissionKeys: ["audit.read"], scopeBusinessId: "business-fixture" };
      expect(hasControlPermission([grant], "audit.read", "business-fixture")).toBe(true);
      expect(hasControlPermission([grant], "businesses.read", "business-fixture")).toBe(false);
      expect(hasControlPermission([grant], "audit.read", "another-business")).toBe(false);
    }
  });

  it("requires exact capabilities and exact tenant scope; only null scope is platform-wide", () => {
    const scoped: ControlGrant = { id: "grant-a", role: "SUPPORT_ADMIN", permissionKeys: ["businesses.read", "businesses.suspend"], scopeBusinessId: "business-a" };
    expect(hasControlPermission([scoped], "businesses.read", "business-a")).toBe(true);
    expect(hasControlPermission([scoped], "businesses.read", "business-b")).toBe(false);
    expect(hasControlPermission([scoped], "businesses.reinstate", "business-a")).toBe(false);
    expect(scopedBusinessIds([scoped], "businesses.read")).toEqual({ allowed: true, global: false, ids: ["business-a"] });
    const global: ControlGrant = { id: "grant-global", role: "READ_ONLY_AUDITOR", permissionKeys: ["audit.read"], scopeBusinessId: null };
    expect(hasControlPermission([global], "audit.read", "any-business")).toBe(true);
    expect(scopedBusinessIds([global], "audit.read")).toEqual({ allowed: true, global: true, ids: [] });
  });
});

describe("control MFA crypto and time boundaries", () => {
  it("encrypts TOTP secrets with authenticated encryption and rejects tampering", () => {
    vi.stubEnv("AUTH_SECRET", "a-test-only-control-secret-that-is-at-least-32-bytes-long");
    const secret = Buffer.from("test authenticator seed");
    const encrypted = encryptTotpSecret(secret);
    expect(decryptTotpSecret(encrypted)).toEqual(secret);
    expect(() => decryptTotpSecret({ ...encrypted, secretTag: Buffer.alloc(16).toString("base64url") })).toThrow();
  });

  it("matches the RFC TOTP vector once and prevents step replay", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    expect(matchingTotpStep(secret, "287082", 59_000)).toBe(BigInt(1));
    expect(matchingTotpStep(secret, "287082", 59_000, BigInt(1))).toBeNull();
    expect(matchingTotpStep(secret, "not-a-code", 59_000)).toBeNull();
  });

  it("binds the short MFA session to account, session version and expiry", () => {
    vi.stubEnv("AUTH_SECRET", "a-test-only-control-secret-that-is-at-least-32-bytes-long");
    const token = createControlMfaSession({ userId: "fixture-user", sessionVersion: 7 }, 1_000_000);
    expect(verifyControlMfaSession(token, { userId: "fixture-user", sessionVersion: 7 }, 1_100_000)).toBe(true);
    expect(verifyControlMfaSession(token, { userId: "other-user", sessionVersion: 7 }, 1_100_000)).toBe(false);
    expect(verifyControlMfaSession(token, { userId: "fixture-user", sessionVersion: 8 }, 1_100_000)).toBe(false);
    expect(verifyControlMfaSession(token, { userId: "fixture-user", sessionVersion: 7 }, 1_901_000)).toBe(false);
  });
});

describe("control request integrity", () => {
  it("accepts exact same-origin requests and rejects missing, cross-origin, and forged forwarded-host origins", () => {
    expect(hasSameOrigin(new Request("https://control.example.test/api/control", { headers: { origin: "https://control.example.test" } }))).toBe(true);
    expect(hasSameOrigin(new Request("https://control.example.test/api/control", { headers: { origin: "https://evil.example.test" } }))).toBe(false);
    expect(hasSameOrigin(new Request("https://control.example.test/api/control", { headers: { origin: "https://evil.example.test", "x-forwarded-host": "evil.example.test" } }))).toBe(false);
    expect(hasSameOrigin(new Request("https://control.example.test/api/control"))).toBe(false);
  });

  it("accepts only bounded safe correlation identifiers", () => {
    expect(getCorrelationId(new Headers({ "x-request-id": "req:abc-123" }))).toBe("req:abc-123");
    expect(getCorrelationId(new Headers({ "x-request-id": "bad value" }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
