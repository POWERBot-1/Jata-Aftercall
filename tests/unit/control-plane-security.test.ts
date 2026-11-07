import { afterEach, describe, expect, it, vi } from "vitest";
import { hasControlPermission, scopedBusinessIds, type ControlGrant } from "@/lib/control/access";
import { CONTROL_PERMISSIONS, CONTROL_ROLE_NAMES, isControlPermission } from "@/lib/control/permissions";
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

  it("applies the explicit least-privilege policy to each role without inferring role defaults", () => {
    const auditRoles = new Set(["SUPER_ADMIN", "SECURITY_ADMIN", "READ_ONLY_AUDITOR"]);
    for (const role of CONTROL_ROLE_NAMES) {
      const grant: ControlGrant = { id: `matrix-${role}`, role, permissionKeys: ["audit.read"], scopeBusinessId: "business-fixture" };
      const allowed = auditRoles.has(role);
      expect(hasControlPermission([grant], "audit.read", "business-fixture")).toBe(allowed);
      expect(hasControlPermission([grant], "businesses.read", "business-fixture")).toBe(false);
      expect(hasControlPermission([grant], "audit.read", "another-business")).toBe(false);
    }
  });

  it("covers every canonical role × capability pair with no implicit grant and exact tenant boundaries", () => {
    for (const role of CONTROL_ROLE_NAMES) {
      for (const permission of CONTROL_PERMISSIONS) {
        const allowed = isControlCapabilityAllowed(role, permission);
        const roleOnly: ControlGrant = { id: `role-only-${role}`, role, permissionKeys: [], scopeBusinessId: null };
        expect(hasControlPermission([roleOnly], permission, "tenant-a")).toBe(false);
        const globalPermission = permission === "system.health.read";
        const scoped: ControlGrant = { id: `matrix-${role}-${permission}`, role, permissionKeys: [permission], scopeBusinessId: globalPermission ? null : "tenant-a" };
        expect(hasControlPermission([scoped], permission, globalPermission ? undefined : "tenant-a")).toBe(allowed);
        if (!globalPermission) expect(hasControlPermission([scoped], permission, "tenant-b")).toBe(false);
        for (const denied of CONTROL_PERMISSIONS.filter((candidate) => candidate !== permission || !allowed)) {
          expect(hasControlPermission([scoped], denied, globalPermission ? undefined : "tenant-a")).toBe(false);
        }
      }
    }
  });

  it("requires exact capabilities and exact tenant scope; only null scope is platform-wide", () => {
    const scoped: ControlGrant = { id: "grant-a", role: "SUPPORT_ADMIN", permissionKeys: ["businesses.read", "businesses.suspend"], scopeBusinessId: "business-a" };
    expect(hasControlPermission([scoped], "businesses.read", "business-a")).toBe(true);
    expect(hasControlPermission([scoped], "businesses.read", "business-b")).toBe(false);
    expect(hasControlPermission([scoped], "businesses.reinstate", "business-a")).toBe(false);
    expect(scopedBusinessIds([scoped], "businesses.read")).toEqual({ allowed: true, global: false, ids: ["business-a"] });
    const global: ControlGrant = { id: "grant-global", role: "SUPER_ADMIN", permissionKeys: ["system.health.read"], scopeBusinessId: null };
    expect(hasControlPermission([global], "system.health.read")).toBe(true);
    expect(scopedBusinessIds([global], "system.health.read")).toEqual({ allowed: true, global: true, ids: [] });
    const unscopedAudit: ControlGrant = { id: "audit-global", role: "READ_ONLY_AUDITOR", permissionKeys: ["audit.read"], scopeBusinessId: null };
    expect(hasControlPermission([unscopedAudit], "audit.read", "any-business")).toBe(false);
    expect(scopedBusinessIds([unscopedAudit], "audit.read")).toEqual({ allowed: false, global: false, ids: [] });
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
