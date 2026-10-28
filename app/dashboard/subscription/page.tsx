import Link from "next/link";
import prisma from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { getSession } from "@/lib/auth";
import { getCheckoutUrl } from "@/lib/subscriptionFlow";
import { planDisplayName, publiclyListedPlans } from "@/lib/pricing";
import { PLAN_BADGES, PLAN_INCLUDES } from "@/lib/landing";
import { paymentStatusLabel, subscriptionStatusLabel } from "@/lib/statusLabels";
import { StatusPill } from "@/components/ui/StatusPill";
import { WorkspaceHero, WorkspacePanel, WorkspaceSectionHead } from "@/components/workspace/WorkspaceUI";
import { ArrowRight, Bot, CalendarDays, Check, CreditCard, Receipt, ShieldCheck, Smartphone, Sparkles, Store, Wand2 } from "lucide-react";
import { PlanCard } from "@/components/workspace/PlanCard";
import { WORKSPACE_HERO_PHOTO } from "@/lib/workspaceImagery";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ businessId?: string }> };

/**
 * Plans & billing.
 *
 * Presentation only: prices, durations and the list of plans come from `PlanConfig` through
 * `publiclyListedPlans()` exactly as before, and every "Choose this plan" button is the same
 * `getCheckoutUrl()` link the rest of the product uses. Nothing here changes what a plan
 * includes, what it costs, or when it starts — Paystack still confirms the payment, and the
 * copy says so on the card and in the footnote.
 */
