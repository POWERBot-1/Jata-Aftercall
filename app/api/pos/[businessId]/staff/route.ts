import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { BUILT_IN_ROLES, effectivePermissions, getBuiltInRole, isBuiltInRoleKey, permissionLabel, resolveRoles } from "@/lib/pos/permissions";
import { createStaff, listBranches, listStaff, updateStaff } from "@/lib/pos/store";
import { sanitizeStaffInput } from "@/lib/pos/validation";

/**
 * Staff and roles (§15, §36).
 *
 * A role is a named set of capability-action permissions. The list offered here is generated
 * from the configuration, so a salon sees Stylist and a garage sees Technician — one permission
 * engine, different words (§52). Changing someone's role is a permission change and is audited
 * with the before and after (§37).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "VIEW_STAFF", fast: true },
    fallback: "We couldn't load your team.",
    handler: async ({ ctx }) => {
      // The roster is a business-wide record, but the locations a person can be assigned to are
      // read under the actor's own scope, exactly as the locations API reads them (§16, §75).
      const [staff, branches] = await Promise.all([
        listStaff(businessId, { activeOnly: false }),
        listBranches(businessId, undefined, { only: ctx.branchId }),
      ]);
      const roles = resolveRoles(ctx.configuration).map((role) => ({
        key: role.key,
        name: role.name,
        blurb: getBuiltInRole(role.key)?.blurb ?? "",
        permissions: role.permissions,
        builtIn: role.builtIn,
      }));
      return posOk({
        staff,
        branches,
        roles,
        builtInRoles: BUILT_IN_ROLES.map((role) => ({ key: role.key, name: role.name, blurb: role.blurb })),
        permissionLabels: Object.fromEntries(
          roles.flatMap((role) => role.permissions.map((permission) => [permission, permissionLabel(permission)])),
        ),
        attribution: ctx.configuration.staff.attribution,
        commissions: ctx.configuration.staff.commissions,
        canManage: ctx.permissions.includes("MANAGE_USERS"),
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_USERS" },
    fallback: "We couldn't save that person.",
    handler: async ({ ctx, actor, body }) => {
      const input = sanitizeStaffInput(body);
      if (!input.name) return fromOutcome({ ok: false, message: "Enter their name." });

      // A role that this configuration does not define is refused, not invented (§36, §52).
      const allowed = new Set(resolveRoles(ctx.configuration).map((role) => role.key));
      if (!allowed.has(input.roleKey) && !isBuiltInRoleKey(input.roleKey)) {
        return fromOutcome({ ok: false, message: `"${input.roleKey}" is not one of the roles your POS uses.`, code: "UNKNOWN_ROLE" });
      }

      const existing = await listStaff(businessId, { activeOnly: false });
      const match = existing.find((member: any) => member.id === body.staffId);
      if (match) {
        await updateStaff(businessId, match.id, input);
        await logPosAudit({
          businessId,
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: match.roleKey === input.roleKey ? "POS_STAFF_ADDED" : "POS_PERMISSION_CHANGED",
          targetType: "STAFF",
          targetId: match.id,
          before: { name: match.name, roleKey: match.roleKey, isActive: match.isActive, permissions: effectivePermissions(ctx.configuration, match.roleKey) },
          after: { name: input.name, roleKey: input.roleKey, isActive: input.isActive, permissions: effectivePermissions(ctx.configuration, input.roleKey) },
        });
        return fromOutcome({ ok: true, warnings: [] }, { staffId: match.id, updated: true });
      }

      const created = await createStaff(businessId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_STAFF_ADDED",
        targetType: "STAFF",
        targetId: created.id,
        metadata: { name: input.name, roleKey: input.roleKey, permissions: effectivePermissions(ctx.configuration, input.roleKey) },
      });
      return fromOutcome({ ok: true, warnings: [] }, { staffId: created.id }, 201);
    },
  });
}
