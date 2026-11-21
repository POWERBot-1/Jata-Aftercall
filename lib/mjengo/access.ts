import { getSession } from "../auth";
import { assertBusinessOwnership, canAccessBusiness } from "../tenant";
import { getMjengoEntitlement, mjengoFeatureEnabled, type MjengoEntitlementState } from "./entitlement";

/**
 * Map an unentitled state to the HTTP status the workspace and APIs return.
 *
 * 402 means "a purchase/renewal is the next step" and is the ONLY status for which the workspace
 * shell offers checkout. Previously only PENDING/EXPIRED mapped to 402, so a business that had
 * never subscribed (status NONE, nextAction "setup"/"pay") or had cancelled received 403 with no
 * purchase path — the public "Get MJENGO OS" CTA led to a dead end. A payment that is already
 * PAID but not yet activated (nextAction "none") must never be offered a second checkout.
 */
export function mjengoDenialStatus(ent: Pick<MjengoEntitlementState, "status" | "nextAction">): 402 | 403 {
  if (ent.status === "SUSPENDED") return 403;
  return ent.nextAction === "pay" || ent.nextAction === "renew" || ent.nextAction === "setup" ? 402 : 403;
}

/**
 * Entitlement-only gate for MJENGO APIs that have already enforced authentication and tenant
 * ownership. Ownership alone is not entitlement: an owner without a live MJENGO OS subscription
 * must not reach MJENGO capabilities (for example ledger posting) through a direct API call.
 */
export type MjengoEntitlementDenied = { ok: false; status: 402 | 403 | 404; error: string };
export type MjengoEntitlementGranted = { ok: true; entitlement: MjengoEntitlementState };

/** Explicit guard: the project compiles with `strict: false`, where `ok` literals do not narrow. */
export function isMjengoDenied(result: MjengoEntitlementGranted | MjengoEntitlementDenied): result is MjengoEntitlementDenied {
  return result.ok === false;
}

export async function assertMjengoEntitled(businessId: string): Promise<MjengoEntitlementGranted | MjengoEntitlementDenied> {
  if (!mjengoFeatureEnabled()) return { ok: false, status: 404, error: "MJENGO OS is not enabled in this deployment." };
  const ent = await getMjengoEntitlement(businessId);
  if (!ent.entitled) return { ok: false, status: mjengoDenialStatus(ent), error: ent.reason };
  return { ok: true, entitlement: ent };
}

export async function requireMjengoAccess(businessId: string, session?: any) {
  if (!businessId) return { ok: false as const, status: 400, error: "Missing business context." };
  if (!mjengoFeatureEnabled()) return { ok: false as const, status: 404, error: "MJENGO OS is not enabled in this deployment." };
  const sess = session ?? (await getSession());
  if (!sess) return { ok: false as const, status: 401, error: "Sign in to continue." };
  const canAccess = await canAccessBusiness(sess.userId, businessId, sess.role);
  if (!canAccess) return { ok: false as const, status: 403, error: "You do not have access to this business." };
  try {
    await assertBusinessOwnership(businessId, sess);
  } catch (e: any) {
    return { ok: false as const, status: e.status ?? 403, error: e.message };
  }
  const ent = await getMjengoEntitlement(businessId);
  if (!ent.entitled) {
    return { ok: false as const, status: mjengoDenialStatus(ent), error: ent.reason, entitlement: ent };
  }
  return { ok: true as const, session: sess, entitlement: ent };
}
