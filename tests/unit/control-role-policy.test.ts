import { describe, expect, it } from "vitest";
import { CONTROL_ROLE_POLICY, CONTROL_ROLE_POLICY_COLUMNS, CONTROL_POLICY_BOUNDARIES, CONTROL_ROLE_POLICY_APPROVED } from "@/lib/control/role-policy";
import { CONTROL_ROLE_NAMES } from "@/lib/control/permissions";

describe("Control role/action matrix", () => {
  it("keeps authorization globally disabled until owner approval is recorded", () => {
    expect(CONTROL_ROLE_POLICY_APPROVED).toBe(false);
  });

  it("covers the six canonical roles and keeps role descriptions explicitly provisional", () => {
    expect(CONTROL_ROLE_POLICY.map((row) => row.role)).toEqual([...CONTROL_ROLE_NAMES]);
    expect(CONTROL_ROLE_POLICY.every((row) => /proposed|unresolved/i.test(row.responsibility))).toBe(true);
  });

  it("makes every permission dimension visible and pending rather than assigning role grants", () => {
    expect(CONTROL_ROLE_POLICY_COLUMNS.map((column) => column.label)).toEqual([
      "Read", "Write", "Approval", "Financial", "Tenant scope", "Sensitive administration", "MFA", "Audit",
    ]);
    expect(CONTROL_ROLE_POLICY_COLUMNS.some((column) => /pending|denied|unassigned/i.test(column.value))).toBe(true);
    expect(CONTROL_POLICY_BOUNDARIES.map((row) => row.title)).toEqual([
      "Repository-authorized behavior", "Safe technical behavior", "Owner approval required",
    ]);
  });
});
