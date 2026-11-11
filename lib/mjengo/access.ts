import { getSession } from "../auth";
import { assertBusinessOwnership, canAccessBusiness } from "../tenant";
import { getMjengoEntitlement, mjengoFeatureEnabled } from "./entitlement";

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
    const status = ent.status === "PENDING" ? 402 : ent.status === "EXPIRED" ? 402 : 403;
    return { ok: false as const, status, error: ent.reason, entitlement: ent };
  }
  return { ok: true as const, session: sess, entitlement: ent };
}
