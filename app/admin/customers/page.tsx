import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
export const dynamic = "force-dynamic";

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdminPage();
  const { q: query } = await searchParams;
  const q = (query || "").trim();
  const where = q
    ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] }
    : {};
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, include: { businesses: false } as any });
  // Fetch business counts per user
  const withCounts = await Promise.all(
    users.map(async (u) => {
      const bizCount = await prisma.business.count({ where: { ownerId: u.id } });
      const payments = await prisma.payment.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 1 });
      const sub = await prisma.subscription.findFirst({ where: { userId: u.id }, include: { plan: true } });
      return { ...u, bizCount, lastPayment: payments[0] || null, sub };
    })
  );

  return (
    <div>
      <h1 className="text-lg font-bold">Customers</h1>
      <form className="mt-3 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search email / name / phone" className="w-full rounded-xl border px-3 py-2 text-sm" />
        <button className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>

      <div className="mt-4 space-y-3">
        {withCounts.map((u) => (
          <div key={u.id} className="rounded-2xl border bg-white p-4">
            <p className="text-sm font-bold">{u.name || "—"} — {u.email}</p>
            <p className="text-xs text-zinc-500">Phone: {u.phone || "—"} • Role: {u.role} • Businesses: {u.bizCount}</p>
            <p className="text-xs">Subscription: {u.sub ? `${u.sub.status} • ${u.sub.plan.name} • exp ${u.sub.expiresAt ? new Date(u.sub.expiresAt).toLocaleDateString() : "—"}` : "None"}</p>
            <p className="text-xs">Last payment: {u.lastPayment ? `${u.lastPayment.reference} • ${u.lastPayment.status} • KES ${u.lastPayment.amount / 100}` : "None"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
