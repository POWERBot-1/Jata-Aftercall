import { cookies } from "next/headers";
import { getSession, type SessionPayload } from "@/lib/auth";
import prisma from "@/lib/db";
import { verifyControlMfaSession } from "./mfa";
import { isControlRole, type ControlPermission, type ControlRoleName } from "./permissions";
import { CONTROL_ROLE_POLICY_APPROVED, filterControlRolePermissions } from "./role-policy";

export const CONTROL_MFA_COOKIE = "jata_control_mfa";

export type ControlGrant = {
  id: string;
  role: ControlRoleName;
  permissionKeys: string[];
  scopeBusinessId: string | null;
};

export type ControlIdentity = {
  session: SessionPayload;
  grants: ControlGrant[];
};

export type ControlAccessResult =
  | { ok: true; identity: ControlIdentity }
  | { ok: false; status: 401 | 403 | 503; code: "UNAUTHENTICATED" | "POLICY_PENDING" | "CONTROL_ACCESS_REQUIRED" | "MFA_REQUIRED" | "ACCESS_UNAVAILABLE" };

/** Read entitlements from the database on every request. JWT role claims never grant control access. */
export async function getControlIdentity(): Promise<ControlAccessResult> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  if (!CONTROL_ROLE_POLICY_APPROVED) return { ok: false, status: 403, code: "POLICY_PENDING" };
  try {
    const rows = await prisma.controlRoleGrant.findMany({
      where: { userId: session.userId, revokedAt: null },
      select: { id: true, role: true, permissionKeys: true, scopeBusinessId: true },
      orderBy: { createdAt: "desc" },
    });
    const grants: ControlGrant[] = [];
    for (const row of rows as any[]) {
      // Unknown role labels and database grants outside the explicit per-role policy are ignored.
      // The grant table can narrow this matrix but cannot add capabilities to a role.
      if (typeof row.role !== "string" || !isControlRole(row.role) || !Array.isArray(row.permissionKeys)) continue;
      const permissionKeys = filterControlRolePermissions(row.role, row.permissionKeys);
      if (!permissionKeys.length) continue;
      grants.push({
        id: row.id as string,
        role: row.role as ControlRoleName,
        permissionKeys,
        scopeBusinessId: row.scopeBusinessId as string | null,
      });
    }
    if (!grants.length) return { ok: false, status: 403, code: "CONTROL_ACCESS_REQUIRED" };
    return { ok: true, identity: { session, grants } };
  } catch {
    return { ok: false, status: 503, code: "ACCESS_UNAVAILABLE" };
  }
}

export function hasControlPermission(grants: ControlGrant[], permission: ControlPermission, businessId?: string): boolean {
  return grants.some((grant) => grant.permissionKeys.includes(permission)
    && (businessId === undefined || grant.scopeBusinessId === null || grant.scopeBusinessId === businessId));
}

export function scopedBusinessIds(grants: ControlGrant[], permission: ControlPermission): { allowed: boolean; global: boolean; ids: string[] } {
  const matching = grants.filter((grant) => grant.permissionKeys.includes(permission));
  if (!matching.length) return { allowed: false, global: false, ids: [] };
  const global = matching.some((grant) => grant.scopeBusinessId === null);
  return { allowed: true, global, ids: [...new Set(matching.map((grant) => grant.scopeBusinessId).filter((id): id is string => Boolean(id)))].sort() };
}

export async function requireControlPermission(permission: ControlPermission, businessId?: string): Promise<ControlAccessResult> {
  const result = await getControlIdentity();
  if (!result.ok) return result;
  if (!hasControlPermission(result.identity.grants, permission, businessId)) {
    return { ok: false, status: 403, code: "CONTROL_ACCESS_REQUIRED" };
  }
  try {
    const cookieStore = await cookies();
    const credential = await prisma.controlMfaCredential.findUnique({
      where: { userId: result.identity.session.userId },
      select: { verifiedAt: true },
    });
    const token = cookieStore.get(CONTROL_MFA_COOKIE)?.value;
    if (!credential?.verifiedAt || !verifyControlMfaSession(token, {
      userId: result.identity.session.userId,
      sessionVersion: result.identity.session.sessionVersion ?? 0,
    })) return { ok: false, status: 403, code: "MFA_REQUIRED" };
    return result;
  } catch {
    return { ok: false, status: 503, code: "ACCESS_UNAVAILABLE" };
  }
}

export async function requireAnyControlPermission(permissions: readonly ControlPermission[]): Promise<ControlAccessResult> {
  const result = await getControlIdentity();
  if (!result.ok) return result;
  if (!permissions.some((permission) => hasControlPermission(result.identity.grants, permission))) {
    return { ok: false, status: 403, code: "CONTROL_ACCESS_REQUIRED" };
  }
  try {
    const cookieStore = await cookies();
    const credential = await prisma.controlMfaCredential.findUnique({
      where: { userId: result.identity.session.userId },
      select: { verifiedAt: true },
    });
    const token = cookieStore.get(CONTROL_MFA_COOKIE)?.value;
    if (!credential?.verifiedAt || !verifyControlMfaSession(token, {
      userId: result.identity.session.userId,
      sessionVersion: result.identity.session.sessionVersion ?? 0,
    })) return { ok: false, status: 403, code: "MFA_REQUIRED" };
    return result;
  } catch {
    return { ok: false, status: 503, code: "ACCESS_UNAVAILABLE" };
  }
}

export function controlAccessError(result: Extract<ControlAccessResult, { ok: false }>): { error: string; code: string } {
  const messages = {
    UNAUTHENTICATED: "Sign in to continue.",
    POLICY_PENDING: "Control access is disabled until the owner approves the six-role permission policy.",
    CONTROL_ACCESS_REQUIRED: "No active control-plane permission grants this operation.",
    MFA_REQUIRED: "Verify your control-plane MFA to continue.",
    ACCESS_UNAVAILABLE: "Control access could not be verified. No action was performed.",
  } as const;
  return { error: messages[result.code], code: result.code };
}
