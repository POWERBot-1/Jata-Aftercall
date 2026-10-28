import { formatDateTime, formatNumber } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage, AdminStatus, AdminTable } from "@/components/admin/AdminUI";

export const dynamic = "force-dynamic";

/**
 * The payment ledger.
 *
 * Read-only on purpose: money is settled by Paystack's confirmation, never by a console click.
 * No provider secret, card detail or customer contact field is selected here — reference, amount,
 * status, provider, date and the business it belongs to is the whole record.
 */
export default async function AdminPayments() {
  await requireAdminPage();
  const payments = await prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: true, business: true } });

  return (
    <AdminPage
      kicker="Platform admin"
      title="Payments"
      meta={`${payments.length} most recent ${payments.length === 1 ? "record" : "records"}. Status comes from the provider confirmation — this screen never marks a payment paid.`}
    >
      {payments.length === 0 ? (
        <p className="ws-muted">No payment has been recorded yet.</p>
      ) : (
        <AdminTable caption="Recent payments" head={
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Account</th>
            <th scope="col">Business</th>
            <th scope="col" className="ws-table__num">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Recorded</th>
          </tr>
        }>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="ws-table__mono">{p.reference}</td>
              <td>{p.user.email}</td>
              <td>{p.business?.name || "—"}</td>
              <td className="ws-table__num">KES {formatNumber(p.amount / 100)}</td>
              <td><AdminStatus value={p.status} /></td>
              <td>{formatDateTime(p.createdAt)}</td>
            </tr>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
