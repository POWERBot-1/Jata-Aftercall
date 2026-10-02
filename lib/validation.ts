// Minimal validators — no external zod dependency to keep bundle small and zero-cost

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function sanitizeText(input: string, maxLen = 500): string {
  if (!input) return "";
  // Strip control chars, trim, limit length. React will escape on render; we also strip tags.
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .slice(0, maxLen);
}

export function validatePhone(phone: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

/**
 * Business categories (§5)
 *
 * Sixteen categories, each backed by an Experience Profile in `lib/experience/categories`.
 * The legacy labels are kept as aliases so businesses created before Interactive Business
 * keep working unchanged (§39).
 */
export const CATEGORIES = [
  "Food & Restaurant",
  "Beauty & Cosmetics",
  "Salon & Barber",
  "Fashion & Clothing",
  "Retail & General Shop",
  "Electronics",
  "Automotive",
  "Real Estate",
  "Furniture & Home",
  "Fitness & Wellness",
  "Creative & Photography",
  "Professional Services",
  "Hospitality",
  "Education & Training",
  "Home & Technical Services",
  "Other",
] as const;

/** Legacy JATA labels still accepted on write, mapped to their current name. */
const CATEGORY_ALIASES: Record<string, string> = {
  restaurant: "Food & Restaurant",
  food: "Food & Restaurant",
  hotel: "Hospitality",
  eatery: "Food & Restaurant",
  cafe: "Food & Restaurant",
  café: "Food & Restaurant",
  butchery: "Food & Restaurant",
  bakery: "Food & Restaurant",
  catering: "Food & Restaurant",
  salon: "Salon & Barber",
  barber: "Salon & Barber",
  "barber shop": "Salon & Barber",
  "hair salon": "Salon & Barber",
  spa: "Fitness & Wellness",
  mechanic: "Automotive",
  garage: "Automotive",
  "car wash": "Automotive",
  "real estate": "Real Estate",
  property: "Real Estate",
  "professional services": "Professional Services",
  consultant: "Professional Services",
  retail: "Retail & General Shop",
  shop: "Retail & General Shop",
  "general shop": "Retail & General Shop",
  "home services": "Home & Technical Services",
  beauty: "Beauty & Cosmetics",
  cosmetics: "Beauty & Cosmetics",
  events: "Creative & Photography",
  other: "Other",
};

/** Resolves legacy free-text categories to one of the sixteen (§39). */
export function normalizeCategory(cat: string): string {
  const trimmed = String(cat || "").trim();
  if (!trimmed) return "Other";
  if ((CATEGORIES as readonly string[]).includes(trimmed)) return trimmed;
  const match = (CATEGORIES as readonly string[]).find((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  return CATEGORY_ALIASES[trimmed.toLowerCase()] || "Other";
}

export function isValidCategory(cat: string): boolean {
  return (CATEGORIES as readonly string[]).includes(cat) || Boolean(CATEGORY_ALIASES[String(cat || "").trim().toLowerCase()]);
}
