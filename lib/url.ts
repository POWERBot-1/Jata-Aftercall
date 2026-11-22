/**
 * Domain abstraction per §26A — generates public business URLs from an explicit
 * owner-configured origin, then the owner-approved canonical production apex.
 *
 * Resolution order:
 *   1. Explicit, non-localhost PUBLIC_BASE_URL (then NEXTAUTH_URL).
 *   2. On Vercel production/preview: https://jataaftercall.co.ke.
 *      VERCEL_PROJECT_PRODUCTION_URL and VERCEL_URL are deployment metadata, not
 *      customer-facing canonical origins; never emit a protected/ephemeral Vercel URL.
 *   3. Local/development: PUBLIC_BASE_URL -> NEXTAUTH_URL -> http://localhost:3000.
 *
 * Localhost values must never override a production URL when running on Vercel.
 */
const LOCAL_FALLBACK_URL = "http://localhost:3000";
const CANONICAL_PRODUCTION_URL = "https://jataaftercall.co.ke";

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

export function getBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const publicBase = env.PUBLIC_BASE_URL?.trim() || "";
  const nextAuth = env.NEXTAUTH_URL?.trim() || "";
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase() || "";
  const vercelProduction = vercelHostToUrl(env.VERCEL_PROJECT_PRODUCTION_URL);
  const vercelDeployment = vercelHostToUrl(env.VERCEL_URL);

  // Vercel system variables are used only to identify a Vercel runtime. Their hostnames
  // are not returned as customer-facing origins because they may be protected aliases.
  const onVercel =
    vercelEnv === "production" ||
    vercelEnv === "preview" ||
    (vercelEnv !== "development" && Boolean(vercelProduction || vercelDeployment));

  if (onVercel) {
    if (publicBase && !isLocalhostUrl(publicBase)) return sanitizeBase(publicBase);
    if (nextAuth && !isLocalhostUrl(nextAuth)) return sanitizeBase(nextAuth);
    return CANONICAL_PRODUCTION_URL;
  }

  return sanitizeBase(publicBase || nextAuth || LOCAL_FALLBACK_URL);
}

export function getBusinessUrl(slug: string): string {
  const base = getBaseUrl();
  return `${base}/b/${slug}`;
}

export function getBusinessPath(slug: string): string {
  return `/b/${slug}`;
}
