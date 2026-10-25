import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import AdminBusinessActions from "@/components/AdminBusinessActions";
import { AdminPage, AdminRecord, AdminSearch, AdminStatus } from "@/components/admin/AdminUI";

export const dynamic = "force-dynamic";

export default async function AdminBusinesses({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdminPage();
  const { q: query } = await searchParams;
  const q = (query || "").trim();
  const where = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {};
  const businesses = await prisma.business.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, include: { owner: true, subscription: { include: { plan: true } } } });

  return (
    <AdminPage
      kicker="Platform admin"
      title="Businesses"
      meta={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"}${q ? ` matching “${q}”` : ", newest first"}. Publishing and suspension are audited actions.`}
    >
      <AdminSearch action="/admin/businesses" defaultValue={q} placeholder="Search name or slug" label="Search businesses by name or slug" />
      <div className="ws-stack">
        {businesses.length === 0 ? (
          <p className="ws-muted">No business matches that search.</p>
        ) : (
          businesses.map((b) => (
            <AdminRecord
              key={b.id}
              title={b.name}
              subtitle={`/b/${b.slug} · ${b.owner.email}`}
              tone={b.isPublished ? "live" : "draft"}
              facts={[
                { label: "Category", value: b.category || "—" },
                { label: "Business status", value: <AdminStatus value={b.status} /> },
                {
                  label: "Subscription",
                  value: b.subscription ? `${b.subscription.status} · ${b.subscription.plan.name}` : "None",
                },
              ]}
              actions={
                <>
                  <a href={`/b/${b.slug}`} target="_blank" rel="noopener noreferrer" className="ws-btn-outline ws-btn-outline--ink">
                    View page
                  </a>
                  <AdminBusinessActions businessId={b.id} isPublished={b.isPublished} status={b.status} />
                </>
              }
            />
          ))
        )}
      </div>
    </AdminPage>
  );
}
