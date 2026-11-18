import { formatDateTime, formatNumber } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage, AdminStatus, AdminTable } from "@/components/admin/AdminUI";
import { minorToMajor, paymentPurposeLabel } from "@/lib/admin/platform-figures";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

/**
 * The payment ledger.
 *
 * Read-only on purpose: money is settled by Paystack's confirmation, never by a console click.
 * No provider secret, card detail or customer contact field is selected here — reference, amount,
 * status, provider, date and the business it belongs to is the whole record.
 */
export default async function AdminPayments() {
  await requireAdminPage();
  // Only the displayed fields are read: no password hash, session version or provider payload
  // reaches this render (R-ADM-01). The newest PAGE_SIZE rows are shown and the total is stated,
  // so a truncated list is never mistaken for the whole ledger.
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      select: {
        id: true, reference: true, amount: true, currency: true, status: true, purpose: true, createdAt: true,
        user: { select: { email: true } },
        business: { select: { name: true } },
      },
    }),
    prisma.payment.count(),
  ]);

  return (
    <AdminPage
      kicker="Platform admin"
      title="Payments"
      meta={`${total > payments.length ? `Newest ${formatNumber(payments.length)} of ${formatNumber(total)}` : `${formatNumber(payments.length)}`} ${total === 1 ? "record" : "records"}. Status comes from the provider confirmation — this screen never marks a payment paid. Customer orders and deposits are money paid to businesses, not Jata revenue.`}
    >
      {payments.length === 0 ? (
        <p className="ws-muted">No payment has been recorded yet.</p>
      ) : (
        <AdminTable caption="Recent payments" head={
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Kind</th>
            <th scope="col">Owner account</th>
            <th scope="col">Business</th>
            <th scope="col" className="ws-table__num">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Recorded</th>
          </tr>
        }>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="ws-table__mono">{p.reference}</td>
              <td>{paymentPurposeLabel(p.purpose)}</td>
              <td>{p.user.email}</td>
              <td>{p.business?.name || "—"}</td>
              <td className="ws-table__num">{p.currency} {formatNumber(minorToMajor(p.amount))}</td>
              <td><AdminStatus value={p.status} /></td>
              <td>{formatDateTime(p.createdAt)}</td>
            </tr>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
