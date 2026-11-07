/**
 * Request guards shared by the Business Hub API routes.
 *
 * Two gates, applied in this order on every route:
 *   1. `authorizeOwner` — the authenticated session must hold the business (or be a platform
 *      ADMIN) and hold a role allowed to perform the action. This is the ONLY place an owner
 *      route decides who it is talking to; every handler below it trusts `actor.businessId`.
 *   2. `requireDatabase` — a durable write is refused when the fallback (in-memory) Prisma client
 *      is running. An offline build must acknowledge failure, never claim a saved request.
 */

import { getSession } from "../auth";
import { guardTenantMutation, type RolePermissionLevel } from "../tenant";

export type OwnerActor = {
  businessId: string;
  userId: string;
  label: string;
  email: string;
};

/**
 * Result of the single authorisation gate every owner route passes through.
 *
 * The absent branch's fields are `never` rather than omitted so both branches stay readable
 * without narrowing — `tsconfig.json` sets `strict: false`, and with `strictNullChecks` disabled
 * TypeScript does not narrow a union on a boolean discriminant.
 */
export type OwnerGuardResult =
  | { ok: true; actor: OwnerActor; status?: never; error?: never }
  | { ok: false; status: number; error: string; actor?: never };

export async function authorizeOwner(
  businessId: string | null | undefined,
  action: RolePermissionLevel = "read",
): Promise<OwnerGuardResult> {
  if (!businessId) return { ok: false, status: 400, error: "Choose a business first." };
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "Sign in to manage your customer hub." };
  const guard = await guardTenantMutation(session, businessId, action);
  if (!guard.ok) return { ok: false, status: guard.status, error: guard.error };
  return {
    ok: true,
    actor: {
      businessId,
      userId: session.userId,
      label: session.name || session.email || "Business user",
      email: session.email,
    },
  };
}

/** True when the request reached a durable database. Writes are refused otherwise. */
export function hasDurableDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export const OFFLINE_WRITE_ERROR = "This feature is temporarily unavailable. Your details were not saved — please try again in a moment.";

/**
 * Same-website check for public submissions. A foreign site must not be able to post order
 * requests into a business's hub by hot-linking the endpoint.
 */
export function isSameSiteRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // native fetch / server-to-server: no Origin header is sent
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const hostHeader = req.headers.get("host");
  if ((forwardedProto && !["http", "https"].includes(forwardedProto)) || (hostHeader && !/^[a-zA-Z0-9.:[\]-]+$/.test(hostHeader))) {
    return false;
  }
  let originHost = "";
  let originProtocol = "";
  try {
    const parsed = new URL(origin);
    originHost = parsed.host.toLowerCase();
    originProtocol = parsed.protocol;
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(originProtocol)) return false;
  const requestHost = (hostHeader || new URL(req.url).host).toLowerCase();
  return originHost === requestHost;
}

/** Reads a JSON body with a hard size cap; returns null for anything malformed or oversized. */
export async function readJsonBody(req: Request, maxBytes = 16_384): Promise<Record<string, unknown> | null> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return null;
  if (Number(req.headers.get("content-length") || 0) > maxBytes) return null;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
