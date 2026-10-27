import { randomUUID } from "node:crypto";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadAccounting } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { Badge, EmptyState, Kpi, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { closePeriodAction, postJournalAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Accounting.
 *
 * Reports are computed from posted journals every time the page loads. There is no stored summary
 * that could disagree with the ledger, and the trial balance proves its own balance. Manual
 * journals are allowed for the accountant-shaped gaps, but they must balance and they are posted
 * once.
 */
export default async function AccountingPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadAccounting(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const requestKey = randomUUID();
  const tb = data.trialBalance;
  const pnl = data.profitAndLoss;
  const bs = data.balanceSheet;
  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <>
      <PageHead
        title="Accounting"
        description="Double entry from real documents. Posted journals are immutable: corrections are reversals, not edits."
        actions={<Badge tone={tb.balanced ? "good" : "bad"}>{tb.balanced ? "Ledger balanced" : "Ledger out of balance"}</Badge>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Assets" value={formatCentsShort(bs.totalAssetsCents)} hint={`as at ${new Date(bs.asOf ?? Date.now()).toLocaleDateString("en-KE")}`} />
        <Kpi label="Liabilities" value={formatCentsShort(bs.totalLiabilitiesCents)} hint="Including VAT output and deposits" />
        <Kpi label="Net profit (YTD)" value={formatCentsShort(pnl.netProfitCents)} hint={`${formatCentsShort(pnl.totalIncomeCents)} income`} />
        <Kpi label="Journals posted" value={String(data.journals.length)} hint={`${tb.rows.length} accounts with movement`} />
      </dl>

      {!tb.balanced ? (
        <Notice tone="danger">
          The trial balance does not balance. Do not post anything else until this is investigated — every document below was written in one transaction with its journal, so a mismatch means data was changed outside the app.
        </Notice>
      ) : null}

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Trial balance</h2>
          <p className="erp-card-sub">Debits and credits as posted. Accounts with no movement are omitted.</p>
          {tb.rows.length === 0 ? (
            <EmptyState glyph="▥" title="No postings yet">Issuing an invoice, recording an expense or posting a journal creates the first ledger entries.</EmptyState>
          ) : (
            <div className="erp-table-wrap">
              <table className="erp-table">
                <thead><tr><th>Code</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                <tbody>
                  {tb.rows.map((row: any) => (
                    <tr key={row.accountCode}>
                      <td className="erp-mono">{row.accountCode}</td>
                      <td>{row.accountName}<div className="erp-muted erp-small">{humanise(row.accountType)}</div></td>
                      <td className="num">{row.debitCents ? formatCentsShort(row.debitCents) : "—"}</td>
                      <td className="num">{row.creditCents ? formatCentsShort(row.creditCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Totals</td>
                    <td className="num">{formatCentsShort(tb.totalDebitCents)}</td>
                    <td className="num">{formatCentsShort(tb.totalCreditCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="erp-card">
          <h2>Profit and loss</h2>
          <p className="erp-card-sub">This calendar year to date.</p>
          <ul className="erp-list">
            {pnl.income.map((row: any) => (
              <li key={`i-${row.accountCode}`}><span>{row.accountName}</span><span className="erp-small">{formatCentsShort(row.balanceCents)}</span></li>
            ))}
            <li><span className="erp-strong">Total income</span><span className="erp-strong">{formatCentsShort(pnl.totalIncomeCents)}</span></li>
            {pnl.expenses.map((row: any) => (
              <li key={`e-${row.accountCode}`}><span>{row.accountName}</span><span className="erp-small">{formatCentsShort(row.balanceCents)}</span></li>
            ))}
            <li><span className="erp-strong">Total expenses</span><span className="erp-strong">{formatCentsShort(pnl.totalExpenseCents)}</span></li>
            <li><span className="erp-strong">Net profit</span><span className="erp-strong">{formatCentsShort(pnl.netProfitCents)}</span></li>
          </ul>

          <h3 style={{ marginTop: 18 }}>Balance sheet</h3>
          <ul className="erp-list">
            <li><span>Assets</span><span>{formatCentsShort(bs.totalAssetsCents)}</span></li>
            <li><span>Liabilities</span><span>{formatCentsShort(bs.totalLiabilitiesCents)}</span></li>
            <li><span>Equity</span><span>{formatCentsShort(bs.totalEquityCents)}</span></li>
            <li><span>Profit for the period</span><span>{formatCentsShort(bs.netIncomeCents)}</span></li>
            <li>
              <span className="erp-strong">Check</span>
              <span className={bs.balanced ? "erp-pass erp-small" : "erp-fail erp-small"}>{bs.balanced ? "Assets = liabilities + equity + profit" : "Does not reconcile"}</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="erp-card">
        <h2>Post a journal</h2>
        <p className="erp-card-sub">For adjustments the documents do not cover. The post is refused unless debits equal credits and the period is open.</p>
        <form action={postJournalAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="requestKey" value={requestKey} />
          <div className="erp-row">
            <div className="erp-field">
              <label className="erp-label" htmlFor="entryDate">Date</label>
              <input id="entryDate" name="entryDate" type="date" className="erp-input" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="erp-field" style={{ flex: "2 1 320px" }}>
              <label className="erp-label" htmlFor="description">What is this for?</label>
              <input id="description" name="description" className="erp-input" required minLength={4} placeholder="Owner drawing — October" />
            </div>
          </div>
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead><tr><th>Account</th><th className="num">Debit (KES)</th><th className="num">Credit (KES)</th></tr></thead>
              <tbody>
                {[0, 1, 2].map((index) => (
                  <tr key={index}>
                    <td>
                      <select name="accountCode" className="erp-select" aria-label={`Account for line ${index + 1}`} defaultValue={index === 0 ? "1000" : index === 1 ? "3000" : ""}>
                        <option value="">—</option>
                        {data.accounts.map((account: any) => (
                          <option key={account.code} value={account.code}>{account.code} · {account.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num"><input name="debit" className="erp-input" inputMode="decimal" placeholder="0.00" style={{ minWidth: 110 }} /></td>
                    <td className="num"><input name="credit" className="erp-input" inputMode="decimal" placeholder="0.00" style={{ minWidth: 110 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="erp-btn erp-btn-dark" style={{ marginTop: 12 }}>Post journal</button>
          <p className="erp-hint">A posted journal cannot be edited or deleted. Correct it with a reversal, which keeps both records.</p>
        </form>
      </section>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Recent journals</h2>
          <p className="erp-card-sub">The most recent 40 postings, newest first.</p>
          {data.journals.length === 0 ? (
            <p className="erp-hint">No journals yet.</p>
          ) : (
            <ul className="erp-list">
              {data.journals.map((journal: any) => (
                <li key={journal.id}>
                  <div>
                    <div className="erp-strong">{journal.description}</div>
                    <div className="erp-muted erp-small">{journal.journalNumber} · {new Date(journal.entryDate).toLocaleDateString("en-KE")} · {humanise(journal.sourceType ?? "manual")}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Badge tone={StatusTone(journal.status)}>{humanise(journal.status)}</Badge>
                    <div className="erp-small">{formatCentsShort(journal.totalDebitCents)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="erp-card">
          <h2>Periods</h2>
          <p className="erp-card-sub">Closing a period prevents further postings into it. Reopening needs a written reason and leaves an audit trail.</p>
          {data.periods.length === 0 ? (
            <p className="erp-hint">No periods have been closed yet.</p>
          ) : (
            <ul className="erp-list">
              {data.periods.map((period: any) => (
                <li key={period.id}>
                  <span>{String(period.month).padStart(2, "0")}/{period.fiscalYear}</span>
                  <Badge tone={period.status === "CLOSED" ? "neutral" : "good"}>{humanise(period.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
          <form action={closePeriodAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="action" value="close" />
            <label className="erp-label" htmlFor="period">Close a month</label>
            <input id="period" name="period" type="month" className="erp-input" defaultValue={currentMonth} />
            <button type="submit" className="erp-btn erp-btn-secondary erp-btn-wide" style={{ marginTop: 8 }}>Close period</button>
          </form>
          <form action={closePeriodAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="action" value="reopen" />
            <input type="hidden" name="period" value={currentMonth} />
            <input name="reason" className="erp-input" placeholder="Why reopen? (at least 10 characters)" minLength={10} />
            <button type="submit" className="erp-btn erp-btn-ghost erp-btn-wide" style={{ marginTop: 6 }}>Reopen {currentMonth}</button>
          </form>
        </div>
      </section>
    </>
  );
}
