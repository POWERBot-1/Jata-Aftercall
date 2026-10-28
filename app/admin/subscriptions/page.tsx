import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage, AdminStatus, AdminTable } from "@/components/admin/AdminUI";

export const dynamic = "force-dynamic";

/** Every AFTERCALL subscription, soonest expiry first, so renewals are worked from the top. */
export default async function AdminSubscriptions() {
  await requireAdminPage();
  const subs = await prisma.subscription.findMany({ orderBy: { expiresAt: "asc" }, include: { business: true, plan: true, user: true } });
  const expiring = subs.filter((s) => s.expiresAt && s.expiresAt.getTime() - Date.now() < 1000 * 60 * 60 * 24 * 14).length;

  return (
    <AdminPage
      kicker="Platform admin"
      title="Subscriptions"
      meta={`${subs.length} ${subs.length === 1 ? "subscription" : "subscriptions"}, soonest expiry first${expiring ? ` — ${expiring} due within 14 days` : ""}.`}
    >
      {subs.length === 0 ? (
        <p className="ws-muted">No subscription has been recorded yet.</p>
      ) : (
        <AdminTable caption="Subscriptions" head={
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Account</th>
            <th scope="col">Plan</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Expires</th>
          </tr>
        }>
          {subs.map((s) => (
            <tr key={s.id}>
              <td>{s.business.name}</td>
              <td>{s.user.email}</td>
              <td>{s.plan.name}</td>
              <td><AdminStatus value={s.status} /></td>
              <td>{s.startAt ? formatDate(s.startAt) : "—"}</td>
              <td>{s.expiresAt ? formatDate(s.expiresAt) : "—"}</td>
            </tr>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
