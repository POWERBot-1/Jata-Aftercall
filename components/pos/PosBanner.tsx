import Link from "next/link";

/**
 * The one thing the owner needs to know before anything else (§44, §60, §61).
 *
 * It always says what happens next in their own words, and it never mentions configuration,
 * entitlements or lifecycles as technical concepts (§38).
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
  if (!notice && entitled) return null;
  const body = notice ?? entitlementReason;
  if (!body) return null;
  return (
    <div className="pos-banner" data-tone={tone} role="status">
      <div>
        <p className="pos-banner-label">{lifecycleLabel}</p>
        <p className="pos-banner-text">{body}</p>
      </div>
      {href ? (
        <Link href={href} className="jata-btn jata-btn-secondary">
          {tone === "danger" ? "Renew" : tone === "warn" ? "Continue" : "Open"}
        </Link>
      ) : null}
    </div>
  );
}
