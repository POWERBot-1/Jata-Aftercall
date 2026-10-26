import Link from "next/link";
import type { EntitlementState } from "@/lib/experience/entitlement";
import { INTERACTIVE_PRICE_KES } from "@/lib/experience/entitlement";
import { formatDate } from "@/lib/format";
import { WEBSITE_STUDIO_NAME } from "@/lib/productNames";

/**
 * Subscription state (§45)
 *
 * Expired or past-due never deletes content: the owner is told what happened and what to do,
 * and the public site falls back gracefully rather than vanishing without explanation.
 *
 * Colours come from the workspace tokens (`--ws-*`) so the banner reads correctly in both the
 * light and the graphite themes — a raw emerald/amber Tailwind palette would not re-point.
 */
export function EntitlementBanner({
  businessId,
  entitlement,
  isPublished,
}: {
  businessId: string;
  entitlement: EntitlementState;
  isPublished: boolean;
}) {
  if (entitlement.status === "ACTIVE") {
    return (
      <section className="rounded-2xl border border-[color:var(--ws-jade)] bg-[color:var(--ws-jade-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[color:var(--ws-jade)]">
            {WEBSITE_STUDIO_NAME} is active{entitlement.expiresAt ? ` until ${formatDate(entitlement.expiresAt)}` : ""}
          </p>
          <Link
            href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`}
            className="text-sm font-semibold text-[color:var(--ws-jade)] underline"
          >
            Manage plan
          </Link>
        </div>
      </section>
    );
  }

  const isProblem = entitlement.status === "EXPIRED" || entitlement.status === "CANCELLED";
  const tone = isProblem
    ? "border-[color:var(--ws-amber-deep)] bg-[color:var(--ws-amber-soft)] text-[color:var(--ws-text)]"
    : "border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] text-[color:var(--ws-text)]";

  return (
    <section className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-sm font-semibold">{entitlement.reason}</p>
      {isPublished && isProblem ? (
        <p className="mt-1 text-sm text-[color:var(--ws-muted)]">
          Your content is untouched. While the plan is inactive, visitors see your contact details without the premium
          experience. Renewing restores it exactly as it was.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`} className="jata-btn jata-btn-primary">
          {entitlement.status === "PENDING" ? "Finish payment" : `Activate · KES ${INTERACTIVE_PRICE_KES}/month`}
        </Link>
      </div>
    </section>
  );
}
