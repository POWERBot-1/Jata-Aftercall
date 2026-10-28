/**
 * Read-only contact resolution for the four FICTIONAL public demo businesses.
 *
 * Owner directive 2026-10-27 Phase 15: production demo rows still contain the original seed
 * placeholders (0700 000 001 … 004). Changing production data needs separate owner approval, so
 * this module resolves the *presentation* contact number from the authoritative demo fixture
 * (`lib/demoData.ts`) only for a verified PUBLIC DEMO ROW (fixed slug + exact fictional name +
 * no real payments). It writes nothing to the database and can never affect a paying customer's
 * business; `isVerifiedDemoRecord` remains the authority for any write operation.
 *
 * The official demo contact `0724317010` is used only where the row is a verified fictional demo
 * whose stored number is missing, invalid, or one of the four known placeholders. A real stored
 * number on a verified demo row is kept exactly as written — a number is never invented for any
 * other business.
 */

import { DEMO_BUSINESSES, DEMO_PAYMENT_PREFIX } from "./demoData";
import { type DemoBusinessIdentity } from "./demoContent";
import { isValidKePhone } from "./phone";

/** The one official JATA demo line. Also the source value in every demo fixture. */
export const OFFICIAL_DEMO_CONTACT = "0724317010";

/** The exact placeholder values the historical seed wrote. Never treat a real number as one. */
const DEMO_PLACEHOLDERS = new Set([
  "0700000001",
  "0700000002",
  "0700000003",
  "0700000004",
  "254700000001",
  "254700000002",
  "254700000003",
  "254700000004",
]);

export function isDemoPlaceholderNumber(value: string | null | undefined): boolean {
  if (!value) return true;
  return DEMO_PLACEHOLDERS.has(String(value).replace(/\D/g, ""));
}

export type PublicDemoRowIdentity = DemoBusinessIdentity & { name?: string | null };

/**
 * A second, narrowly-scoped demo identity check for PUBLIC PRESENTATION ONLY.
 *
 * Production was observed serving all four fictional pages (with the historical 0700 000 00x
 * placeholders) while `isVerifiedDemoRecord` returned false — the seed owner identity no longer
 * matches, so the homepage hid every demo link and the pages were not labelled as fictional.
 * This helper does NOT grant access, modify data or relax a payment check. It is true only when
 * the fixed showcase slug AND the exact fictional business name match, and the row has NO payment
 * outside the seed's `demo-` namespace. A paying customer's row is therefore never reclassified.
 * `isVerifiedDemoRecord` (owner-identity bound) remains the authority for any write operation.
 */
export function isPublicDemoRow(row: PublicDemoRowIdentity): boolean {
  if (!DEMO_BUSINESSES.some((demo) => demo.slug === row.slug && demo.name.toLowerCase() === String(row.name || "").trim().toLowerCase())) {
    return false;
  }
  const references = Array.isArray(row.paymentReferences) ? row.paymentReferences : [];
  if (!references.every((reference) => String(reference).startsWith(DEMO_PAYMENT_PREFIX))) return false;
  return true;
}

export type DemoContactResolution = {
  phone: string | null;
  whatsapp: string | null;
  /** True when the fixture's official demo line replaced a missing/placeholder stored value. */
  usedOfficialDemoContact: boolean;
};

/**
 * Resolve only the two contact fields. `identity` must come from the server's own database read,
 * never from a request parameter. For every non-demo or unverifiable row the stored values are
 * returned unchanged.
 */
export function resolveDemoContacts(
  identity: PublicDemoRowIdentity,
  stored: { phone?: string | null; whatsapp?: string | null },
): DemoContactResolution {
  const phoneValid = Boolean(stored.phone && isValidKePhone(stored.phone) && !isDemoPlaceholderNumber(stored.phone));
  const whatsappValid = Boolean(stored.whatsapp && isValidKePhone(stored.whatsapp) && !isDemoPlaceholderNumber(stored.whatsapp));
  const needsFallback = !phoneValid || !whatsappValid;
  if (!needsFallback || !isPublicDemoRow(identity)) {
    return { phone: stored.phone ?? null, whatsapp: stored.whatsapp ?? null, usedOfficialDemoContact: false };
  }
  const fixture = DEMO_BUSINESSES.find((demo) => demo.slug === identity.slug);
  if (!fixture) {
    return { phone: stored.phone ?? null, whatsapp: stored.whatsapp ?? null, usedOfficialDemoContact: false };
  }
  return {
    phone: phoneValid ? (stored.phone as string) : fixture.phone,
    whatsapp: whatsappValid ? (stored.whatsapp as string) : fixture.whatsapp,
    usedOfficialDemoContact: true,
  };
}
