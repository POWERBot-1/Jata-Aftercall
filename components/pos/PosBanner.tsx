"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The one thing the owner needs to know before anything else (§44, §60, §61).
 *
 * It always says what happens next in their own words, and it never mentions configuration,
 * entitlements or lifecycles as technical concepts (§38).
 *
 * The call to action is rendered only when it leads somewhere else. This component sits in the
 * POS shell, so it appears on every POS screen — including the screen its notice points at. On
 * `/plan` the AWAITING_PAYMENT notice targets `/plan` itself, and a Next `<Link>` to the current
 * route suppresses the browser's default navigation and pushes the same URL: the control looked
 * active and did nothing. The plan screen's own "Choose plan and pay" button is the single,
 * working call to action there; everywhere else the link is unchanged.
 */
export function PosBanner({
  notice,
  tone,
  href,
  lifecycleLabel,
  entitlementReason,
  entitled,
}: {
  notice: string | null;
  tone: "info" | "warn" | "danger" | "success";
  href: string | null;
  lifecycleLabel: string;
  entitlementReason: string;
  entitled: boolean;
}) {
  const pathname = usePathname() || "";

  if (!notice && entitled) return null;
  const body = notice ?? entitlementReason;
  if (!body) return null;

  // Trailing slashes differ between a stored href and what the router reports; compare the same.
  const comparable = (value: string) => (value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value);
  const leadsSomewhereElse = Boolean(href) && comparable(href as string) !== comparable(pathname);

  return (
    <div className="pos-banner" data-tone={tone} role="status">
      <div>
        <p className="pos-banner-label">{lifecycleLabel}</p>
        <p className="pos-banner-text">{body}</p>
      </div>
      {leadsSomewhereElse ? (
        <Link href={href as string} className="jata-btn jata-btn-secondary">
          {tone === "danger" ? "Renew" : tone === "warn" ? "Continue" : "Open"}
        </Link>
      ) : null}
    </div>
  );
}
