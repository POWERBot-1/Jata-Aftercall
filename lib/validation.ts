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

export const CATEGORIES = [
  "Restaurant",
  "Salon",
  "Barber",
  "Mechanic",
  "Real Estate",
  "Professional Services",
  "Retail",
  "Home Services",
  "Beauty",
  "Food",
  "Events",
  "Other",
] as const;

export function isValidCategory(cat: string): boolean {
  return (CATEGORIES as readonly string[]).includes(cat);
}
