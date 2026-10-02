"use client";

/**
 * Persistent customer action bar (§43)
 *
 * Actions are generated from the category's capabilities and the business's own contact
 * configuration — a restaurant gets Order, a salon gets Book, an agency gets Enquire, and
 * every business keeps Call, WhatsApp and Directions where those exist.
 */

import Link from "next/link";
import { useCart } from "./CartProvider";
import { trackEvent } from "./Track";
import { getWhatsAppUrl, normalizeKePhone } from "@/lib/phone";
import { getDirectionsUrl } from "@/lib/location";

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
}) {
  const cart = useCart();
  const wa = normalizeKePhone(whatsapp);
  const tel = normalizeKePhone(phone);
  const directions = location ? getDirectionsUrl(location, lat, lng) : null;

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
      href: getWhatsAppUrl(wa, `Hi ${slug.replace(/-/g, " ")}, I found your page and I would like to know more.`),
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

  return (
    <>
      <div className="eb-actionbar" role="complementary" aria-label="Quick actions">
        {actions.slice(0, 4).map((action) =>
          action.href && !action.onClick ? (
            <a
              key={action.key}
              href={action.href}
              className={action.key === "primary" || action.key === "cart" ? "eb-btn" : "eb-btn eb-btn--outline"}
              {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={() => {
                if (action.key === "whatsapp") trackEvent(businessId, "WHATSAPP_CLICK");
                if (action.key === "call") trackEvent(businessId, "CALL_CLICK");
                if (action.key === "directions") trackEvent(businessId, "DIRECTIONS_CLICK");
              }}
            >
              {action.label}
            </a>
          ) : (
            <Link
              key={action.key}
              href={action.href || shopHref}
              className={action.key === "primary" ? "eb-btn" : "eb-btn eb-btn--outline"}
              onClick={action.onClick}
            >
              {action.label}
            </Link>
          ),
        )}
      </div>
      <div className="eb-actionbar-spacer" aria-hidden="true" />
    </>
  );
}
