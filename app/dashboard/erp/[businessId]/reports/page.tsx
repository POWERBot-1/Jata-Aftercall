import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadAccounting, loadInvoices, loadMessagingOverview } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";

export const dynamic = "force-dynamic";

/**
 * Reports.
 *
 * Financial statements come from posted journals. The messaging section reports deliveries,
 * failures and cost as recorded, and states plainly that delivery is not readership or revenue.
 */
export default async function ReportsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const workspace = await loadErpWorkspace(businessId);
  const [accounting, invoices, messaging] = await Promise.all([
    loadAccounting(businessId),
    loadInvoices(businessId),
    loadMessagingOverview(businessId),
  ]);

  const paid = invoices.invoices.filter((invoice: any) => invoice.status === "PAID");
  const drafts = invoices.invoices.filter((invoice: any) => invoice.status === "DRAFT");
  const revenue = invoices.invoices
    .filter((invoice: any) => !["DRAFT", "VOIDED"].includes(invoice.status))
    .reduce((total: number, invoice: any) => total + Number(invoice.totalCents ?? 0), 0);
  const vat = invoices.invoices
    .filter((invoice: any) => !["DRAFT", "VOIDED"].includes(invoice.status))
    .reduce((total: number, invoice: any) => total + Number(invoice.taxCents ?? 0), 0);
  const topDebtors = [...invoices.ageing.rows].sort((a: any, b: any) => b.balanceCents - a.balanceCents).slice(0, 5);

  return (
    <>
      <PageHead
        title="Reports"
        description="One set of numbers, computed from the ledger and from provider records — not typed into a dashboard."
      />

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Invoiced" value={formatCentsShort(revenue)} hint={`${invoices.invoices.length} invoices · ${drafts.length} draft`} />
        <Kpi label="Collected" value={formatCentsShort(invoices.payments.reduce((total: number, payment: any) => total + Number(payment.amountCents ?? 0), 0))} hint={`${paid.length} fully paid`} />
        <Kpi label="Outstanding" value={formatCentsShort(invoices.ageing.totalCents)} hint={`${workspace.counts.overdueInvoices} overdue`} />
        <Kpi label="VAT on invoices" value={formatCentsShort(vat)} hint="Output tax recorded, not a return" />
      </dl>

      <section className="erp-grid erp-grid-2">
        <div className="erp-card">
          <h2>Profit and loss (year to date)</h2>
          <ul className="erp-list">
            {accounting.profitAndLoss.income.map((row: any) => (
              <li key={row.accountCode}><span>{row.accountName}</span><span className="erp-small">{formatCentsShort(row.balanceCents)}</span></li>
            ))}
            <li><span className="erp-strong">Income</span><span className="erp-strong">{formatCentsShort(accounting.profitAndLoss.totalIncomeCents)}</span></li>
            {accounting.profitAndLoss.expenses.map((row: any) => (
              <li key={row.accountCode}><span>{row.accountName}</span><span className="erp-small">{formatCentsShort(row.balanceCents)}</span></li>
            ))}
            <li><span className="erp-strong">Expenses</span><span className="erp-strong">{formatCentsShort(accounting.profitAndLoss.totalExpenseCents)}</span></li>
            <li><span className="erp-strong">Net profit</span><span className="erp-strong">{formatCentsShort(accounting.profitAndLoss.netProfitCents)}</span></li>
          </ul>
        </div>

        <div className="erp-card">
          <h2>Largest outstanding balances</h2>
          {topDebtors.length === 0 ? (
            <p className="erp-hint">Nothing outstanding. The report is empty because the ledger says so.</p>
          ) : (
            <ul className="erp-list">
              {topDebtors.map((row: any) => (
                <li key={row.invoiceId}>
                  <div>
                    <div className="erp-strong">{row.customerName}</div>
                    <div className="erp-muted erp-small">{row.invoiceNumber} · {humanise(row.bucket)}</div>
                  </div>
                  <span className="erp-small">{formatCentsShort(row.balanceCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="erp-card">
        <h2>Messaging performance</h2>
        <p className="erp-card-sub">Counts come from recipient rows updated by provider callbacks.</p>
        <dl className="erp-grid erp-grid-4">
          <Kpi label="Sent" value={String(messaging.stats.sent)} hint="Submitted to the provider" />
          <Kpi label="Delivered" value={String(messaging.stats.delivered)} hint="Provider confirmed" />
          <Kpi label="Failed" value={String(messaging.stats.failed)} hint="Provider rejected or gave up" />
          <Kpi label="Unknown" value={String(messaging.stats.unknown)} hint="Timed out — awaiting reconciliation" />
        </dl>
        <Notice tone="info">
          Delivered messages are not read messages, and this report does not claim revenue attribution. Link-click tracking and attributed sales are on the roadmap and clearly marked as not implemented.
        </Notice>
      </section>

      <section className="erp-card">
        <h2>Balance sheet check</h2>
        <p className="erp-card-sub">Assets should equal liabilities plus equity plus profit. If not, something was changed outside the app.</p>
        <ul className="erp-list">
          <li><span>Assets</span><span>{formatCentsShort(accounting.balanceSheet.totalAssetsCents)}</span></li>
          <li><span>Liabilities</span><span>{formatCentsShort(accounting.balanceSheet.totalLiabilitiesCents)}</span></li>
          <li><span>Equity</span><span>{formatCentsShort(accounting.balanceSheet.totalEquityCents)}</span></li>
          <li><span>Profit for the period</span><span>{formatCentsShort(accounting.balanceSheet.netIncomeCents)}</span></li>
          <li>
            <span className="erp-strong">Result</span>
            <span className={accounting.balanceSheet.balanced ? "erp-pass erp-small" : "erp-fail erp-small"}>
              {accounting.balanceSheet.balanced ? "Balanced" : "Does not reconcile"}
            </span>
          </li>
        </ul>
      </section>
    </>
  );
}
