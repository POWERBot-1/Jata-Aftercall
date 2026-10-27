import { randomUUID } from "node:crypto";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadExpenses } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { EmptyState, Kpi, Notice, PageHead } from "@/components/erp/ErpBits";
import { recordExpenseAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Expenses and cash.
 *
 * Recording an expense posts a journal: the expense account, any VAT input, and the cash or bank
 * account it was paid from. The form asks which account so the ledger is not guessed.
 */
export default async function ExpensesPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadExpenses(businessId);
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = data.expenses.filter((expense: any) => new Date(expense.occurredAt) >= monthStart);

  return (
    <>
      <PageHead title="Expenses" description="Spending with a category, a payment account and a ledger post. VAT input is separated from the expense." />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Recorded" value={formatCentsShort(data.totalCents)} hint={`${data.expenses.length} entries`} />
        <Kpi label="This month" value={formatCentsShort(thisMonth.reduce((total: number, expense: any) => total + Number(expense.amountCents ?? 0), 0))} hint={`${thisMonth.length} entries`} />
        <Kpi label="Expense accounts" value={String(data.accounts.length)} hint="From your chart of accounts" />
      </dl>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Record an expense</h2>
          <form action={recordExpenseAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requestKey" value={randomUUID()} />
            <div className="erp-row">
              <div className="erp-field" style={{ flex: "2 1 240px" }}>
                <label className="erp-label" htmlFor="description">What was it for?</label>
                <input id="description" name="description" className="erp-input" required minLength={3} placeholder="Electricity — October" />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="amount">Amount (KES)</label>
                <input id="amount" name="amount" className="erp-input" inputMode="decimal" required placeholder="0.00" />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="tax">Includes VAT (KES)</label>
                <input id="tax" name="tax" className="erp-input" inputMode="decimal" placeholder="0.00" />
                <p className="erp-hint">Optional. Deducted from the amount and posted as VAT input.</p>
              </div>
            </div>
            <div className="erp-row">
              <div className="erp-field">
                <label className="erp-label" htmlFor="occurredAt">Date</label>
                <input id="occurredAt" name="occurredAt" type="date" className="erp-input" defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="category">Category</label>
                <input id="category" name="category" className="erp-input" placeholder="Utilities" maxLength={40} />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="accountCode">Expense account</label>
                <select id="accountCode" name="accountCode" className="erp-select" defaultValue={data.accounts[0]?.code ?? "5700"}>
                  {data.accounts.length === 0 ? <option value="5700">5700 · General expenses</option> : null}
                  {data.accounts.map((account: any) => (
                    <option key={account.code} value={account.code}>{account.code} · {account.name}</option>
                  ))}
                </select>
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="paidFromCode">Paid from</label>
                <select id="paidFromCode" name="paidFromCode" className="erp-select" defaultValue="1000">
                  <option value="1000">1000 · Cash</option>
                  <option value="1010">1010 · Bank</option>
                  <option value="2000">2000 · Supplier payable (on credit)</option>
                </select>
              </div>
            </div>
            <button type="submit" className="erp-btn erp-btn-primary">Record and post</button>
            <p className="erp-hint">The expense and its journal are written together. If either fails, neither is saved.</p>
          </form>
        </div>

        <div className="erp-card">
          <h2>Recently recorded</h2>
          {data.expenses.length === 0 ? (
            <EmptyState glyph="▧" title="No expenses yet">Record the first one. It will appear in the profit and loss report immediately.</EmptyState>
          ) : (
            <ul className="erp-list">
              {data.expenses.slice(0, 20).map((expense: any) => (
                <li key={expense.id}>
                  <div>
                    <div className="erp-strong">{expense.description}</div>
                    <div className="erp-muted erp-small">{humanDate(expense.occurredAt)} · {expense.category ?? "Uncategorised"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="erp-strong">{formatCentsShort(expense.amountCents)}</div>
                    <div className="erp-muted erp-small">{expense.taxCents ? `${formatCentsShort(expense.taxCents)} VAT` : "No VAT"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="erp-hint">Expenses are permanent postings. If one is wrong, post a correcting journal — do not delete it.</p>
        </div>
      </section>
    </>
  );
}

function humanDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}
