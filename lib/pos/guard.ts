/**
 * POS access boundary (§5, §36, §56, §75)
 *
 * One function stands between an HTTP request and tenant-owned POS data. It derives the
 * business from authenticated membership (never from a body or a header), refuses anything
 * the subscription state does not allow, and checks the capability-level permission for the
 * action. Every refusal is audited so an attack pattern is visible (§37).
 */

import prisma from "../db";
import { getSession, type SessionPayload } from "../auth";
import { assertBusinessOwnership, TenantError } from "../tenant";
import { publicErrorMessage, SAFE_ERRORS } from "../safeError";
import { checkPermission, effectivePermissions, type PermissionKey } from "./permissions";
import { baselineConfiguration } from "./configuration";
import { derivePosEntitlement, POS_LIFECYCLE_LABELS, syncPosEntitlement, type PosEntitlementState } from "./entitlement";
import { effectiveConfiguration, loadConfiguration, type ConfigurationRecord } from "./provisioning";
import { logPosAudit } from "./audit";
import { resolveTerminology, type Terminology } from "./terminology";
import type { PosConfiguration, PosLifecycleStatus } from "./types";

export class PosAccessError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = "FORBIDDEN") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "PosAccessError";
  }
}

export type PosBusiness = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  whatsapp: string | null;
  location: string | null;
  logoUrl: string | null;
  email: string | null;
  ownerId: string;
};

export type PosContext = {
  session: SessionPayload;
  business: PosBusiness;
  /** The POS role this person acts under, resolved server-side (§36). */
  roleKey: string;
  permissions: PermissionKey[];
  staffId: string | null;
  staffName: string | null;
  record: ConfigurationRecord | null;
  configuration: PosConfiguration;
  terminology: Terminology;
  entitlement: PosEntitlementState;
  lifecycle: PosLifecycleStatus;
  lifecycleLabel: string;
  /** Branch scoping for multi-location businesses (§16). */
  branchId: string | null;
};

export type PosAccessOptions = {
  /** Capability-level permission required for this action (§36). */
  permission?: PermissionKey;
  /** Refuse unless the subscription permits the paid product (§44). */
  requireLive?: boolean;
  /** Skip the entitlement refresh — for read-only screens that tolerate a stale badge. */
  fast?: boolean;
};

/**
 * Resolve and authorize a POS request. Throws `PosAccessError` with a plain-language message
 * that is safe to show an owner (§38) and leaks nothing about other tenants (§56).
 */
