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
import { hasControlPermission, type ControlGrant } from "@/lib/control/access";

describe("Control role/action matrix", () => {
  it("records owner approval of the all-DENY document without enabling operational access", () => {
    expect(CONTROL_ROLE_POLICY_APPROVED).toBe(true);
    expect(CONTROL_ROLE_ACCESS_ENABLED).toBe(false);
  });

  it("covers the six canonical roles and keeps role descriptions explicitly provisional", () => {
    expect(CONTROL_ROLE_POLICY.map((row) => row.role)).toEqual([...CONTROL_ROLE_NAMES]);
    expect(CONTROL_ROLE_POLICY.every((row) => /proposed|unresolved/i.test(row.responsibility))).toBe(true);
  });

  it("makes all 90 role/capability decisions explicit DENY cells", () => {
    expect(Object.keys(CONTROL_ROLE_CAPABILITY_POLICY)).toEqual([...CONTROL_ROLE_NAMES]);
    for (const role of CONTROL_ROLE_NAMES) {
      expect(Object.keys(CONTROL_ROLE_CAPABILITY_POLICY[role])).toEqual([...CONTROL_PERMISSIONS]);
      for (const permission of CONTROL_PERMISSIONS) {
        expect(CONTROL_ROLE_CAPABILITY_POLICY[role][permission], `${role} × ${permission}`).toBe("DENY");
        expect(isControlCapabilityAllowed(role, permission), `${role} × ${permission}`).toBe(false);
      }
    }
  });

  it("filters all 90 owner-approved DENY cells before permission and tenant checks", () => {
    for (const role of CONTROL_ROLE_NAMES) {
      for (const permission of CONTROL_PERMISSIONS) {
        const filtered = filterControlRolePermissions(role, [permission]);
        expect(filtered, `${role} × ${permission} filtered grant`).toEqual([]);
        const candidateGrant: ControlGrant = {
          id: `non-persistent-test-${role}-${permission}`,
          role,
          permissionKeys: filtered,
          scopeBusinessId: "tenant-a",
        };
        expect(hasControlPermission([candidateGrant], permission, "tenant-a"), `${role} × ${permission} same tenant`).toBe(false);
        expect(hasControlPermission([candidateGrant], permission, "tenant-b"), `${role} × ${permission} cross tenant`).toBe(false);
      }
    }
  });

  it("keeps unknown roles, capabilities and wildcard-like grants denied", () => {
    expect(isControlCapabilityAllowed("PLATFORM_OWNER", "businesses.read")).toBe(false);
    expect(isControlCapabilityAllowed("SUPER_ADMIN", "*" )).toBe(false);
    expect(isControlCapabilityAllowed("SUPER_ADMIN", "businesses.*")).toBe(false);
    expect(filterControlRolePermissions("unknown", ["businesses.read"])).toEqual([]);
    expect(filterControlRolePermissions("SUPER_ADMIN", ["businesses.read", "*", "businesses.suspend"])).toEqual([]);
  });

  it("keeps every permission dimension visible as denied or pending", () => {
    expect(CONTROL_ROLE_POLICY_COLUMNS.map((column) => column.label)).toEqual([
      "Read", "Write", "Approval", "Financial", "Tenant scope", "Sensitive administration", "MFA", "Audit",
    ]);
    expect(CONTROL_ROLE_POLICY_COLUMNS.every((column) => /DENY|denied|pending/i.test(column.value))).toBe(true);
    expect(CONTROL_POLICY_BOUNDARIES.map((row) => row.title)).toEqual([
      "Repository-authorized behavior", "Effective least-privilege policy", "Owner clarification required before any ALLOW",
    ]);
  });
});
