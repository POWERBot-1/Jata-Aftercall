// Tenant isolation & business role enforcement (§5, §46) — never trust client-supplied tenant IDs.
// Every business-owned resource belongs to an authenticated tenant and must be verified
// at the data-access boundary before read, update, or delete.
import prisma from "./db";
import { SessionPayload } from "./auth";
import { publicErrorMessage, SAFE_ERRORS } from "./safeError";

export const BUSINESS_ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF", "VIEWER"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export type RolePermissionLevel =
  | "read"
  | "operate"
  | "configure"
  | "manage_billing"
  | "high_risk"
  | "publish"
  | "manage_orders"
  | "edit_knowledge"
  | "manage_settings";

const ROLE_WEIGHT: Record<BusinessRole, number> = {
  VIEWER: 10,
  STAFF: 20,
  MANAGER: 30,
  ADMIN: 40,
  OWNER: 50,
};

const ACTION_MIN_WEIGHT: Record<RolePermissionLevel, number> = {
  read: 10, // VIEWER, STAFF, MANAGER, ADMIN, OWNER
  operate: 20, // STAFF, MANAGER, ADMIN, OWNER (orders, leads, handoff)
  manage_orders: 20, // STAFF, MANAGER, ADMIN, OWNER
  configure: 30, // MANAGER, ADMIN, OWNER (products, inventory, knowledge, AI config)
  edit_knowledge: 30, // MANAGER, ADMIN, OWNER
  manage_settings: 30, // MANAGER, ADMIN, OWNER
  high_risk: 30, // MANAGER, ADMIN, OWNER (refund, cancel, price/inventory override)
  manage_billing: 40, // ADMIN, OWNER (payment destination, publish, subscription)
  publish: 40, // ADMIN, OWNER
};

export function normalizeBusinessRole(raw: unknown): BusinessRole {
  const upper = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if ((BUSINESS_ROLES as readonly string[]).includes(upper)) {
    return upper as BusinessRole;
  }
  return "OWNER";
}

export function canBusinessRolePerform(
  role: BusinessRole | null | undefined,
  action: RolePermissionLevel,
): boolean {
  if (!role) return false;
  return (ROLE_WEIGHT[role] ?? 0) >= (ACTION_MIN_WEIGHT[action] ?? 50);
}

export class TenantError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
    this.name = "TenantError";
  }
}

/**
 * Returns business IDs owned by (or member of) the session user.
 */
export async function getOwnedBusinessIds(session: SessionPayload): Promise<string[]> {
  const owned =
    (await prisma.business?.findMany?.({
      where: { ownerId: session.userId },
      select: { id: true },
    }).catch(() => [])) || [];
  const member =
    (await prisma.businessMember?.findMany?.({
      where: { userId: session.userId },
      select: { businessId: true },
    }).catch(() => [])) || [];
  return [...owned.map((b: any) => b.id), ...member.map((m: any) => m.businessId)];
}

/**
 * Checks whether a user can access a business (owner, member, or platform ADMIN).
 */
