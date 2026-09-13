import prisma from "@/lib/db";
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [users, businesses, published, payments, subsActive, subsExpired, analytics] = await Promise.all([
    prisma.user.count(),
    prisma.business.count(),
    prisma.business.count({ where: { isPublished: true } }),
    prisma.payment.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: { in: ["EXPIRED", "SUSPENDED"] } } }),
    prisma.analyticsEvent.groupBy({ by: ["eventType"], _count: { eventType: true } }).catch(() => []),
  ]);

  const totalViews = analytics.find((a) => a.eventType === "PAGE_VIEW")?._count.eventType || 0;
  const waClicks = analytics.find((a) => a.eventType === "WHATSAPP_CLICK")?._count.eventType || 0;
  const callClicks = analytics.find((a) => a.eventType === "CALL_CLICK")?._count.eventType || 0;
  const dirClicks = analytics.find((a) => a.eventType === "DIRECTION_CLICK")?._count.eventType || 0;
  const revenuePaid = await prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Admin overview</h1>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Total customers", users],
          ["Active businesses", businesses],
          ["Published pages", published],
          ["Active subs", subsActive],
          ["Expiring/expired", subsExpired],
          ["Page views", totalViews],
          ["WhatsApp clicks", waClicks],
          ["Call clicks", callClicks],
          ["Direction clicks", dirClicks],
          ["Revenue (KES)", revenuePaid._sum.amount ? (revenuePaid._sum.amount! / 100).toLocaleString() : "0"],
        ].map(([label, val]) => (
          <div key={String(label)} className="rounded-2xl border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{label as string}</p>
            <p className="mt-1 text-2xl font-bold">{String(val)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold">System health</h2>
        <p className="text-xs text-zinc-500">Check <a href="/health" className="underline">/health</a> endpoint. All admin actions are audited.</p>
        <a href="/health" target="_blank" className="mt-2 inline-flex rounded-full border px-4 py-1 text-xs font-semibold">Open /health</a>
      </div>
    </div>
  );
}
