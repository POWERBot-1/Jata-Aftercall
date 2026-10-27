/**
 * Pure contact-action destination builder shared by BOTH public page renderers
 * (`components/BusinessPage.tsx` and the experience `ActionBar`).
 *
 * Owner directive 2026-10-27 Phase 3: every demo business page must visibly offer WhatsApp,
 * Call, Directions and Share, with real destinations and honest unavailable states.
 *
 * Rules enforced here:
 *  • Kenyan numbers are normalised through the SAME `lib/phone` helper the API validates with;
 *    a number that cannot be normalised never produces a wa.me or tel: destination.
 *  • Directions is derived only from the business's own configured coordinates/address. No
 *    fabricated town, sentinel coordinate or "Nairobi" fallback is ever substituted.
 *  • Share uses the canonical public /b/<slug> URL (not the current URL with tracking/preview
 *    query parameters) and the business's own name.
 *  • No business contact data is sent anywhere except to the destination the customer chose.
 */

import { getWhatsAppUrl, normalizeKePhone } from "./phone";
import { getDirectionsUrl } from "./location";

export type ContactActionSource = {
  slug: string;
  name: string;
  category?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type ContactActionKey = "whatsapp" | "call" | "directions" | "share";

export type ContactActionPlan = {
  whatsappHref: string | null;
  callHref: string | null;
  directionsHref: string | null;
  sharePath: string;
  shareTitle: string;
  shareText: string;
  unavailable: Partial<Record<ContactActionKey, string>>;
};

export const CONTACT_ACTION_LABELS: Record<ContactActionKey, string> = {
  whatsapp: "WhatsApp",
  call: "Call",
  directions: "Directions",
  share: "Share",
};

const WHATSAPP_UNAVAILABLE = "WhatsApp is unavailable — this business has not provided a valid contact number.";
const CALL_UNAVAILABLE = "Call is unavailable — this business has not provided a valid contact number.";
const DIRECTIONS_UNAVAILABLE = "Directions are unavailable — no address or map coordinates are configured.";

export function buildContactActions(business: ContactActionSource): ContactActionPlan {
  const slug = String(business.slug || "").trim();
  const name = String(business.name || "This business").trim();
  const whatsapp = normalizeKePhone(business.whatsapp);
  const phone = normalizeKePhone(business.phone);
  const message = `Hi ${name}, I found your JATA AFTERCALL page and would like to know more.`;

  const whatsappHref = whatsapp ? getWhatsAppUrl(whatsapp, message) : null;
  const callHref = phone ? `tel:+${phone}` : null;
  const directionsHref = getDirectionsUrl(business.location, business.lat, business.lng);

  const unavailable: Partial<Record<ContactActionKey, string>> = {};
  if (!whatsappHref) unavailable.whatsapp = WHATSAPP_UNAVAILABLE;
  if (!callHref) unavailable.call = CALL_UNAVAILABLE;
  if (!directionsHref) unavailable.directions = DIRECTIONS_UNAVAILABLE;

  return {
    whatsappHref,
    callHref,
    directionsHref,
    sharePath: slug ? `/b/${encodeURIComponent(slug)}` : "/",
    shareTitle: name,
    shareText: business.location
      ? `${name} — ${business.category || "business"} in ${business.location}. See their services, prices and contact options on JATA AFTERCALL.`
      : `${name} — see their services, prices and contact options on JATA AFTERCALL.`,
    unavailable,
  };
}

/** Canonical absolute URL for sharing, derived from the page's own origin (never a supplied URL). */
export function shareUrlFor(plan: ContactActionPlan, origin: string): string {
  return new URL(plan.sharePath, origin).toString();
}

export type ShareOutcome = { ok: boolean; message: string };

/**
 * Native share when supported, clipboard copy otherwise, and an honest manual-copy message when
 * neither works. A cancelled native share is not reported as an error. No network call is made.
 */
export async function shareBusinessPage(
  plan: ContactActionPlan,
  env: {
    origin: string;
    share?: (data: ShareData) => Promise<void>;
    clipboard?: { writeText: (text: string) => Promise<void> };
    /** Synchronous fallback using a temporary textarea + document.execCommand("copy"). */
    legacyCopy?: (text: string) => boolean;
  },
): Promise<ShareOutcome> {
  const url = shareUrlFor(plan, env.origin);
  const payload = { title: plan.shareTitle, text: plan.shareText, url };
  if (typeof env.share === "function") {
    try {
      await env.share(payload);
      return { ok: true, message: "Shared. You can also copy the link below if you need it." };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, message: "Share cancelled." };
      }
      // A browser may advertise navigator.share but reject it (desktop, permission, insecure
      // context). Fall through to the clipboard instead of pretending the share succeeded.
    }
  }
  const text = `${plan.shareText} ${url}`;
  if (typeof env.clipboard?.writeText === "function") {
    try {
      await env.clipboard.writeText(text);
      return { ok: true, message: "Link copied. Paste it into WhatsApp, SMS or email to share." };
    } catch {
      // Fall through to the legacy copy path.
    }
  }
  if (typeof env.legacyCopy === "function" && env.legacyCopy(text)) {
    return { ok: true, message: "Link copied. Paste it into WhatsApp, SMS or email to share." };
  }
  return { ok: false, message: `Copy this link to share: ${url}` };
}
