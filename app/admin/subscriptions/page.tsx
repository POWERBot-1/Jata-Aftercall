import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage, AdminStatus, AdminTable } from "@/components/admin/AdminUI";
import { renewalCounts } from "@/lib/admin/platform-figures";

export const dynamic = "force-dynamic";

/** Every AFTERCALL subscription, soonest expiry first, so renewals are worked from the top. */
export default async function AdminSubscriptions() {
  await requireAdminPage();
  type FrontDeskEntitlementRow = {
    businessId: string;
    packageKey: string;
    status: string;
    expiresAt: Date | null;
  };
  const [subs, entitlements] = await Promise.all([
    // Only displayed fields are read (no password hash or session version reaches the render).
    prisma.subscription.findMany({
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: {
        id: true, businessId: true, status: true, startAt: true, expiresAt: true,
        business: { select: { name: true } },
        plan: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
    // §41.10 #12 — administrative entitlement visibility: the Front Desk tier each business
    // actually holds, read alongside the subscription. One query, no writes.
    prisma.aIPackageEntitlement.findMany({
      select: { businessId: true, packageKey: true, status: true, expiresAt: true },
    }) as Promise<FrontDeskEntitlementRow[]>,
  ]);
  const entitlementByBusiness = new Map(entitlements.map((e) => [e.businessId, e]));
  const { dueSoon, overdue } = renewalCounts(subs);

  return (
    <AdminPage
      kicker="Platform admin"
      title="Subscriptions"
      meta={`${subs.length} ${subs.length === 1 ? "subscription" : "subscriptions"}, soonest expiry first${dueSoon ? ` — ${dueSoon} live due within 14 days` : ""}${overdue ? ` — ${overdue} still marked live but past expiry` : ""}.`}
    >
      {subs.length === 0 ? (
        <p className="ws-muted">No subscription has been recorded yet.</p>
      ) : (
        <AdminTable caption="Subscriptions" head={
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Account</th>
            <th scope="col">Plan</th>
            <th scope="col">Front Desk entitlement</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Expires</th>
          </tr>
        }>
          {subs.map((s) => {
            const ent = entitlementByBusiness.get(s.businessId);
            return (
              <tr key={s.id}>
                <td>{s.business.name}</td>
                <td>{s.user.email}</td>
                <td>{s.plan.name}</td>
                <td>
                  {ent ? `${ent.packageKey} · ${ent.status}${ent.expiresAt ? ` (until ${formatDate(ent.expiresAt)})` : ""}` : "—"}
                </td>
                <td><AdminStatus value={s.status} /></td>
                <td>{s.startAt ? formatDate(s.startAt) : "—"}</td>
                <td>{s.expiresAt ? formatDate(s.expiresAt) : "—"}</td>
              </tr>
            );
          })}
        </AdminTable>
      )}
    </AdminPage>
  );
}
