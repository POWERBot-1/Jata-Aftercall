/**
 * Team roles (POS / ERP - PRO).
 *
 * The ERP role must never leak into the shared membership column, because the Business POS reads
 * the same row. These tests pin that separation, the ownership rule and the "no self-lockout" rule.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import {
  ASSIGNABLE_ROLES,
  assignedTeamRole,
  parseTeamRoles,
  resolveMemberRole,
  setTeamRole,
  TEAM_ROLE_GUIDE,
  validateRoleChange,
} from "@/lib/erp/team";
import { resolveErpRole } from "@/lib/erp/access";

let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

const base = {
  businessId: "bizA",
  actorId: "userA",
  actorName: "Amina",
  actorRole: "OWNER" as const,
  targetUserId: "cashierA",
  role: "FINANCE",
  ownerId: "userA",
};

describe("role parsing", () => {
  it("keeps known roles and drops anything else", () => {
    expect(parseTeamRoles('{"u1":"MANAGER","u2":"FINANCE","u3":"WIZARD","u4":42,"u5":"OWNER"}')).toEqual({ u1: "MANAGER", u2: "FINANCE" });
    expect(parseTeamRoles("not json")).toEqual({});
    expect(parseTeamRoles(null)).toEqual({});
  });

  it("never assigns the owner role from storage, even if a row was hand-edited", () => {
    expect(assignedTeamRole({ u1: "OWNER" }, "u1")).toBeNull();
    expect(resolveMemberRole({ ownerId: "userA", userId: "u1", membershipRole: "STAFF", teamRoles: { u1: "OWNER" } })).toBe("STAFF");
    expect(ASSIGNABLE_ROLES).not.toContain("OWNER");
  });

  it("resolves ownership first, then the ERP assignment, then the shared role", () => {
    const teamRoles = parseTeamRoles('{"cashierA":"FINANCE"}');
    expect(resolveMemberRole({ ownerId: "userA", userId: "userA", membershipRole: "STAFF", teamRoles })).toBe("OWNER");
    expect(resolveMemberRole({ ownerId: "userA", userId: "cashierA", membershipRole: "MANAGER", teamRoles })).toBe("FINANCE");
    expect(resolveMemberRole({ ownerId: "userA", userId: "other", membershipRole: "ACCOUNTANT", teamRoles })).toBe("FINANCE");
    expect(resolveMemberRole({ ownerId: "userA", userId: "stranger", membershipRole: "SOMETHING", teamRoles })).toBe("VIEWER");
  });

  it("is the same resolution the access layer applies", () => {
    expect(resolveErpRole({ ownerId: "userA", userId: "userA", membershipRole: "STAFF", teamRolesJson: "{}" })).toBe("OWNER");
    expect(resolveErpRole({ ownerId: "userA", userId: "cashierA", membershipRole: "MANAGER", teamRolesJson: '{"cashierA":"VIEWER"}' })).toBe("VIEWER");
  });

  it("describes every assignable role", () => {
    expect(TEAM_ROLE_GUIDE.map((entry) => entry.role).sort()).toEqual([...ASSIGNABLE_ROLES].sort());
    expect(TEAM_ROLE_GUIDE.every((entry) => entry.summary.length > 20)).toBe(true);
  });
});

describe("role change rules", () => {
  const check = (overrides: Partial<Parameters<typeof validateRoleChange>[0]> = {}) =>
    validateRoleChange({ actorId: "userA", actorRole: "OWNER", targetUserId: "cashierA", targetIsOwner: false, role: "FINANCE", ...overrides });

  it("allows an owner to give a member a role", () => {
    expect(check()).toEqual({ ok: true, error: null, code: null });
  });

  it("refuses staff, finance and viewers outright", () => {
    for (const role of ["STAFF", "FINANCE", "VIEWER", "MANAGER"] as const) {
      expect(check({ actorRole: role }).code).toBe("PERMISSION");
    }
  });

  it("refuses to edit the owner's role and refuses to grant ownership", () => {
    expect(check({ targetIsOwner: true }).code).toBe("OWNER_IMMUTABLE");
    expect(check({ role: "OWNER" }).code).toBe("OWNER_NOT_ASSIGNABLE");
  });

  it("refuses a self-change so the last administrator cannot lock themselves out", () => {
    expect(check({ actorId: "admin1", targetUserId: "admin1" }).code).toBe("SELF_CHANGE");
  });

  it("stops an administrator creating another administrator", () => {
    expect(check({ actorRole: "ADMIN", role: "ADMIN" }).code).toBe("ADMIN_ESCALATION");
    expect(check({ actorRole: "ADMIN", role: "MANAGER" }).ok).toBe(true);
  });

  it("rejects a role nobody defined", () => {
    expect(check({ role: "SUPERUSER" }).code).toBe("ROLE_UNKNOWN");
    expect(check({ role: "" }).code).toBe("ROLE_UNKNOWN");
  });
});

describe("saving a role", () => {
  it("stores the ERP role outside the shared membership column and audits it", async () => {
    const result = await setTeamRole(fake.db, base);
    expect(result.role).toBe("FINANCE");
    expect(result.previous).toBe("MANAGER");
    expect(fake.rows("businessMember").find((row) => row.id === "mem_a")!.role).toBe("MANAGER");
    const configuration = fake.rows("erpConfiguration").find((row) => row.businessId === "bizA")!;
    expect(JSON.parse(String(configuration.teamRolesJson))).toEqual({ cashierA: "FINANCE" });
    expect(fake.rows("erpAuditEvent").some((row) => row.action === "TEAM_ROLE_CHANGED")).toBe(true);
  });

  it("replaces an earlier assignment rather than stacking duplicates", async () => {
    await setTeamRole(fake.db, base);
    await setTeamRole(fake.db, { ...base, role: "VIEWER" });
    expect(JSON.parse(String(fake.rows("erpConfiguration").find((row) => row.businessId === "bizA")!.teamRolesJson))).toEqual({ cashierA: "VIEWER" });
  });

  it("refuses someone who is not a member of this business", async () => {
    await expect(setTeamRole(fake.db, { ...base, targetUserId: "stranger" })).rejects.toMatchObject({ status: 404, code: "NOT_A_MEMBER" });
  });

  it("refuses before a workspace exists", async () => {
    fake.rows("erpConfiguration").length = 0;
    await expect(setTeamRole(fake.db, base)).rejects.toMatchObject({ status: 409, code: "WORKSPACE_NOT_READY" });
  });

  it("refuses an owner edit even when the form is forged", async () => {
    await expect(setTeamRole(fake.db, { ...base, targetUserId: "userA", role: "VIEWER" })).rejects.toMatchObject({ code: "OWNER_IMMUTABLE" });
  });

  it("cannot be used to reach another tenant's member", async () => {
    await expect(
      setTeamRole(fake.db, { ...base, businessId: "bizB", actorId: "userA" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
