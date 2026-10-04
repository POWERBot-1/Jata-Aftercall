import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
export const dynamic = "force-dynamic";

export default async function AdminSubscriptions() {
  await requireAdminPage();
  const subs = await prisma.subscription.findMany({ orderBy: { expiresAt: "asc" }, include: { business: true, plan: true, user: true } });
  return (
    <div>
      <h1 className="text-lg font-bold">Subscriptions</h1>
      <div className="mt-4 overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="px-3 py-2 text-left">Business</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Start</th><th className="px-3 py-2">Expiry</th></tr></thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-2">{s.business.name}</td>
                <td className="px-3 py-2 text-xs">{s.user.email}</td>
                <td className="px-3 py-2 text-center text-xs">{s.plan.name}</td>
                <td className="px-3 py-2 text-center"><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold">{s.status}</span></td>
                <td className="px-3 py-2 text-xs">{s.startAt ? new Date(s.startAt).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2 text-xs">{s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
