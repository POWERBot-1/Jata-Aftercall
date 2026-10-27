import { randomUUID } from "node:crypto";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadInvoices } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { Badge, EmptyState, Kpi, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { AGEING_BUCKETS } from "@/lib/erp/invoicing";
import { createInvoiceAction, creditNoteAction, issueInvoiceAction, recordPaymentAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Invoices, receipts and receivables.
 *
 * The list shows issued documents and their balances. Drafts are clearly drafts: they have no
 * ledger entry and no receivable. Ageing comes from the invoice due dates, not from a manual
 * summary, and every action posts through the accounting module.
 */
export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadInvoices(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const requestKey = randomUUID();
  const drafts = data.invoices.filter((invoice: any) => invoice.status === "DRAFT");

  return (
    <>
      <PageHead
        title="Invoices and receipts"
        description="Issue an invoice and the receivable is posted once, in the same transaction. Receipts are allocated with a cap; credit notes reverse through the ledger."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Outstanding" value={formatCentsShort(data.ageing.totalCents)} hint={`${data.ageing.rows.length} open invoices`} />
        <Kpi label="Overdue" value={formatCentsShort(data.ageing.totals["1_30"] + data.ageing.totals["31_60"] + data.ageing.totals["61_90"] + data.ageing.totals.OVER_90)} hint="Past the due date" />
        <Kpi label="Received" value={formatCentsShort(data.payments.reduce((total: number, payment: any) => total + Number(payment.amountCents ?? 0), 0))} hint={`${data.payments.length} receipts`} />
        <Kpi label="Credit notes" value={String(data.credits.length)} hint="Posted as mirrors, never deletions" />
      </dl>

      <section className="erp-card">
        <h2>New invoice</h2>
        <p className="erp-card-sub">Prices are entered in shillings and stored in cents. Tax is resolved by effective date — a rate change cannot rewrite an old invoice.</p>
        <form action={createInvoiceAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="requestKey" value={requestKey} />
          <div className="erp-row">
            <div className="erp-field">
              <label className="erp-label" htmlFor="customerName">Customer name</label>
              <input id="customerName" name="customerName" className="erp-input" required minLength={2} />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="customerPhone">Phone (optional)</label>
              <input id="customerPhone" name="customerPhone" className="erp-input" inputMode="tel" placeholder="07XXXXXXXX" />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="dueAt">Due date</label>
              <input id="dueAt" name="dueAt" type="date" className="erp-input" />
              <p className="erp-hint">Leave blank for 7 days.</p>
            </div>
          </div>

          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Unit price (KES)</th><th>Tax</th></tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((index) => (
                  <tr key={index}>
                    <td><input name="itemDescription" className="erp-input" placeholder={index === 0 ? "Consulting — October" : "Optional second line"} /></td>
                    <td><input name="itemQuantity" className="erp-input" type="number" min="0.001" step="0.001" defaultValue="1" style={{ width: 90 }} /></td>
                    <td><input name="itemPrice" className="erp-input" inputMode="decimal" placeholder="0.00" /></td>
                    <td>
                      <select name="itemTaxKey" className="erp-select" defaultValue="VAT_STANDARD" aria-label="Tax treatment">
                        <option value="VAT_STANDARD">VAT 16%</option>
                        <option value="VAT_ZERO">Zero-rated</option>
                        <option value="VAT_EXEMPT">Exempt</option>
                        <option value="OUT_OF_SCOPE">Out of scope</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="erp-field" style={{ marginTop: 12 }}>
            <label className="erp-label" htmlFor="notes">Note on the invoice (optional)</label>
            <input id="notes" name="notes" className="erp-input" maxLength={200} />
          </div>
          <label className="erp-check">
            <input type="checkbox" name="issueNow" value="on" />
            <span>Issue immediately. This posts the receivable and revenue to the ledger.</span>
          </label>
          <div className="erp-actions">
            <button type="submit" className="erp-btn erp-btn-primary">Create invoice</button>
            <span className="erp-hint">Only issued invoices count as receivables or revenue.</span>
          </div>
        </form>
      </section>

      <section className="erp-card">
        <h2>Invoices</h2>
        <p className="erp-card-sub">A draft can be edited by issuing a new one; an issued invoice is corrected with a credit note, never edited.</p>
        {data.invoices.length === 0 ? (
          <EmptyState glyph="▦" title="No invoices yet">Create one above. When you issue it, the ledger gets a matching entry and the receivables report includes it.</EmptyState>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr><th>Number</th><th>Customer</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th><th>Due</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice: any) => (
                  <tr key={invoice.id}>
                    <td className="erp-mono">{invoice.invoiceNumber}</td>
                    <td>{invoice.customerName}</td>
                    <td><Badge tone={StatusTone(invoice.status)}>{humanise(invoice.status)}</Badge></td>
                    <td className="num">{formatCentsShort(invoice.totalCents)}</td>
                    <td className="num">{formatCentsShort(invoice.balanceCents)}</td>
                    <td className="erp-small">{invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString("en-KE") : "—"}</td>
                    <td>
                      <div className="erp-actions">
                        {invoice.status === "DRAFT" ? (
                          <form action={issueInvoiceAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-primary">Issue</button>
                          </form>
                        ) : null}
                        {["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) && Number(invoice.balanceCents) > 0 ? (
                          <form action={recordPaymentAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="requestKey" value={`${requestKey}-${invoice.id}`} />
                            <input type="hidden" name="method" value="cash" />
                            <input name="amount" className="erp-input" inputMode="decimal" placeholder="Amount" style={{ width: 110, minHeight: 34, padding: "6px 8px" }} aria-label={`Amount received against ${invoice.invoiceNumber}`} />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">Receipt</button>
                          </form>
                        ) : null}
                        {["ISSUED", "PARTIALLY_PAID", "PAID"].includes(invoice.status) ? (
                          <form action={creditNoteAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="requestKey" value={`credit-${requestKey}-${invoice.id}`} />
                            <input type="hidden" name="netAmount" value={String(Number(invoice.subtotalCents ?? 0) / 100)} />
                            <input type="hidden" name="taxAmount" value={String(Number(invoice.taxCents ?? 0) / 100)} />
                            <input name="reason" className="erp-input" placeholder="Reason for credit" style={{ width: 150, minHeight: 34, padding: "6px 8px" }} aria-label={`Reason for crediting ${invoice.invoiceNumber}`} />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-danger">Credit full</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {drafts.length > 0 ? <p className="erp-hint">{drafts.length} draft{drafts.length === 1 ? "" : "s"} not yet issued — they are excluded from revenue and receivables.</p> : null}
      </section>

      <section className="erp-card" id="ageing">
        <h2>Receivables ageing</h2>
        <p className="erp-card-sub">Buckets are computed from due dates as at {new Date(data.ageing.asOf).toLocaleDateString("en-KE")}.</p>
        <div className="erp-grid erp-grid-4">
          {AGEING_BUCKETS.map((bucket) => (
            <Kpi key={bucket} label={ageingLabel(bucket)} value={formatCentsShort(data.ageing.totals[bucket])} />
          ))}
        </div>
        {data.ageing.rows.length === 0 ? (
          <p className="erp-hint" style={{ marginTop: 12 }}>Nothing outstanding. That is a real zero from the invoice table, not a placeholder.</p>
        ) : (
          <div className="erp-table-wrap" style={{ marginTop: 12 }}>
            <table className="erp-table">
              <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Bucket</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {data.ageing.rows.map((row: any) => (
                  <tr key={row.invoiceId}>
                    <td className="erp-mono">{row.invoiceNumber}</td>
                    <td>{row.customerName}</td>
                    <td className="erp-small">{row.dueAt ? new Date(row.dueAt).toLocaleDateString("en-KE") : "—"}</td>
                    <td><Badge tone={row.bucket === "CURRENT" ? "good" : row.bucket === "OVER_90" ? "bad" : "warn"}>{ageingLabel(row.bucket)}</Badge></td>
                    <td className="num">{formatCentsShort(row.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="erp-hint">Send a reminder from <a href={`${base}/messaging/new`}>Messaging</a> with the “Customers with overdue invoices” audience. Reminders still obey consent and quiet hours.</p>
      </section>
    </>
  );
}

function ageingLabel(bucket: string): string {
  if (bucket === "CURRENT") return "Current";
  if (bucket === "1_30") return "1–30 days";
  if (bucket === "31_60") return "31–60 days";
  if (bucket === "61_90") return "61–90 days";
  return "Over 90 days";
}
