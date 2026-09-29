import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCheckoutUrl } from "@/lib/subscriptionFlow";
import { paymentStatusLabel, subscriptionStatusLabel, toneClass } from "@/lib/statusLabels";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ businessId?: string }> };

export default async function SubscriptionPage({ searchParams }: Props) {
  const { businessId: requestedBusinessId } = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const ownerFilter = session.role === "ADMIN" ? {} : { ownerId: session.userId };
  const paymentFilter = session.role === "ADMIN" ? {} : { userId: session.userId };
  const [businesses, plans, payments] = await Promise.all([
    prisma.business.findMany({ where: ownerFilter, select: { id: true, name: true, subscription: { select: { status: true, planId: true, expiresAt: true, plan: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
    prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } }).catch(() => []),
    prisma.payment.findMany({ where: paymentFilter, orderBy: { createdAt: "desc" }, take: 20, include: { business: { select: { name: true } } } }),
  ]);
  const requestedId = requestedBusinessId || "";
  const selected = businesses.find((business) => business.id === requestedId) ||
    businesses.find((business) => business.subscription?.status !== "ACTIVE") || businesses[0] || null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Subscription</h1>
      <p className="text-sm text-zinc-600">Choose a plan, review it, then pay securely with Paystack (M-Pesa or card). Your plan starts once Paystack confirms the payment.</p>

      {businesses.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-6">
          <p className="text-sm font-semibold">Create your business first</p>
          <p className="mt-1 text-sm text-zinc-600">Save your business details and location. You’ll then be able to choose a plan and pay.</p>
          <Link href="/onboarding" className="jata-btn jata-btn-primary mt-4">Create business</Link>
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-white p-4">
            <h2 className="text-sm font-bold">Which business are you paying for?</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {businesses.map((business) => (
                <Link key={business.id} href={`/dashboard/subscription?businessId=${encodeURIComponent(business.id)}`} aria-current={selected?.id === business.id ? "true" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${selected?.id === business.id ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}>
                  {business.name}
                </Link>
              ))}
              <Link href="/onboarding" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold">+ Add a business</Link>
            </div>
            {selected && <p className="mt-3 text-sm">Selected: <strong>{selected.name}</strong> · {subscriptionStatusLabel(selected.subscription?.status).label}</p>}
          </div>

          {selected && <div className="rounded-2xl border bg-white p-5">
            <h2 className="text-sm font-bold">Choose a plan</h2>
            <p className="mt-1 text-sm text-zinc-600">Prices are in Kenyan shillings (KES). You’ll review the amount before paying.</p>
            {plans.length === 0 ? <p className="mt-4 text-sm text-amber-800">No active plans are available right now. Please try again later.</p> :
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {plans.map((plan) => <Link key={plan.id} href={getCheckoutUrl(selected.id, plan.id)} className="rounded-xl border bg-zinc-50 p-4 hover:bg-white hover:shadow-sm">
                  <p className="text-sm font-semibold">{plan.name}</p>
                  <p className="mt-1 text-sm text-zinc-600">KES {plan.priceKES.toLocaleString()} · {plan.durationDays} days</p>
                  <span className="mt-3 inline-flex min-h-11 items-center rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white">Choose this plan</span>
                </Link>)}
              </div>}
          </div>}
        </>
      )}

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">Subscription status</h2>
        {businesses.filter((business) => business.subscription).length === 0 ? <p className="mt-2 text-sm text-zinc-600">No subscriptions yet.</p> : businesses.filter((business) => business.subscription).map((business) => {
          const label = subscriptionStatusLabel(business.subscription!.status);
          return (
            <div key={business.id} className="mt-3 border-t pt-3 text-sm">
              <p className="font-semibold [overflow-wrap:anywhere]">{business.name} — {business.subscription!.plan.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${toneClass(label.tone)}`}>{label.label}</span>
                <span>{business.subscription!.expiresAt ? `Until ${new Date(business.subscription!.expiresAt).toLocaleDateString("en-KE")}` : "No end date yet"}</span>
              </p>
              {label.help && <p className="mt-1 text-zinc-600">{label.help}</p>}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">Payment history</h2>
        {payments.length === 0 ? <p className="mt-2 text-sm text-zinc-600">No payments yet.</p> : (
          <ul className="mt-3 divide-y">
            {payments.map((payment) => {
              const label = paymentStatusLabel(payment.status);
              return (
                <li key={payment.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold [overflow-wrap:anywhere]">{payment.business?.name || "Business removed"} · KES {(payment.amount / 100).toLocaleString()}</p>
                    <p className="text-zinc-600">{new Date(payment.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}{label.help ? ` · ${label.help}` : ""}</p>
                    <p className="break-all font-mono text-xs text-zinc-600">Ref: {payment.reference}</p>
                  </div>
                  <span className={`justify-self-start rounded-full px-2 py-0.5 font-semibold sm:justify-self-end ${toneClass(label.tone)}`}>{label.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