export async function canAccessBusiness(
  userId: string,
  businessId: string,
  userRole?: string | null,
): Promise<boolean> {
  if (!userId || !businessId) return false;
  if (userRole === "ADMIN") return true;

  try {
    if (prisma.business?.findFirst) {
      // `Business` is owned through `ownerId` (there is no `userId` column on the model).
      // Never filter on a field the schema does not define: an invalid Prisma `where` throws
      // for every tenant check instead of answering it.
      const directByOwner = await prisma.business
        .findFirst({
          where: { id: businessId, ownerId: userId },
          select: { id: true },
        })
        .catch(() => null);
      if (directByOwner?.id) return true;
    }

    if (prisma.business?.findUnique) {
      const biz = await prisma.business
        .findUnique({ where: { id: businessId } })
        .catch(() => null);
      if (biz && ((biz as any).ownerId === userId || (biz as any).userId === userId)) {
        return true;
      }
    }

    if (prisma.businessMember?.findMany) {
      const members = await prisma.businessMember
        .findMany({ where: { userId }, select: { businessId: true } })
        .catch(() => []);
      if (Array.isArray(members) && members.some((m: any) => m.businessId === businessId)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Resolve the effective business role for the authenticated user on a specific business.
 * Supports both `(businessId, session)` and `(userId, businessId, userRole?)`.
 */
export async function getBusinessRoleForUser(
  arg1: string,
  arg2: SessionPayload | string,
  arg3?: string | null,
): Promise<BusinessRole | null> {
  let userId: string;
  let businessId: string;
  let userRole: string | undefined;

  if (typeof arg2 === "object" && arg2 !== null && "userId" in arg2) {
    businessId = arg1;
    userId = arg2.userId;
    userRole = arg2.role;
  } else {
    userId = arg1;
    businessId = String(arg2);
    userRole = arg3 || undefined;
  }

  if (!businessId || !userId) return null;
  if (userRole === "ADMIN") return "ADMIN";

  const hasDirectAccess = await canAccessBusiness(userId, businessId, userRole);
  if (hasDirectAccess) {
    if (prisma.businessMember?.findMany) {
      const members = await prisma.businessMember
        .findMany({ where: { userId }, select: { businessId: true, role: true } })
        .catch(() => []);
      const match = (Array.isArray(members) ? members : []).find(
        (m: any) => m.businessId === businessId,
      );
      if (match?.role) return normalizeBusinessRole(match.role);
    }
    return "OWNER";
  }

  return null;
}

/**
 * Throws if business does not belong to session user.
 */
export async function assertBusinessOwnership(businessId: string, session: SessionPayload) {
  if (!businessId) throw new TenantError("Missing businessId", 400);
  if (session.role === "ADMIN") return;
  const ownedIds = await getOwnedBusinessIds(session);
  if (ownedIds.includes(businessId)) return;
  const direct = await canAccessBusiness(session.userId, businessId, session.role);
  if (!direct) {
    throw new TenantError("Tenant isolation: business does not belong to authenticated user");
  }
}

export async function assertBusinessRole(params: {
  userId: string;
  businessId: string;
  userRole?: string | null;
  action?: RolePermissionLevel;
}): Promise<{ allowed: boolean; role: BusinessRole | null }>;
export async function assertBusinessRole(
  businessId: string,
  session: SessionPayload,
  action?: RolePermissionLevel,
): Promise<BusinessRole>;
export async function assertBusinessRole(
  arg1:
    | string
    | {
        userId: string;
        businessId: string;
        userRole?: string | null;
        action?: RolePermissionLevel;
      },
  arg2?: SessionPayload,
  arg3: RolePermissionLevel = "configure",
): Promise<BusinessRole | { allowed: boolean; role: BusinessRole | null }> {
  if (typeof arg1 === "object" && arg1 !== null) {
    const role = await getBusinessRoleForUser(arg1.userId, arg1.businessId, arg1.userRole);
    const action = arg1.action || "configure";
    const allowed = Boolean(role && canBusinessRolePerform(role, action));
    return { allowed, role };
  }

  const businessId = String(arg1);
  const session = arg2!;
  if (!businessId) throw new TenantError("Missing businessId", 400);
  const role = await getBusinessRoleForUser(businessId, session);
  if (!role) {
    throw new TenantError("Tenant isolation: business does not belong to authenticated user", 403);
  }
  if (!canBusinessRolePerform(role, arg3)) {
    throw new TenantError(`Insufficient role (${role}) for action (${arg3}).`, 403);
  }
  return role;
}

export async function loadBusinessForTenant(businessId: string, session: SessionPayload) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new TenantError("Business not found", 404);
  await assertBusinessOwnership(businessId, session);
  return business;
}

export async function assertSlugOwnershipByBusinessId(businessId: string, session: SessionPayload) {
  await assertBusinessOwnership(businessId, session);
}

export async function guardTenantMutation(
  session: SessionPayload | null,
  businessId?: string | null,
  requiredAction: RolePermissionLevel = "read",
) {
  if (!session) return { ok: false as const, status: 401, error: SAFE_ERRORS.signIn };
  if (!businessId) return { ok: false as const, status: 400, error: SAFE_ERRORS.chooseBusiness };
  try {
    await assertBusinessOwnership(businessId, session);
    if (requiredAction !== "read") {
      const role = await getBusinessRoleForUser(businessId, session);
      if (role && !canBusinessRolePerform(role, requiredAction)) {
        return { ok: false as const, status: 403, error: SAFE_ERRORS.noAccess };
      }
    }
    return { ok: true as const };
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    return { ok: false as const, status: mapped.status, error: mapped.message };
  }
}
