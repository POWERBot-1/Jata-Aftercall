/**
 * Kenyan phone normalization for WhatsApp wa.me links.
 * - 07XXXXXXXX and 01XXXXXXXX (10 digits, leading 0) → 254XXXXXXXXX
 * - 7XXXXXXXX / 1XXXXXXXX (9 digits) → 254XXXXXXXXX
 * - Valid 254XXXXXXXXX (12 digits, 2547 or 2541) remain valid
 * - Handles +254, 2540 prefix, spaces, dashes
 * - Invalid numbers return null and do not generate wa.me URLs
 */

const KE_MOBILE_REGEX = /^254[71]\d{8}$/;

function stripToDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Normalize Kenyan mobile number to 254XXXXXXXXX format.
 * Returns null if invalid.
 */
export function normalizeKePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  let digits = stripToDigits(raw);
  if (!digits) return null;

  // Handle leading 0: 07XXXXXXXX or 01XXXXXXXX (10 digits)
  if (digits.length === 10 && digits.startsWith("0")) {
    const second = digits[1];
    if (second === "7" || second === "1") {
      digits = "254" + digits.slice(1);
    } else {
      return null;
    }
  }
  // Handle 9 digits starting 7 or 1 (without leading 0)
  else if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1"))) {
    digits = "254" + digits;
  }
  // Handle 13 digits starting 2540 + 7/1 (e.g. 2540712345678)
  else if (digits.length === 13 && digits.startsWith("2540")) {
    const after = digits.slice(4); // should be 9 digits starting 7 or 1
    if (after.length === 9 && (after.startsWith("7") || after.startsWith("1"))) {
      digits = "254" + after;
    } else {
      return null;
    }
  }
  // Handle 12 digits starting 254
  else if (digits.length === 12 && digits.startsWith("254")) {
    // keep as is, validation below will check
  }
  // Handle cases like 2547... already covered, but also handle if digits length 12 and starts with 2547/2541
  // Any other length is invalid
  else if (digits.length !== 12) {
    return null;
  }

  // Final validation: must be 254 + 7 or 1 + 8 digits = 12 total
  if (!KE_MOBILE_REGEX.test(digits)) {
    return null;
  }

  return digits;
}

export function isValidKePhone(input: string | null | undefined): boolean {
  return normalizeKePhone(input) !== null;
}

/**
 * Build a wa.me URL with optional prefilled text.
 * Returns null if phone invalid, preventing invalid wa.me URLs.
 */
export function getWhatsAppUrl(phone: string | null | undefined, message?: string): string | null {
  const normalized = normalizeKePhone(phone);
  if (!normalized) return null;
  if (message) {
    return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  }
  return `https://wa.me/${normalized}`;
}

/**
 * Build tel: link, preserving original if possible but preferring normalized E.164.
 * Returns null if phone missing.
 */
export function getTelUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = normalizeKePhone(phone);
  // Use normalized for tel if valid, otherwise fallback to stripped original with +?
  if (normalized) {
    return `tel:+${normalized}`;
  }
  const digits = stripToDigits(phone);
  if (digits.length >= 9 && digits.length <= 15) {
    return `tel:${phone.trim()}`;
  }
  return null;
}
