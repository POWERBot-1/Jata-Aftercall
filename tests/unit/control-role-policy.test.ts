import { describe, expect, it } from "vitest";
import {
  CONTROL_ROLE_POLICY,
  CONTROL_ROLE_POLICY_COLUMNS,
  CONTROL_POLICY_BOUNDARIES,
  CONTROL_ROLE_POLICY_APPROVED,
  CONTROL_ROLE_ACCESS_ENABLED,
  CONTROL_ROLE_CAPABILITY_POLICY,
  filterControlRolePermissions,
  isControlCapabilityAllowed,
} from "@/lib/control/role-policy";
import { CONTROL_PERMISSIONS, CONTROL_ROLE_NAMES } from "@/lib/control/permissions";
import { hasControlPermission, scopedBusinessIds, type ControlGrant } from "@/lib/control/access";

describe("Control role/action matrix", () => {
  it("records owner authorization of the least-privilege matrix and enables the guarded grant path", () => {
    expect(CONTROL_ROLE_POLICY_APPROVED).toBe(true);
    expect(CONTROL_ROLE_ACCESS_ENABLED).toBe(true);
  });

  it("covers the six canonical roles with explicit bounded responsibilities", () => {
    expect(CONTROL_ROLE_POLICY.map((row) => row.role)).toEqual([...CONTROL_ROLE_NAMES]);
    expect(CONTROL_ROLE_POLICY.every((row) => row.responsibility.length > 20)).toBe(true);
  });

  it("makes all 90 role/capability decisions explicit and grants only the least-privilege read set", () => {
    expect(Object.keys(CONTROL_ROLE_CAPABILITY_POLICY)).toEqual([...CONTROL_ROLE_NAMES]);
    const expected: Record<string, string[]> = {
      SUPER_ADMIN: ["businesses.read", "subscriptions.read", "payments.read", "commissions.read", "audit.read", "system.health.read"],
      PLATFORM_ADMIN: ["businesses.read", "subscriptions.read", "system.health.read"],
      FINANCE_ADMIN: ["subscriptions.read", "payments.read", "commissions.read"],
      SUPPORT_ADMIN: ["businesses.read", "subscriptions.read"],
      SECURITY_ADMIN: ["audit.read", "system.health.read"],
      READ_ONLY_AUDITOR: ["audit.read"],
    };
    for (const role of CONTROL_ROLE_NAMES) {
      expect(Object.keys(CONTROL_ROLE_CAPABILITY_POLICY[role])).toEqual([...CONTROL_PERMISSIONS]);
      for (const permission of CONTROL_PERMISSIONS) {
        const allowed = expected[role].includes(permission);
        expect(CONTROL_ROLE_CAPABILITY_POLICY[role][permission], `${role} × ${permission}`).toBe(allowed ? "ALLOW" : "DENY");
        expect(isControlCapabilityAllowed(role, permission), `${role} × ${permission}`).toBe(allowed);
      }
    }
  });

  it("filters database grants through the policy and prevents cross-tenant access", () => {
    for (const role of CONTROL_ROLE_NAMES) {
      for (const permission of CONTROL_PERMISSIONS) {
        const filtered = filterControlRolePermissions(role, [permission]);
        const allowed = isControlCapabilityAllowed(role, permission);
        expect(filtered, `${role} × ${permission} filtered grant`).toEqual(allowed ? [permission] : []);
        const candidateGrant: ControlGrant = {
          id: `non-persistent-test-${role}-${permission}`, role, permissionKeys: filtered, scopeBusinessId: "tenant-a",
        };
        expect(hasControlPermission([candidateGrant], permission, "tenant-a")).toBe(allowed);
        expect(hasControlPermission([candidateGrant], permission, "tenant-b")).toBe(false);
      }
    }
  });

  it("rejects null/global grants for tenant-keyed reads while permitting only explicit global grants for global capabilities", () => {
    const globalGrant: ControlGrant = { id: "global", role: "SUPER_ADMIN", permissionKeys: ["businesses.read", "system.health.read"], scopeBusinessId: null };
    expect(hasControlPermission([globalGrant], "businesses.read", "tenant-a")).toBe(false);
    expect(hasControlPermission([globalGrant], "system.health.read")).toBe(true);
    expect(scopedBusinessIds([globalGrant], "businesses.read")).toEqual({ allowed: true, global: true, ids: [] });
  });

  it("keeps unknown roles, capabilities and wildcard-like grants denied", () => {
    expect(isControlCapabilityAllowed("PLATFORM_OWNER", "businesses.read")).toBe(false);
    expect(isControlCapabilityAllowed("SUPER_ADMIN", "*" )).toBe(false);
    expect(isControlCapabilityAllowed("SUPER_ADMIN", "businesses.*")).toBe(false);
    expect(filterControlRolePermissions("unknown", ["businesses.read"])).toEqual([]);
    expect(filterControlRolePermissions("SUPER_ADMIN", ["businesses.read", "*", "businesses.suspend"])).toEqual(["businesses.read"]);
  });

  it("keeps every permission dimension visible as denied or pending", () => {
    expect(CONTROL_ROLE_POLICY_COLUMNS.map((column) => column.label)).toEqual([
      "Read", "Write", "Approval", "Financial", "Tenant scope", "Sensitive administration", "MFA", "Audit",
    ]);
    expect(CONTROL_ROLE_POLICY_COLUMNS.some((column) => /read-only/i.test(column.value))).toBe(true);
    expect(CONTROL_POLICY_BOUNDARIES.map((row) => row.title)).toEqual([
      "Authorization enforcement", "Explicitly denied operations",
    ]);
  });
});
