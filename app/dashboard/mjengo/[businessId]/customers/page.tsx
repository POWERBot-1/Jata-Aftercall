import { notFound } from "next/navigation";
import { loadCustomerCreditOverview } from "@/lib/mjengo/workspace";

export const dynamic = "force-dynamic";
const money = (v: number) => `KES ${Math.round(Number(v) || 0).toLocaleString("en-KE")}`;
const cents = (v: number) => `KES ${((Number(v) || 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

export default async function MjengoCustomers({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const { customers, invoices, overdueInvoices, receivableKES } = await loadCustomerCreditOverview(businessId);

  return (
    <section aria-labelledby="mjengo-customers-heading">
      <h2 id="mjengo-customers-heading" className="text-lg font-semibold">Customers &amp; credit</h2>
      <p className="text-sm text-muted-foreground">
        A credit sale is decided server-side against the stored limit and the account&apos;s overdue
        state — a browser flag cannot raise a limit. Customer receivable and supplier payable are
        separate ledgers and never offset each other.
      </p>
      <p className="mt-2 text-sm">Receivable: {money(receivableKES)} · overdue invoices: {overdueInvoices.length}</p>

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Customer credit balances</caption>
        <thead><tr className="text-left text-muted-foreground"><th scope="col">Customer</th><th scope="col">Balance</th><th scope="col">Limit</th><th scope="col">Credit</th></tr></thead>
        <tbody>
          {customers.map((customer: any) => (
            <tr key={customer.id} className="border-t">
              <td className="py-1">{customer.name}</td>
              <td>{money(customer.balanceKES)}</td>
              <td>{money(customer.creditLimitKES)}</td>
              <td>{customer.creditEnabled ? "Enabled" : "Cash only"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {customers.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No customers recorded.</p> : null}

      <h3 className="mt-8 font-medium">Open invoices</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {invoices.map((invoice: any) => (
          <li key={invoice.id} className="flex justify-between gap-3 border-t py-1">
            <span>{invoice.invoiceNumber} — {invoice.customerName}</span>
            <span className="text-muted-foreground">{cents(invoice.totalCents)} · paid {cents(invoice.paidCents)}</span>
          </li>
        ))}
        {invoices.length === 0 ? <li className="text-muted-foreground">No open invoices.</li> : null}
      </ul>
    </section>
  );
}
