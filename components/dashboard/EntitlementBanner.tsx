import Link from "next/link";
import type { EntitlementState } from "@/lib/experience/entitlement";
import { INTERACTIVE_PRICE_KES } from "@/lib/experience/entitlement";
import { formatDate } from "@/lib/format";

/**
 * Subscription state (§45)
 *
 * Expired or past-due never deletes content: the owner is told what happened and what to do,
 * and the public site falls back gracefully rather than vanishing without explanation.
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
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-emerald-900">
            Interactive Business is active{entitlement.expiresAt ? ` until ${formatDate(entitlement.expiresAt)}` : ""}
          </p>
          <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`} className="text-sm font-semibold text-emerald-900 underline">
            Manage plan
          </Link>
        </div>
      </section>
    );
  }

  const tone =
    entitlement.status === "EXPIRED" || entitlement.status === "CANCELLED"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-zinc-200 bg-white text-zinc-800";

  return (
    <section className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-sm font-semibold">{entitlement.reason}</p>
      {isPublished && (entitlement.status === "EXPIRED" || entitlement.status === "CANCELLED") ? (
        <p className="mt-1 text-sm">
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
