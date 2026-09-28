import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCheckoutUrl } from "@/lib/subscriptionFlow";
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
      <p className="text-sm text-zinc-600">Choose an active plan, review it at checkout, then pay securely with Paystack. Payment status is confirmed on our server.</p>

      {businesses.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-6">
          <p className="text-sm font-semibold">Create your business first</p>
          <p className="mt-1 text-sm text-zinc-600">Save your business details and location. You’ll then be able to choose a plan and pay.</p>
          <Link href="/onboarding" className="mt-4 inline-flex rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Create business</Link>
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Business for this checkout</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {businesses.map((business) => (
                <Link key={business.id} href={`/dashboard/subscription?businessId=${encodeURIComponent(business.id)}`} aria-current={selected?.id === business.id ? "true" : undefined}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${selected?.id === business.id ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}>
                  {business.name}
                </Link>
              ))}
              <Link href="/onboarding" className="rounded-full border px-4 py-2 text-sm font-semibold">+ Create business</Link>
            </div>
            {selected && <p className="mt-3 text-sm">Selected: <strong>{selected.name}</strong>{selected.subscription ? ` · ${selected.subscription.status}` : " · No subscription"}</p>}
          </div>

          {selected && <div className="rounded-2xl border bg-white p-5">
            <h2 className="text-sm font-bold">Choose a plan</h2>
            <p className="mt-1 text-xs text-zinc-500">Price and duration are confirmed from the server when checkout starts.</p>
            {plans.length === 0 ? <p className="mt-4 text-sm text-amber-800">No active plans are available right now. Please try again later.</p> :
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {plans.map((plan) => <Link key={plan.id} href={getCheckoutUrl(selected.id, plan.id)} className="rounded-xl border bg-zinc-50 p-4 hover:bg-white hover:shadow-sm">
                  <p className="text-sm font-semibold">{plan.name}</p>
                  <p className="mt-1 text-xs text-zinc-600">KES {plan.priceKES.toLocaleString()} · {plan.durationDays} days</p>
                  <span className="mt-3 inline-flex rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white">Choose — pay with Paystack</span>
                </Link>)}
              </div>}
          </div>}
        </>
      )}

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">Subscription status</h2>
        {businesses.filter((business) => business.subscription).length === 0 ? <p className="mt-2 text-sm text-zinc-500">No subscriptions yet.</p> : businesses.filter((business) => business.subscription).map((business) => (
          <div key={business.id} className="mt-3 border-t pt-3 text-sm">
            <p className="font-semibold">{business.name} — {business.subscription!.plan.name}</p>
            <p>Status: <strong>{business.subscription!.status}</strong> · Expires: {business.subscription!.expiresAt ? new Date(business.subscription!.expiresAt).toLocaleDateString() : "—"}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">Payment history</h2>
        {payments.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No payments yet.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-zinc-500"><th>Reference</th><th>Business</th><th>Amount (KES)</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>{payments.map((payment) => <tr key={payment.id} className="border-t"><td className="py-2 font-mono text-xs">{payment.reference}</td><td>{payment.business?.name || "—"}</td><td>{(payment.amount / 100).toLocaleString()}</td><td>{payment.status}</td><td className="text-xs text-zinc-500">{new Date(payment.createdAt).toLocaleDateString()}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </div>
  );
}
