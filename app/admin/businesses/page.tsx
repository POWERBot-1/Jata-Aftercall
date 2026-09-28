import prisma from "@/lib/db";
import AdminBusinessActions from "@/components/AdminBusinessActions";
export const dynamic = "force-dynamic";


export default async function AdminBusinesses({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: query } = await searchParams;
  const q = (query || "").trim();
  const where = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const businesses = await prisma.business.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, include: { owner: true, subscription: { include: { plan: true } } } });

  return (
    <div>
      <h1 className="text-lg font-bold">Businesses</h1>
      <form className="mt-3 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name / slug" className="w-full rounded-xl border px-3 py-2 text-sm" />
        <button className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>
      <div className="mt-4 space-y-3">
        {businesses.map((b) => (
          <div key={b.id} className="rounded-2xl border bg-white p-4">
            <p className="text-sm font-bold">{b.name} — /b/{b.slug}</p>
            <p className="text-xs text-zinc-500">Owner: {b.owner.email} • {b.category} • {b.theme} • {b.isPublished ? "🟢 LIVE" : "⚪ DRAFT"} • {b.status}</p>
            <p className="text-xs">Subscription: {b.subscription ? `${b.subscription.status} • ${b.subscription.plan.name}` : "None"}</p>
            <div className="mt-2 flex gap-2">
              <a href={`/b/${b.slug}`} target="_blank" className="rounded-full border px-3 py-1 text-xs">View page</a>
              <AdminBusinessActions businessId={b.id} isPublished={b.isPublished} status={b.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}