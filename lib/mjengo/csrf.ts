/**
 * CSRF + origin validation for MJENGO OS mutations.
 * - Same-site host check (origin header must match host header when present)
 * - x-forwarded-proto allowlist http/https only
 * - trusted proxy handled centrally via lib/rate-limit.trustedClientIp (VERCEL=1)
 */
export function verifyMjengoOrigin(req: Request): { ok: boolean; reason?: string } {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true }; // no origin = non-browser or same-origin form (allow, but require session)
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const hostHeader = req.headers.get("host");
  if (forwardedProto && !["http", "https"].includes(forwardedProto)) {
    return { ok: false, reason: "malformed forwarded protocol" };
  }
  if (hostHeader && !/^[a-zA-Z0-9.:[\]-]+$/.test(hostHeader)) {
    return { ok: false, reason: "malformed host" };
  }
  let originHost = "";
  let originProtocol = "";
  try {
    const parsed = new URL(origin);
    originHost = parsed.host.toLowerCase();
    originProtocol = parsed.protocol;
  } catch {
    return { ok: false, reason: "invalid origin" };
  }
  if (!originHost || !["http:", "https:"].includes(originProtocol)) {
    return { ok: false, reason: "invalid origin scheme" };
  }
  const requestHost = (hostHeader || new URL(req.url).host).toLowerCase();
  if (originHost !== requestHost) {
    return { ok: false, reason: `origin-host ${originHost} != request-host ${requestHost}` };
  }
  return { ok: true };
}
