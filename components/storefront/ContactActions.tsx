"use client";

/**
 * The four visible customer contact actions (owner directive 2026-10-27 Phase 3).
 *
 * Rendered by BOTH public page engines: the classic AFTERCALL page and the experience
 * storefront's ActionBar. Every action has a recognisable lucide icon of at least 20 px, a text
 * label, an accessible name, a >=44 px touch target and a visible focus ring. All four are always
 * present; when the business has no valid number or location the control is rendered as an
 * honest, focusable "unavailable" button (never a dead link and never a fabricated destination).
 */

import { useState } from "react";
import { MapPin, MessageCircle, Phone, Share2 } from "lucide-react";
import {
  buildContactActions,
  CONTACT_ACTION_LABELS,
  shareBusinessPage,
  type ContactActionKey,
  type ContactActionSource,
} from "@/lib/contactActions";
import { legacyCopyText } from "@/lib/shareClipboard";

export type ContactActionSkin = {
  whatsapp?: string;
  call?: string;
  neutral?: string;
  muted?: string;
};

export type ContactActionsProps = {
  business: ContactActionSource;
  businessId?: string | null;
  variant?: "primary" | "bar" | "sticky";
  /** Optional class strings from the owning surface's design system (never a colour rewrite). */
  skin?: ContactActionSkin;
  /** Distinguishes the above-the-fold group from the sticky duplicate in browser evidence. */
  group?: string;
  /** Optional owning-surface analytics hook. When supplied, the share event is emitted here
   *  instead of through the component's own fetch (the classic BusinessPage uses this). */
  onShare?: () => void;
};

function track(businessId: string | null | undefined, eventType: string) {
  if (!businessId) return;
  try {
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, eventType, source: window.location.href }),
    }).catch(() => {});
  } catch {
    // Analytics must never break a customer contact action.
  }
}

export function ContactActions({ business, businessId, variant = "primary", skin = {}, group = "primary", onShare }: ContactActionsProps) {
  const [status, setStatus] = useState("");
  const plan = buildContactActions(business);
  const unavailable = plan.unavailable;

  const neutral = skin.neutral || "jata-contact-action--neutral";
  const className = (key: ContactActionKey) => {
    const base = "jata-contact-action";
    if (key === "whatsapp" && !unavailable.whatsapp) return `${base} ${skin.whatsapp || "jata-contact-action--whatsapp"}`;
    if (key === "call" && !unavailable.call) return `${base} ${skin.call || "jata-contact-action--call"}`;
    return `${base} ${neutral}`;
  };

  function icon(key: ContactActionKey) {
    const common = { size: 20, strokeWidth: 2.2, "aria-hidden": true as const, className: "jata-contact-action__icon" };
    switch (key) {
      case "whatsapp": return <MessageCircle {...common} />;
      case "call": return <Phone {...common} />;
      case "directions": return <MapPin {...common} />;
      case "share": return <Share2 {...common} />;
    }
  }

  function disabled(key: ContactActionKey, reason?: string) {
    if (!reason) return null;
    return (
      <button
        type="button"
        data-contact-action={key}
        data-contact-state="unavailable"
        aria-disabled="true"
        aria-label={`${CONTACT_ACTION_LABELS[key]} — unavailable`}
        className={className(key)}
        onClick={() => setStatus(reason)}
      >
        {icon(key)}
        <span className="jata-contact-action__label">{CONTACT_ACTION_LABELS[key]}</span>
      </button>
    );
  }

  async function share() {
    if (onShare) onShare(); else track(businessId, "SHARE_CLICK");
    const outcome = await shareBusinessPage(plan, {
      origin: window.location.origin,
      share: typeof navigator.share === "function" ? (data) => navigator.share(data) : undefined,
      clipboard: navigator.clipboard,
      legacyCopy: legacyCopyText,
    });
    setStatus(outcome.message);
  }

  return (
    <div className={`jata-contact-actions jata-contact-actions--${variant}`} data-contact-group={group} role="group" aria-label={`Contact ${plan.shareTitle}`}>
      {unavailable.whatsapp ? (
        disabled("whatsapp", unavailable.whatsapp)
      ) : (
        <a
          href={plan.whatsappHref!}
          target="_blank"
          rel="noopener noreferrer"
          data-contact-action="whatsapp"
          data-contact-state="available"
          aria-label={`WhatsApp ${plan.shareTitle}`}
          className={className("whatsapp")}
          onClick={() => track(businessId, "WHATSAPP_CLICK")}
        >
          {icon("whatsapp")}
          <span className="jata-contact-action__label">WhatsApp</span>
        </a>
      )}

      {unavailable.call ? (
        disabled("call", unavailable.call)
      ) : (
        <a
          href={plan.callHref!}
          data-contact-action="call"
          data-contact-state="available"
          aria-label={`Call ${plan.shareTitle}`}
          className={className("call")}
          onClick={() => track(businessId, "CALL_CLICK")}
        >
          {icon("call")}
          <span className="jata-contact-action__label">Call</span>
        </a>
      )}

      {unavailable.directions ? (
        disabled("directions", unavailable.directions)
      ) : (
        <a
          href={plan.directionsHref!}
          target="_blank"
          rel="noopener noreferrer"
          data-contact-action="directions"
          data-contact-state="available"
          aria-label={`Directions to ${plan.shareTitle}`}
          className={className("directions")}
          onClick={() => track(businessId, "DIRECTIONS_CLICK")}
        >
          {icon("directions")}
          <span className="jata-contact-action__label">Directions</span>
        </a>
      )}

      <button
        type="button"
        data-contact-action="share"
        data-contact-state="available"
        aria-label={`Share ${plan.shareTitle}`}
        className={className("share")}
        onClick={() => void share()}
      >
        {icon("share")}
        <span className="jata-contact-action__label">Share</span>
      </button>

      <p
        role="status"
        aria-live="polite"
        data-contact-status={group}
        className={`jata-contact-actions__status ${skin.muted || ""} ${status ? "jata-contact-actions__status--active" : ""}`}
      >
        {status}
      </p>
    </div>
  );
}

export default ContactActions;
