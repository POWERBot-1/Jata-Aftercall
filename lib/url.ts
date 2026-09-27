/**
 * Domain abstraction per §26A — never hardcode jata.link.
 * Generates canonical business URLs from PUBLIC_BASE_URL.
 * MVP always uses path-based /b/[slug] — compatible with provider-generated HTTPS domain.
 *
 * Resolution order (see getBaseUrl):
 *   1. Explicit, non-localhost PUBLIC_BASE_URL (then NEXTAUTH_URL) — operator configuration always wins.
 *   2. On Vercel: VERCEL_PROJECT_PRODUCTION_URL — the stable production domain. Vercel sets it at build
 *      and runtime (also on preview deployments) precisely for links that must point to production.
 *   3. On Vercel: VERCEL_URL — the ephemeral per-deployment host (e.g. jata-aftercall-<hash>-<team>.vercel.app).
 *      It changes every deploy and sits behind Deployment Protection, so it is only a last resort.
 *   4. Local/development: PUBLIC_BASE_URL -> NEXTAUTH_URL -> http://localhost:3000 (localhost allowed here).
 *
 * Localhost values must never override a production URL when running on Vercel.
 */

const LOCAL_FALLBACK_URL = "http://localhost:3000";

function isLocalhostUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("0.0.0.0");
}

function sanitizeBase(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Vercel system variables carry a bare host without a scheme (docs), but tolerate a pasted
 * "https://host/" too. Returns an https origin, or "" when unset or pointing at localhost
 * (`vercel dev` exposes VERCEL_URL=localhost:3000).
 */
function vercelHostToUrl(raw: string | undefined): string {
  const host = (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host || isLocalhostUrl(host)) return "";
  return `https://${host}`;
}

export function getBaseUrl(): string {
  const publicBase = process.env.PUBLIC_BASE_URL?.trim() || "";
  const nextAuth = process.env.NEXTAUTH_URL?.trim() || "";
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase() || "";
  const vercelProduction = vercelHostToUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const vercelDeployment = vercelHostToUrl(process.env.VERCEL_URL);

  // `vercel dev` reports VERCEL_ENV=development — treat it like any other local run.
  const onVercel = vercelEnv !== "development" && Boolean(vercelProduction || vercelDeployment);

  if (onVercel) {
    // 1. Explicit non-localhost configuration wins; localhost values are ignored on Vercel.
    if (publicBase && !isLocalhostUrl(publicBase)) return sanitizeBase(publicBase);
    if (nextAuth && !isLocalhostUrl(nextAuth)) return sanitizeBase(nextAuth);
    // 2. Stable production domain — never the ephemeral, Deployment-Protected deployment host.
    if (vercelProduction) return vercelProduction;
    // 3. Legacy last resort when the production URL variable is not exposed.
    return vercelDeployment;
  }

  // 4. Local/development: unchanged fallback chain.
  return sanitizeBase(publicBase || nextAuth || LOCAL_FALLBACK_URL);
}

export function getBusinessUrl(slug: string): string {
  const base = getBaseUrl();
  return `${base}/b/${slug}`;
}

export function getBusinessPath(slug: string): string {
  return `/b/${slug}`;
}
