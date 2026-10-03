import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOwnedBusinessIds } from "@/lib/tenant";
import { posBasePath } from "@/lib/pos/workspace";
import { formatKES } from "@/lib/format";
import { POS_LIFECYCLE_LABELS, getPosEntitlement } from "@/lib/pos/entitlement";
import { POS_PLAN_PRICE_KES } from "@/lib/pos/entitlement";
import type { PosLifecycleStatus } from "@/lib/pos/types";

/**
 * Which business is this POS for? (§4)
 *
 * The POS belongs to a business, not to a browser session (§45), so the journey starts by
 * choosing one. Businesses are listed from authenticated membership only — an id in a URL can
 * never reveal a business this person does not belong to (§5, §75).
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Business POS" };

export default async function PosIndexPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const ownedIds = await getOwnedBusinessIds(session);
  const businesses = await prisma.business.findMany({
    where: { id: { in: ownedIds } },
    select: { id: true, name: true, category: true, location: true },
    orderBy: { name: "asc" },
  });

  const states = await Promise.all(
    businesses.map(async (business) => {
      try {
        return await getPosEntitlement(business.id);
      } catch {
        return null;
      }
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="jata-kicker">JATA AFTERCALL — Business POS</p>
        <h1 className="text-2xl font-bold">Your POS, configured for your business</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Tell JATA how your business works and it configures the system around you — the words, the
          screens, the stock, the credit and the reports. {formatKES(POS_PLAN_PRICE_KES)} a month per business.
        </p>
      </div>

      {businesses.length === 0 ? (
        <div className="jata-card p-6">
          <p className="text-sm font-semibold">Add a business first</p>
          <p className="mt-1 text-sm text-zinc-600">
            The POS is switched on for one business at a time. Create the business, then configure its POS.
          </p>
          <Link href="/onboarding" className="jata-btn jata-btn-primary mt-4">Add a business</Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {businesses.map((business, index) => {
            const state = states[index];
            const lifecycle = (state?.lifecycle ?? "DRAFT") as PosLifecycleStatus;
            const label = POS_LIFECYCLE_LABELS[lifecycle];
            const href = posBasePath(business.id);
            return (
              <li key={business.id}>
                <Link href={href} className="jata-card block p-4 transition hover:border-zinc-400">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{business.name}</p>
                      <p className="text-xs text-zinc-500">
                        {[business.category, business.location].filter(Boolean).join(" · ") || "Business"}
                      </p>
                    </div>
                    <span className="jata-status text-xs" data-tone={label.tone}>{label.label}</span>
                  </div>
                  <p className="mt-3 text-sm text-zinc-700">
                    {state?.entitled ? "Open the POS" : label.help}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-zinc-900">
                    {state?.entitled ? "Go to dashboard →" : "Configure your POS →"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
