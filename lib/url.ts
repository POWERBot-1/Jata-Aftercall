/**
 * Domain abstraction per §26A — never hardcode jata.link.
 * Generates canonical business URLs from PUBLIC_BASE_URL.
 * MVP always uses path-based /b/[slug] — compatible with provider-generated HTTPS domain.
 */

export function getBaseUrl(): string {
  const base =
    process.env.PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return base.replace(/\/$/, "");
}

export function getBusinessUrl(slug: string): string {
  const base = getBaseUrl();
  return `${base}/b/${slug}`;
}

export function getBusinessPath(slug: string): string {
  return `/b/${slug}`;
}
