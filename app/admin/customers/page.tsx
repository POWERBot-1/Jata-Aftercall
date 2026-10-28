import { formatDate, formatNumber } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage, AdminRecord, AdminSearch, AdminStatus } from "@/components/admin/AdminUI";

export const dynamic = "force-dynamic";

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdminPage();
  const { q: query } = await searchParams;
  const q = (query || "").trim();
  const where = q
    ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] }
    : {};
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, include: { businesses: false } as any });
  // Per-account detail is read one account at a time so a single slow relation cannot blank the list.
  const withCounts = await Promise.all(
    users.map(async (u) => {
      const bizCount = await prisma.business.count({ where: { ownerId: u.id } });
      const payments = await prisma.payment.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 1 });
      const sub = await prisma.subscription.findFirst({ where: { userId: u.id }, include: { plan: true } });
      return { ...u, bizCount, lastPayment: payments[0] || null, sub };
    }),
  );

  return (
    <AdminPage
      kicker="Platform admin"
      title="Customers"
      meta={`${withCounts.length} ${withCounts.length === 1 ? "account" : "accounts"}${q ? ` matching “${q}”` : ", newest first"}. Contact details are shown to admins only; nothing here is exported or shared.`}
    >
      <AdminSearch action="/admin/customers" defaultValue={q} placeholder="Search email, name or phone" label="Search accounts by email, name or phone" />
      <div className="ws-stack">
        {withCounts.length === 0 ? (
          <p className="ws-muted">No account matches that search.</p>
        ) : (
          withCounts.map((u) => (
            <AdminRecord
              key={u.id}
              title={u.name || u.email}
              subtitle={u.name ? u.email : u.phone || "No phone on file"}
              facts={[
                { label: "Role", value: <AdminStatus value={u.role} /> },
                { label: "Businesses", value: formatNumber(u.bizCount) },
                { label: "Subscription", value: u.sub ? `${u.sub.status} · ${u.sub.plan.name}` : "None" },
                { label: "Renews / expires", value: u.sub?.expiresAt ? formatDate(u.sub.expiresAt) : "—" },
                {
                  label: "Last payment",
                  value: u.lastPayment
                    ? `KES ${formatNumber(u.lastPayment.amount / 100)} · ${u.lastPayment.status}`
                    : "None",
                },
              ]}
            />
          ))
        )}
      </div>
    </AdminPage>
  );
}
