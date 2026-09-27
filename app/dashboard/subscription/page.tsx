import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import Link from "next/link";
import { getCheckoutUrl } from "@/lib/subscriptionFlow";
export const dynamic = "force-dynamic";

export default async function SubscriptionPage({ searchParams }: { searchParams: { businessId?: string } }) {
  const session = await getSession();
  if (!session) return null;

  const where = session.role === "ADMIN" ? {} : { userId: session.userId };
  const payments = await prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, take: 20, include: { business: true } });
  const subs = await prisma.subscription.findMany({ where: session.role === "ADMIN" ? {} : { userId: session.userId }, include: { plan: true, business: true } });

  const selectedBusinessId = searchParams.businessId || subs[0]?.businessId || null;
  const selectedSub = searchParams.businessId ? subs.find((s) => s.businessId === searchParams.businessId) : subs[0] || null;
  const plans = await prisma.planConfig.findMany({ where: { isActive: true } }).catch(() => []);

  // For actionable plan cards, we need a businessId context
  const businesses = await prisma.business.findMany({
    where: session.role === "ADMIN" ? {} : { ownerId: session.userId },
    select: { id: true, name: true },
  });

  const effectiveBusinessId = selectedBusinessId || businesses[0]?.id || "";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Subscription</h1>
      <p className="text-sm text-zinc-600">Choose a plan and pay via Paystack. Existing-business unsubscribed customers land here with businessId.</p>

      {selectedBusinessId && (
        <div className="rounded-xl border bg-amber-50 p-3 text-sm">
          Selected business: <span className="font-semibold">{subs.find(s=>s.businessId===selectedBusinessId)?.business.name || selectedBusinessId}</span>
          <Link href="/dashboard" className="ml-3 text-xs underline">Back to dashboard</Link>
        </div>
      )}

      {subs.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-6">
          <p className="text-sm font-semibold">No subscription yet</p>
          <p className="text-sm text-zinc-600">Complete checkout for your business to activate.</p>
          <Link href="/onboarding" className="mt-3 inline-flex rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Create business & pay</Link>
          {effectiveBusinessId && plans.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Quick pay</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {plans.map((p) => (
                  <Link key={p.id} href={getCheckoutUrl(effectiveBusinessId, p.id)} className="rounded-xl border bg-zinc-50 p-4 hover:bg-zinc-100">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-zinc-600">KES {p.priceKES} • {p.durationDays} days</p>
                    <span className="mt-2 inline-flex rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white">Pay KES {p.priceKES}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        subs.map((s) => (
          <div key={s.id} className="rounded-2xl border bg-white p-5">
            <p className="text-sm font-semibold">{s.business.name} — {s.plan.name}</p>
            <p className="text-sm">
              Status: <span className="font-bold">{s.status}</span> • Expires: {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "—"}
            </p>
            {s.status !== "ACTIVE" && (
              <Link href={getCheckoutUrl(s.businessId, s.planId)} className="mt-3 inline-flex rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Renew now</Link>
            )}
            {s.status === "ACTIVE" && s.expiresAt && new Date(s.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 && (
              <p className="mt-2 text-xs font-semibold text-amber-700">Expiring soon — renew to keep your page live.</p>
            )}
          </div>
        ))
      )}

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">Available plans</h2>
        <p className="mt-1 text-xs text-zinc-500">Plan cards are actionable and lead to /checkout?businessId=...&planId=...</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const checkoutHref = effectiveBusinessId ? getCheckoutUrl(effectiveBusinessId, p.id) : `/checkout?planId=${p.id}`;
            return (
              <Link key={p.id} href={checkoutHref} className="group rounded-xl border bg-zinc-50 p-4 hover:bg-white hover:shadow-sm transition">
                <p className="text-sm font-semibold group-hover:underline">{p.name}</p>
                <p className="text-xs text-zinc-600">KES {p.priceKES} • {p.durationDays} days</p>
                <span className="mt-3 inline-flex rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white">Choose — Pay with Paystack</span>
              </Link>
            );
          })}
        </div>
        {effectiveBusinessId ? (
          <p className="mt-3 text-xs text-zinc-500">Checkout will use businessId={effectiveBusinessId}. Server verifies amount via Paystack.</p>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">Select a business first — checkout requires businessId.</p>
        )}
        {selectedSub && (
          <Link href={getCheckoutUrl(selectedSub.businessId, selectedSub.planId)} className="mt-4 inline-flex rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Renew subscription</Link>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">Payment history</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-zinc-500">No payments yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-zinc-500"><th>Reference</th><th>Business</th><th>Amount (KES)</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2 font-mono text-xs">{p.reference}</td>
                    <td>{p.business?.name || "—"}</td>
                    <td>{(p.amount / 100).toLocaleString()}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === "PAID" ? "bg-emerald-50 text-emerald-700" : p.status === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-zinc-100"}`}>{p.status}</span></td>
                    <td className="text-xs text-zinc-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