export default async function SubscriptionPage({ searchParams }: Props) {
  const { businessId: requestedBusinessId } = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const ownerFilter = session.role === "ADMIN" ? {} : { ownerId: session.userId };
  const paymentFilter = session.role === "ADMIN" ? {} : { userId: session.userId };
  const [businesses, plansResult, payments] = await Promise.all([
    prisma.business.findMany({
      where: ownerFilter,
      select: { id: true, name: true, slug: true, category: true, subscription: { select: { status: true, planId: true, expiresAt: true, plan: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.planConfig
      .findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } })
      .then((list) => ({ ok: true as const, list: publiclyListedPlans(list) }))
      .catch(() => ({ ok: false as const, list: [] })),
    prisma.payment.findMany({
      where: paymentFilter,
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { business: { select: { name: true } } },
    }),
  ]);

  const requestedId = requestedBusinessId || "";
  const selected =
    businesses.find((business) => business.id === requestedId) ||
    businesses.find((business) => business.subscription?.status !== "ACTIVE") ||
    businesses[0] ||
    null;

  const selectedSub = selected?.subscription ? subscriptionStatusLabel(selected.subscription.status) : null;
  const paidCount = payments.filter((payment) => payment.status === "PAID").length;

  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="Subscription"
        title={
          <>
            One plan. <em>Clear price.</em> No surprises.
          </>
        }
        subtitle="Prices are in Kenyan shillings and come straight from your plan catalogue. Pay with M-Pesa or card on Paystack — we never store your card details, and your plan starts only once Paystack confirms the payment."
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <Link href="#plans" className="ws-btn-amber">
              <CreditCard size={16} aria-hidden="true" /> Choose a plan
            </Link>
            <Link href="#payments" className="ws-btn-outline">
              <Receipt size={16} aria-hidden="true" /> Payment history
            </Link>
          </>
        }
        meta={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"} · ${paidCount} confirmed ${
          paidCount === 1 ? "payment" : "payments"
        } recorded`}
      />

      {businesses.length === 0 ? (
        <WorkspacePanel title="Create your business first">
          <p className="ws-muted ws-small">
            Save your business details and location, then you can choose a plan and pay. Plans are attached to a business, so we
            need one on your account before checkout.
          </p>
          <Link href="/onboarding" className="jata-btn jata-btn-primary mt-4">
            Create business
          </Link>
        </WorkspacePanel>
      ) : (
        <>
          <WorkspacePanel title="Which business are you paying for?" meta="Plans are per business">
            <div className="flex flex-wrap gap-2">
              {businesses.map((business) => {
                const active = selected?.id === business.id;
                return (
                  <Link
                    key={business.id}
                    href={`/dashboard/subscription?businessId=${encodeURIComponent(business.id)}`}
                    aria-current={active ? "true" : undefined}
                    className={
                      active
                        ? "inline-flex min-h-11 items-center gap-2 rounded-full border border-[color:var(--ws-ink)] bg-[color:var(--ws-ink)] px-4 text-sm font-semibold text-[color:var(--ws-on-ink)]"
                        : "inline-flex min-h-11 items-center gap-2 rounded-full border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-4 text-sm font-semibold hover:border-[color:var(--ws-amber-deep)]"
                    }
                  >
                    <span aria-hidden="true">●</span>
                    {business.name}
                  </Link>
                );
              })}
              <Link
                href="/onboarding"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-[color:var(--ws-line)] px-4 text-sm font-semibold hover:border-[color:var(--ws-amber-deep)]"
              >
                <Sparkles size={15} aria-hidden="true" /> Add a business
              </Link>
            </div>
            {selected ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{selected.name}</span>
                <StatusPill tone={selectedSub?.tone}>{selectedSub?.label || "No subscription"}</StatusPill>
                {selected.subscription?.plan ? <span className="ws-muted">{selected.subscription.plan.name}</span> : null}
                {selected.subscription?.expiresAt ? (
                  <span className="ws-muted">until {formatDate(selected.subscription.expiresAt)}</span>
                ) : null}
              </div>
            ) : null}
            {selectedSub?.help ? <p className="ws-muted ws-tiny mt-2">{selectedSub.help}</p> : null}
          </WorkspacePanel>

          <section id="plans" aria-labelledby="plans-title" className="scroll-mt-28">
            <WorkspaceSectionHead
              id="plans-title"
              title="Choose a plan"
              meta={plansResult.ok ? "Stored prices, shown as charged" : "Plans unavailable"}
            />
            {plansResult.ok === false ? (
              <WorkspacePanel>
                <p className="ws-small">Plans are temporarily unavailable. Please try again later — nothing has changed on your account.</p>
              </WorkspacePanel>
            ) : plansResult.list.length === 0 ? (
              <WorkspacePanel>
                <p className="ws-small">No active plans are available right now. Please try again later.</p>
              </WorkspacePanel>
            ) : (
              <>
                <div className="ws-plans">
                  {plansResult.list.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={{ id: plan.id, key: plan.key, name: planDisplayName(plan), priceKES: plan.priceKES, durationDays: plan.durationDays }}
                      includes={PLAN_INCLUDES[plan.key] ?? []}
                      badge={PLAN_BADGES[plan.key]}
                      blurb={plan.key === "INTERACTIVE_BUSINESS" ? "Build, edit and preview your full business website." : null}
                      href={selected ? getCheckoutUrl(selected.id, plan.id) : undefined}
                      current={selected?.subscription?.planId === plan.id}
                    />
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <MiniNote icon={<Smartphone size={15} />} title="M-Pesa or card" text="Pay on Paystack with the method you already use." />
                  <MiniNote icon={<ShieldCheck size={15} />} title="We store no card details" text="Paystack handles the payment; JATA keeps only the confirmation." />
                  <MiniNote icon={<CreditCard size={15} />} title="Change when you need to" text="Plans renew for the period you choose and can be changed from this screen." />
                </div>
              </>
            )}
          </section>
        </>
      )}

      <WorkspacePanel title="Subscription status" meta="Every business on your account">
        {businesses.filter((business) => business.subscription).length === 0 ? (
          <p className="ws-muted ws-small">No subscriptions yet. Choose a plan above to make your page live to customers.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--ws-line-soft)]">
            {businesses
              .filter((business) => business.subscription)
              .map((business) => {
                const label = subscriptionStatusLabel(business.subscription!.status);
                return (
                  <li key={business.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold [overflow-wrap:anywhere]">
                        {business.name} — {business.subscription!.plan.name}
                      </p>
                      <p className="ws-muted ws-tiny mt-0.5">
                        {business.subscription!.expiresAt ? `Until ${formatDate(business.subscription!.expiresAt)}` : "No end date yet"}
                        {label.help ? ` · ${label.help}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <StatusPill tone={label.tone}>{label.label}</StatusPill>
                      <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(business.id)}`} className="jata-btn jata-btn-secondary jata-btn-sm">
                        Manage
                      </Link>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </WorkspacePanel>

      <section id="payments" aria-labelledby="payments-title" className="scroll-mt-28">
        <WorkspaceSectionHead id="payments-title" title="Payment history" meta={`${payments.length} most recent`} />
        <WorkspacePanel>
          {payments.length === 0 ? (
            <p className="ws-muted ws-small">
              No payments yet. When you pay for a plan, the confirmation, the amount and the reference appear here — and nowhere
              else in the product guesses at them.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--ws-line-soft)]">
              {payments.map((payment) => {
                const label = paymentStatusLabel(payment.status);
                return (
                  <li key={payment.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="font-semibold [overflow-wrap:anywhere]">
                        {payment.business?.name || "Business removed"} · KES {formatNumber(payment.amount / 100)}
                      </p>
                      <p className="ws-muted ws-tiny">
                        {formatDate(payment.createdAt)}
                        {label.help ? ` · ${label.help}` : ""}
                      </p>
                      <p className="ws-muted ws-tiny break-all font-mono">Ref: {payment.reference}</p>
                    </div>
                    <StatusPill tone={label.tone} className="justify-self-start sm:justify-self-end">
                      {label.label}
                    </StatusPill>
                  </li>
                );
              })}
            </ul>
          )}
        </WorkspacePanel>
      </section>

      <WorkspacePanel title="Also in your workspace" meta="Only what your plan includes is switched on">
        <div className="grid gap-2 sm:grid-cols-3">
          <DoorLink href="/dashboard/ai" title="AI Front Desk" text="See the questions customers asked and improve your page." icon={<Bot size={16} />} />
          <DoorLink href="/dashboard/studio" title="Website Studio" text="Edit your interactive website, then publish it." icon={<Wand2 size={16} />} />
          <DoorLink href="/dashboard/pos" title="Business POS" text="A separate, owner-only till sold per business." icon={<Store size={16} />} />
        </div>
      </WorkspacePanel>
    </div>
  );
}

function MiniNote({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-2 rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-3 py-2.5">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--ws-amber-deep)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.78rem] font-bold">{title}</span>
        <span className="ws-muted ws-tiny block">{text}</span>
      </span>
    </div>
  );
}

function DoorLink({ href, title, text, icon }: { href: string; title: string; text: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="ws-action items-start">
      <span aria-hidden="true" className="mt-0.5">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-bold">{title}</span>
        <span className="ws-muted ws-tiny block">{text}</span>
      </span>
    </Link>
  );
}
