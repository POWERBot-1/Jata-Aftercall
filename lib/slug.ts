const RESERVED = new Set([
  "admin",
  "api",
  "b",
  "dashboard",
  "login",
  "register",
  "onboarding",
  "checkout",
  "health",
  "auth",
  "business",
  "analytics",
  "paystack",
  "_next",
  "static",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function validateSlug(slug: string): { valid: boolean; reason?: string } {
  if (!slug) return { valid: false, reason: "Slug is required" };
  if (slug.length < 3) return { valid: false, reason: "Slug must be at least 3 characters" };
  if (slug.length > 50) return { valid: false, reason: "Slug must be at most 50 characters" };
  if (!/^[a-z0-9-]+$/.test(slug)) return { valid: false, reason: "Slug must be URL-safe: lowercase letters, numbers, hyphens" };
  if (RESERVED.has(slug)) return { valid: false, reason: "Slug is reserved" };
  if (slug.startsWith("-") || slug.endsWith("-")) return { valid: false, reason: "Slug cannot start or end with hyphen" };
  if (slug.includes("--")) return { valid: false, reason: "Slug cannot contain consecutive hyphens" };
  return { valid: true };
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}
