"use client";

/**
 * Privacy-preserving analytics beacon (§31, §32, §57)
 *
 * Fires one lightweight POST per interaction. No personal data is collected; the server
 * hashes the IP and derives a session key. Failures are silent — analytics must never
 * interfere with a customer ordering or paying.
 */

import { useEffect, useRef } from "react";

export function trackEvent(businessId: string, eventType: string, subjectId?: string, source?: string) {
  try {
    const payload = JSON.stringify({ businessId, eventType, subjectId, source });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/analytics/event", new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics are best-effort */
  }
}

/** One page-view per mount, de-duplicated across React strict-mode double renders. */
export function PageViewTracker({ businessId, eventType = "PAGE_VIEW", subjectId }: { businessId: string; eventType?: string; subjectId?: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackEvent(businessId, eventType, subjectId, typeof window !== "undefined" ? window.location.pathname : undefined);
  }, [businessId, eventType, subjectId]);
  return null;
}

/** Tracks a click on a contact action (call / WhatsApp / directions / share) (§31). */
export function ContactTracker({
  businessId,
  eventType,
  href,
  className,
  children,
  subjectId,
}: {
  businessId: string;
  eventType: string;
  href: string;
  className?: string;
  children: React.ReactNode;
  subjectId?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => trackEvent(businessId, eventType, subjectId)}
      {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}
