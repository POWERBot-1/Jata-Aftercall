"use client";

/**
 * Persistent customer action bar (§43) — Phase 3 contact action repair.
 *
 * Actions are generated from the category's capabilities and the business's own contact
 * configuration — a restaurant gets Order, a salon gets Book, an agency gets Enquire, and
 * every business keeps Call, WhatsApp and Directions where those exist. Share is now a fourth
 * first-class contact action with a native-share / clipboard / manual-copy fallback.
 *
 * Every contact action carries a recognisable lucide icon AND its text label, a data attribute
 * for regression evidence, and an accessible name. Missing contact or location data never
 * produces a fabricated destination: the control is simply not offered in this bar, and the
 * classic page renderer shows an explicit unavailable state instead.
 */

import { useState } from "react";
import Link from "next/link";
import { MapPin, MessageCircle, Phone, Share2 } from "lucide-react";
import { useCart } from "./CartProvider";
import { trackEvent } from "./Track";
import { getWhatsAppUrl, normalizeKePhone } from "@/lib/phone";
import { getDirectionsUrl } from "@/lib/location";
import { buildContactActions, shareBusinessPage, type ContactActionKey } from "@/lib/contactActions";
import { legacyCopyText } from "@/lib/shareClipboard";

export function ActionBar({
  businessId,
  slug,
  shopHref,
  bookHref,
  whatsapp,
  phone,
  location,
  lat,
  lng,
  primaryLabel,
  primaryHref,
  showCart,
  businessName,
}: {
  businessId: string;
  slug: string;
  shopHref: string;
  bookHref: string;
  whatsapp: string | null;
  phone: string | null;
  location: string | null;
  lat?: number | null;
  lng?: number | null;
  primaryLabel: string;
  primaryHref?: string | null;
  showCart: boolean;
  /** Used for the share title and prefilled WhatsApp greeting; never for a phone number. */
  businessName?: string | null;
}) {
  const cart = useCart();
  const [shareStatus, setShareStatus] = useState("");
  const wa = normalizeKePhone(whatsapp);
  const tel = normalizeKePhone(phone);
  const directions = location ? getDirectionsUrl(location, lat, lng) : null;
  const name = businessName || slug.replace(/-/g, " ");

  const primary = primaryHref || (showCart ? shopHref : null) || (bookHref ? bookHref : shopHref);

  const actions: Array<{ key: string; label: string; href: string; onClick?: () => void; external?: boolean }> = [];

  if (showCart && cart.count > 0) {
    actions.push({ key: "cart", label: `${primaryLabel} · ${cart.count}`, href: "", onClick: () => cart.setOpen(true) });
  } else if (primary) {
    actions.push({ key: "primary", label: primaryLabel, href: primary });
  }
  if (wa) {
    actions.push({
      key: "whatsapp",
      label: "WhatsApp",
      href: getWhatsAppUrl(wa, `Hi ${name}, I found your JATA AFTERCALL page and would like to know more.`) || "",
      external: true,
      onClick: () => trackEvent(businessId, "WHATSAPP_CLICK"),
    });
  }
  if (tel) {
    actions.push({ key: "call", label: "Call", href: `tel:+${tel}`, onClick: () => trackEvent(businessId, "CALL_CLICK") });
  }
  if (directions) {
    actions.push({
      key: "directions",
      label: "Directions",
      href: directions,
      external: true,
      onClick: () => trackEvent(businessId, "DIRECTIONS_CLICK"),
    });
  }

  if (actions.length === 0) return null;

  function contactIcon(key: string) {
    const props = { size: 18, strokeWidth: 2.2, "aria-hidden": true as const, className: "jata-contact-action__icon" };
    if (key === "whatsapp") return <MessageCircle {...props} />;
    if (key === "call") return <Phone {...props} />;
    if (key === "directions") return <MapPin {...props} />;
    return null;
  }

  async function share() {
    trackEvent(businessId, "SHARE_CLICK");
    const plan = buildContactActions({ slug, name, whatsapp, phone, location, lat, lng });
    const outcome = await shareBusinessPage(plan, {
      origin: window.location.origin,
      share: typeof navigator.share === "function" ? (data) => navigator.share(data) : undefined,
      clipboard: navigator.clipboard,
      legacyCopy: legacyCopyText,
    });
    setShareStatus(outcome.message);
  }

  const contactKeys: ContactActionKey[] = ["whatsapp", "call", "directions", "share"];

  return (
    <>
      <div className="eb-actionbar eb-actionbar--contacts" role="complementary" aria-label="Quick actions">
        {actions.map((action) =>
          action.href && !action.onClick ? (
            <a
              key={action.key}
              href={action.href}
              data-contact-action={contactKeys.includes(action.key as ContactActionKey) ? action.key : undefined}
              data-contact-state={contactKeys.includes(action.key as ContactActionKey) ? "available" : undefined}
              className={action.key === "primary" || action.key === "cart" ? "eb-btn jata-contact-action" : "eb-btn eb-btn--outline jata-contact-action"}
              {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={() => {
                if (action.key === "whatsapp") trackEvent(businessId, "WHATSAPP_CLICK");
                if (action.key === "call") trackEvent(businessId, "CALL_CLICK");
                if (action.key === "directions") trackEvent(businessId, "DIRECTIONS_CLICK");
              }}
            >
              {contactIcon(action.key)}
              <span className="jata-contact-action__label">{action.label}</span>
            </a>
          ) : (
            <Link
              key={action.key}
              href={action.href || shopHref}
              data-contact-action={contactKeys.includes(action.key as ContactActionKey) ? action.key : undefined}
              data-contact-state={contactKeys.includes(action.key as ContactActionKey) ? "available" : undefined}
              className={action.key === "primary" ? "eb-btn jata-contact-action" : "eb-btn eb-btn--outline jata-contact-action"}
              onClick={action.onClick}
            >
              {contactIcon(action.key)}
              <span className="jata-contact-action__label">{action.label}</span>
            </Link>
          ),
        )}
        <button
          type="button"
          data-contact-action="share"
          data-contact-state="available"
          aria-label={`Share ${name}`}
          className="eb-btn eb-btn--outline jata-contact-action"
          onClick={() => void share()}
        >
          <Share2 size={18} strokeWidth={2.2} aria-hidden="true" className="jata-contact-action__icon" />
          <span className="jata-contact-action__label">Share</span>
        </button>
        {shareStatus ? (
          <p role="status" aria-live="polite" data-contact-status="bar" className="eb-actionbar__status">
            {shareStatus}
          </p>
        ) : null}
      </div>
      <div className="eb-actionbar-spacer eb-actionbar-spacer--contacts" aria-hidden="true" />
    </>
  );
}
