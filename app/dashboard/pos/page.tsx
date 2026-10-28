/**
 * `<img>` is used deliberately where the image URL is owner-supplied (a business cover or
 * logo) or comes from a fixed local registry with explicit width/height. next/image would
 * require the optimizer to fetch arbitrary remote URLs and would not respect the aspect-ratio
 * container these images fill, so the raw element with `loading="lazy"` is the safer choice.
 */
/* eslint-disable @next/next/no-img-element */
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
import { StatusPill } from "@/components/ui/StatusPill";
import { WorkspaceEmpty, WorkspaceHero, WorkspacePanel } from "@/components/workspace/WorkspaceUI";
import { WorkspaceDoor } from "@/components/workspace/WorkspaceDoor";
import { WORKSPACE_HERO_PHOTO, WORKSPACE_PHOTOS, categoryLabel, photoForCategory } from "@/lib/workspaceImagery";
import { ArrowRight, BarChart3, Boxes, CreditCard, Receipt, Store, Users } from "lucide-react";

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
    select: { id: true, name: true, category: true, location: true, coverUrl: true },
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

  const entitledCount = states.filter((state) => state?.entitled).length;

  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="Business POS"
        title={
          <>
            Your till, <em>configured</em> around how you work.
          </>
        }
        subtitle={`Tell JATA how your business works and it configures the system around you — the words, the screens, the stock, the credit and the reports. ${formatKES(
          POS_PLAN_PRICE_KES,
        )} a month per business, owner-only and separate from your page plan.`}
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <Link href="#pos-businesses" className="ws-btn-amber">
              <Store size={16} aria-hidden="true" /> Choose a business
            </Link>
            <Link href="/dashboard" className="ws-btn-outline">
              Back to overview
            </Link>
          </>
        }
        meta={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"} · ${entitledCount} with an active POS · switched on only after Paystack confirms payment`}
      />

      {businesses.length === 0 ? (
        <WorkspaceEmpty
          title="Add a business first"
          text="The POS is switched on for one business at a time. Create the business, then configure its POS — sales, stock, credit and reports."
          photo={WORKSPACE_PHOTOS.retail}
          actions={
            <Link href="/onboarding" className="jata-btn jata-btn-primary">
              Add a business
            </Link>
          }
        />
      ) : (
        <section id="pos-businesses" aria-labelledby="pos-businesses-title" className="scroll-mt-28">
          <h2 id="pos-businesses-title" className="sr-only">
            Your businesses
          </h2>
          <ul className="ws-stack">
            {businesses.map((business, index) => {
              const state = states[index];
              const lifecycle = (state?.lifecycle ?? "DRAFT") as PosLifecycleStatus;
              const label = POS_LIFECYCLE_LABELS[lifecycle];
              const href = posBasePath(business.id);
              return (
                <WorkspaceDoor
                  key={business.id}
                  coverUrl={business.coverUrl}
                  photo={photoForCategory(business.category)}
                  title={business.name}
                  meta={[categoryLabel(business.category), business.location].filter(Boolean).join(" · ") || "Business"}
                  pills={<StatusPill tone={label.tone}>{label.label}</StatusPill>}
                  note={
                    <p className="ws-muted ws-tiny">
                      {state?.entitled
                        ? "Your POS is switched on. Open it to sell, take stock and see the day's numbers."
                        : label.help}
                    </p>
                  }
                  actions={
                    <>
                      <Link className="jata-btn jata-btn-primary" href={href}>
                        {state?.entitled ? "Open the POS" : "Configure your POS"} <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                      <Link className="jata-btn jata-btn-secondary" href={`${href}/plan`}>
                        <CreditCard size={15} aria-hidden="true" /> POS plan
                      </Link>
                    </>
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      <WorkspacePanel title="What the POS covers" meta="Sales, stock, credit and reports">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={<Receipt size={15} />} title="Sales & receipts" text="Record a sale, print or share a receipt, and see the day's totals." />
          <Feature icon={<Boxes size={15} />} title="Stock" text="Track what you have, what you bought and what moved." />
          <Feature icon={<Users size={15} />} title="Credit" text="Keep customer balances and record repayments as they happen." />
          <Feature icon={<BarChart3 size={15} />} title="Reports" text="Read the numbers already recorded — never an estimate." />
        </div>
        <p className="ws-muted ws-tiny mt-3">
          The POS is a separate product sold per business. It is not part of your page plan, and nothing here switches it on without a
          confirmed payment.
        </p>
      </WorkspacePanel>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[0.8rem] font-bold">
        <span aria-hidden="true" className="text-[color:var(--ws-amber-deep)]">
          {icon}
        </span>
        {title}
      </p>
      <p className="ws-muted ws-tiny mt-0.5">{text}</p>
    </div>
  );
}