export async function requirePosAccess(
  businessId: string | null | undefined,
  session: SessionPayload | null,
  options: PosAccessOptions = {},
): Promise<PosContext> {
  if (!session) throw new PosAccessError(SAFE_ERRORS.signIn, 401, "UNAUTHENTICATED");
  const id = typeof businessId === "string" ? businessId.trim() : "";
  if (!id) throw new PosAccessError(SAFE_ERRORS.chooseBusiness, 400, "MISSING_BUSINESS");

  const business = await prisma.business.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, phone: true, whatsapp: true, location: true, logoUrl: true, ownerId: true },
  });
  if (!business) throw new PosAccessError(SAFE_ERRORS.notFound, 404, "NOT_FOUND");

  try {
    // Tenant isolation is derived from the session, never from the request body (§5).
    await assertBusinessOwnership(id, session);
  } catch (error) {
    await logPosAudit({
      businessId: id,
      actorId: session.userId,
      action: "POS_ACCESS_DENIED",
      targetType: "BUSINESS",
      targetId: id,
      metadata: { reason: error instanceof TenantError ? "TENANT_ISOLATION" : "UNKNOWN" },
    });
    if (error instanceof TenantError && error.status === 404) throw new PosAccessError(SAFE_ERRORS.notFound, 404, "NOT_FOUND");
    throw new PosAccessError(SAFE_ERRORS.noAccess, 403, "TENANT_ISOLATION");
  }

  const [record, entitlement, staff, membership] = await Promise.all([
    loadConfiguration(id).catch(() => null),
    options.fast ? readEntitlementQuietly(id) : syncPosEntitlement(id).catch(() => null),
    prisma.posStaff.findFirst({ where: { businessId: id, userId: session.userId }, select: { id: true, name: true, roleKey: true, isActive: true, branchId: true } }).catch(() => null),
    prisma.businessMember.findFirst({ where: { businessId: id, userId: session.userId }, select: { role: true } }).catch(() => null),
  ]);

  const configuration = effectiveConfiguration(record, entitlement?.lifecycle ?? "DRAFT") ?? baselineConfiguration();
  const roleKey = resolveRoleKey({ businessOwnerId: business.ownerId, session, staff, membershipRole: membership?.role });
  const permissions = effectivePermissions(configuration, roleKey);

  if (options.requireLive && !entitlement?.entitled) {
    await logPosAudit({ businessId: id, actorId: session.userId, action: "POS_ACCESS_DENIED", targetType: "BUSINESS", targetId: id, metadata: { reason: "NOT_ENTITLED", lifecycle: entitlement?.lifecycle ?? "DRAFT" } });
    throw new PosAccessError(entitlement?.reason ?? "Complete your subscription to use the POS.", 402, "PAYMENT_REQUIRED");
  }

  if (options.permission && staff && staff.isActive === false) {
    throw new PosAccessError("Your staff record is not active for this business.", 403, "STAFF_INACTIVE");
  }

  if (options.permission) {
    const decision = checkPermission(configuration, roleKey, options.permission);
    if (!decision.allowed) {
      await logPosAudit({
        businessId: id,
        actorId: session.userId,
        actorName: staff?.name ?? session.name ?? null,
        action: "POS_ACCESS_DENIED",
        targetType: "PERMISSION",
        targetId: options.permission,
        metadata: { reason: "PERMISSION", roleKey },
      });
      throw new PosAccessError(decision.reason ?? SAFE_ERRORS.noAccess, 403, "PERMISSION");
    }
  }

  // Branch scoping comes from the staff row already resolved inside this tenant (§16).
  const branch = staff?.branchId ?? null;

  const state = entitlement ?? derivePosEntitlement({ configurationStatus: record?.status ?? "DRAFT" });
  return {
    session,
    business: { ...business, email: null } as PosBusiness,
    roleKey,
    permissions,
    staffId: staff?.id ?? null,
    staffName: staff?.name ?? session.name ?? null,
    record,
    configuration,
    terminology: resolveTerminology(configuration),
    entitlement: state,
    lifecycle: state.lifecycle,
    lifecycleLabel: POS_LIFECYCLE_LABELS[state.lifecycle].label,
    branchId: branch,
  };
}

async function readEntitlementQuietly(businessId: string): Promise<PosEntitlementState | null> {
  try {
    return await syncPosEntitlement(businessId);
  } catch {
    return null;
  }
}

/** Convenience for route handlers: read the session and authorize in one call. */
export async function requirePosAccessFromRequest(businessId: string | null | undefined, options: PosAccessOptions = {}): Promise<PosContext> {
  const session = await getSession();
  return requirePosAccess(businessId, session, options);
}

/**
 * Who is acting? The business owner is always OWNER; a platform admin is ADMIN; anyone else
 * takes the role recorded on their staff record (§36). A browser cannot claim a role.
 */
export function resolveRoleKey(params: {
  businessOwnerId: string;
  session: SessionPayload;
  staff: { roleKey?: string | null; isActive?: boolean | null } | null;
  membershipRole?: string | null;
}): string {
  if (params.session.userId === params.businessOwnerId) return "OWNER";
  if (params.session.role === "ADMIN") return "ADMIN";
  if (params.staff?.isActive !== false && params.staff?.roleKey) return params.staff.roleKey;
  const membership = (params.membershipRole ?? "").toUpperCase();
  if (membership === "OWNER") return "OWNER";
  if (membership === "ADMIN" || membership === "MANAGER") return "MANAGER";
  return membership || "CASHIER";
}

/** Map any thrown error to a safe JSON response body (§56). */
export function posErrorBody(error: unknown, fallback: string): { status: number; body: { error: string; code?: string } } {
  if (error instanceof PosAccessError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  if (error instanceof TenantError) {
    return { status: error.status, body: { error: error.status === 404 ? SAFE_ERRORS.notFound : SAFE_ERRORS.noAccess } };
  }
  const mapped = publicErrorMessage(error, fallback);
  return { status: mapped.status, body: { error: mapped.message } };
}

/** Read the business id from a request body without trusting anything else in it (§56). */
export function businessIdFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>).businessId;
  return typeof value === "string" ? value.trim().slice(0, 60) : "";
}
