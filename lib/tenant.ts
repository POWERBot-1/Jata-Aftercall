// Tenant isolation enforcement — never trust client-supplied tenant IDs.
// Every business-owned resource belongs to an authenticated tenant and must be verified
// at the data-access boundary before read, update, or delete.
import prisma from "./db";
import { SessionPayload } from "./auth";
import { publicErrorMessage, SAFE_ERRORS } from "./safeError";

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
 * V1: ownership via Business.ownerId or BusinessMember. Keep simple.
 */
export async function getOwnedBusinessIds(session: SessionPayload): Promise<string[]> {
  const owned = await prisma.business.findMany({
    where: { ownerId: session.userId },
    select: { id: true },
  });
  const member = await prisma.businessMember.findMany({
    where: { userId: session.userId },
    select: { businessId: true },
  });
  return [...owned.map((b) => b.id), ...member.map((m) => m.businessId)];
}

/**
 * Throws if business does not belong to session user. Returns business if allowed.
 * Admins bypass ownership check but are still audited.
 */
export async function assertBusinessOwnership(businessId: string, session: SessionPayload) {
  if (!businessId) throw new TenantError("Missing businessId", 400);
  if (session.role === "ADMIN") return; // admin can access but still checked elsewhere
  const ownedIds = await getOwnedBusinessIds(session);
  if (!ownedIds.includes(businessId)) {
    throw new TenantError("Tenant isolation: business does not belong to authenticated user");
  }
}

/**
 * Load a business and verify ownership in one call. Throws TenantError or NOT_FOUND-like.
 */
export async function loadBusinessForTenant(businessId: string, session: SessionPayload) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new TenantError("Business not found", 404);
  await assertBusinessOwnership(businessId, session);
  return business;
}

/**
 * For slug-based reads: public pages are readable by anyone if published,
 * but dashboard reads require ownership check.
 */
export async function assertSlugOwnershipByBusinessId(businessId: string, session: SessionPayload) {
  await assertBusinessOwnership(businessId, session);
}

/**
 * Session-derived authorization for mutations. Never reads a URL owner id.
 */
export async function guardTenantMutation(
  session: SessionPayload | null,
  businessId?: string | null,
  onError?: (error: unknown) => void,
) {
  if (!session) return { ok: false as const, status: 401, error: SAFE_ERRORS.signIn };
  if (!businessId) return { ok: false as const, status: 400, error: SAFE_ERRORS.chooseBusiness };
  try {
    await assertBusinessOwnership(businessId, session);
    return { ok: true as const };
  } catch (error) {
    try { onError?.(error); } catch { /* diagnostics must never affect authorization */ }
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    return { ok: false as const, status: mapped.status, error: mapped.message };
  }
}
