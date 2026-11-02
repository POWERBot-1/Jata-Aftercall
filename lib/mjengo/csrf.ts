/**
 * CSRF + origin validation for MJENGO OS mutations.
 *
 * The rule: a state-changing MJENGO request is accepted only when the browser tells us it came
 * from this host. Three signals, all attacker-controlled only if they can run script on our origin
 * (at which point CSRF is not the problem):
 *
 *   Origin            must match (or be absent) — see below.
 *   Sec-Fetch-Site    `cross-site` / `same-site` are refused outright when present. This catches
 *                     the case where a request arrives with no Origin header but the browser still
 *                     labelled it cross-site.
 *   X-Forwarded-Proto only http/https, because proxies append it and a bogus value means the
 *                     deployment's trusted-proxy assumption is wrong.
 *
 * A missing `Origin` is allowed: same-origin form posts and non-browser clients (a curl smoke
 * test, a server-side job) omit it, and a non-browser client carries no ambient session cookie to
 * abuse. The *authentication* requirement is not relaxed by this: every route still calls
 * getSession() and the tenant check. A bearer token, a spoofed X-Forwarded-For or a forged
 * X-Forwarded-Host never satisfies this check — they are not consulted.
 */
export type OriginCheck = { ok: boolean; reason?: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifyMjengoOrigin(req: Request): OriginCheck {
  // Reads are not CSRF-able in a way this check can help; callers must still authenticate them.
  if (SAFE_METHODS.has(String(req.method ?? "GET").toUpperCase())) return { ok: true };

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, reason: `cross-origin request (sec-fetch-site: ${fetchSite})` };
  }

  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto && !["http", "https"].includes(forwardedProto.split(",")[0].trim().toLowerCase())) {
    return { ok: false, reason: "malformed forwarded protocol" };
  }

  const hostHeader = req.headers.get("host");
  if (hostHeader && !/^[a-zA-Z0-9.:[\]-]+$/.test(hostHeader)) {
    return { ok: false, reason: "malformed host" };
  }

  const origin = req.headers.get("origin");
  if (!origin) return { ok: true };

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

  let requestHost = "";
  try {
    requestHost = (hostHeader || new URL(req.url).host).toLowerCase();
  } catch {
    return { ok: false, reason: "invalid request host" };
  }
  if (originHost !== requestHost) {
    return { ok: false, reason: `origin-host ${originHost} != request-host ${requestHost}` };
  }
  return { ok: true };
}
