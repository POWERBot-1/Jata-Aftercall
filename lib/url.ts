/**
 * Domain abstraction per §26A — never hardcode jata.link.
 * Generates canonical business URLs from PUBLIC_BASE_URL.
 * MVP always uses path-based /b/[slug] — compatible with provider-generated HTTPS domain.
 *
 * Fix: localhost PUBLIC_BASE_URL/NEXTAUTH_URL must not override VERCEL_URL when VERCEL_URL is present.
 */

function isLocalhostUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("0.0.0.0");
}

function sanitizeBase(url: string): string {
  return url.replace(/\/$/, "");
}

export function getBaseUrl(): string {
  const publicBase = process.env.PUBLIC_BASE_URL?.trim() || "";
  const nextAuth = process.env.NEXTAUTH_URL?.trim() || "";
  const vercelRaw = process.env.VERCEL_URL?.trim() || "";
  const vercel = vercelRaw ? `https://${vercelRaw.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";

  // When VERCEL_URL is present, prefer it unless PUBLIC_BASE_URL is a non-localhost production URL
  if (vercel) {
    if (publicBase && !isLocalhostUrl(publicBase)) {
      return sanitizeBase(publicBase);
    }
    if (nextAuth && !isLocalhostUrl(nextAuth)) {
      return sanitizeBase(nextAuth);
    }
    return sanitizeBase(vercel);
  }

  // No VERCEL_URL: fallback chain PUBLIC_BASE_URL -> NEXTAUTH_URL -> localhost
  const base = publicBase || nextAuth || "http://localhost:3000";
  return sanitizeBase(base);
}

export function getBusinessUrl(slug: string): string {
  const base = getBaseUrl();
  return `${base}/b/${slug}`;
}

export function getBusinessPath(slug: string): string {
  return `/b/${slug}`;
}
