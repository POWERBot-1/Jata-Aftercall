/**
 * Team roles for POS / ERP - PRO.
 *
 * The existing platform stores a membership role for each business member, but those values also
 * drive the Business POS and the public profile. Writing ERP roles ("FINANCE", "VIEWER", …) into
 * that shared column would quietly change POS behaviour for the same person, so ERP roles live in
 * the ERP configuration instead: additive, tenant-scoped, and invisible to the POS.
 *
 * Rules enforced here, not only in the UI:
 *  - the owner is the owner because they own the business; that cannot be reassigned from a form;
 *  - nobody can change their own role (no accidental self-lockout);
 *  - only OWNER and ADMIN may manage roles, and an ADMIN cannot mint another ADMIN;
 *  - every change is written with `logErpAudit` and takes effect on the next request.
 */

import { logErpAudit } from "./audit";
import { ERP_ROLES, hasErpPermission, normalizeErpRole, type ErpRole } from "./access";

/** OWNER is never assignable: it follows business ownership. */
export const ASSIGNABLE_ROLES: ErpRole[] = ERP_ROLES.filter((role) => role !== "OWNER");

export const TEAM_ROLE_GUIDE: Array<{ role: ErpRole; label: string; summary: string; approver: boolean }> = [
  { role: "ADMIN", label: "Administrator", summary: "Everything except transferring ownership, including team roles and settings.", approver: true },
  { role: "MANAGER", label: "Manager", summary: "Day-to-day operations, invoices, messaging and store; approves up to KES 10,000.", approver: true },
  { role: "FINANCE", label: "Finance", summary: "Invoices, payments, books and reports; approves up to KES 50,000. No team changes.", approver: true },
  { role: "STAFF", label: "Staff", summary: "Sell, take orders, add customers and send approved campaigns. Cannot approve spending.", approver: false },
  { role: "VIEWER", label: "Viewer", summary: "Read-only dashboards and reports, for an accountant or an auditor.", approver: false },
];

export type TeamRoles = Record<string, ErpRole>;

export function parseTeamRoles(raw: unknown): TeamRoles {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const roles: TeamRoles = {};
  for (const [userId, role] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = String(role ?? "").toUpperCase();
    // OWNER is never read back from configuration: ownership comes from Business.ownerId only, so a
    // hand-edited row cannot promote somebody to owner-level permissions.
    if (cleaned !== "OWNER" && ERP_ROLES.includes(cleaned as ErpRole)) roles[userId] = cleaned as ErpRole;
  }
  return roles;
}

/** The ERP role explicitly assigned to this user, or null when none was assigned. */
export function assignedTeamRole(roles: TeamRoles, userId: string | null | undefined): ErpRole | null {
  if (!userId) return null;
  const role = roles[userId];
  return role && role !== "OWNER" ? role : null;
}

/**
 * Effective ERP role: ownership wins, then the ERP assignment, then the shared membership role.
 * `normalizeErpRole` keeps an unknown membership value at the least-privileged role.
 */
export function resolveMemberRole(input: {
  ownerId: string | null | undefined;
  userId: string | null | undefined;
  membershipRole: string | null | undefined;
  teamRoles: TeamRoles;
}): ErpRole {
  if (input.userId && input.ownerId && input.ownerId === input.userId) return "OWNER";
  const assigned = assignedTeamRole(input.teamRoles, input.userId);
  if (assigned) return assigned;
  return normalizeErpRole(input.membershipRole);
}

export type RoleChangeCheck = { ok: boolean; error: string | null; code: string | null };

export function validateRoleChange(input: {
  actorId: string;
  actorRole: ErpRole;
  targetUserId: string;
  targetIsOwner: boolean;
  role: string;
}): RoleChangeCheck {
  const role = String(input.role ?? "").toUpperCase();
  if (!hasErpPermission(input.actorRole, "MANAGE_USERS")) {
    return { ok: false, error: "Only an owner or administrator can change roles.", code: "PERMISSION" };
  }
  if (input.targetIsOwner) {
    return { ok: false, error: "The owner's role comes from owning the business. Transfer ownership instead of editing it here.", code: "OWNER_IMMUTABLE" };
  }
  if (input.actorId === input.targetUserId) {
    return { ok: false, error: "Ask another owner or administrator to change your own role, so you cannot lock yourself out.", code: "SELF_CHANGE" };
  }
  if (role === "OWNER") {
    return { ok: false, error: "There is one owner per business. Transfer ownership rather than granting the owner role.", code: "OWNER_NOT_ASSIGNABLE" };
  }
  if (!(ASSIGNABLE_ROLES as string[]).includes(role)) {
    return { ok: false, error: "Choose one of the listed roles.", code: "ROLE_UNKNOWN" };
  }
  if (input.actorRole === "ADMIN" && role === "ADMIN") {
    return { ok: false, error: "An administrator cannot create another administrator. Ask the owner.", code: "ADMIN_ESCALATION" };
  }
  return { ok: true, error: null, code: null };
}

/**
 * Persist a role change. The caller has already authenticated; this function re-reads the
 * configuration so a stale form cannot overwrite a newer assignment, then audits the change.
 */
export async function setTeamRole(
  client: any,
  input: {
    businessId: string;
    actorId: string;
    actorName?: string | null;
    actorRole: ErpRole;
    targetUserId: string;
    role: string;
    ownerId: string;
  },
) {
  const configuration = await client.erpConfiguration.findUnique({ where: { businessId: input.businessId } });
  if (!configuration) {
    throw Object.assign(new Error("Set up the workspace before inviting people."), { status: 409, code: "WORKSPACE_NOT_READY" });
  }

  const check = validateRoleChange({
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetUserId: input.targetUserId,
    targetIsOwner: input.targetUserId === input.ownerId,
    role: input.role,
  });
  if (!check.ok) throw Object.assign(new Error(String(check.error)), { status: 403, code: check.code });

  const member = await client.businessMember.findUnique({
    where: { userId_businessId: { userId: input.targetUserId, businessId: input.businessId } },
  });
  if (!member) throw Object.assign(new Error("That person is not a member of this business yet."), { status: 404, code: "NOT_A_MEMBER" });

  const roles = parseTeamRoles(configuration.teamRolesJson);
  const previous = resolvedPrevious(roles, member.role, input.targetUserId);
  const next: TeamRoles = { ...roles, [input.targetUserId]: String(input.role).toUpperCase() as ErpRole };

  const updated = await client.erpConfiguration.update({
    where: { businessId: input.businessId },
    data: { teamRolesJson: JSON.stringify(next) },
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName ?? null,
    action: "TEAM_ROLE_CHANGED",
    targetType: "BUSINESS_MEMBER",
    targetId: input.targetUserId,
    before: { role: previous },
    after: { role: next[input.targetUserId] },
    client,
  });

  return { configuration: updated, roles: next, previous, role: next[input.targetUserId] };
}

function resolvedPrevious(roles: TeamRoles, membershipRole: string | null | undefined, userId: string): ErpRole {
  return assignedTeamRole(roles, userId) ?? normalizeErpRole(membershipRole);
}
