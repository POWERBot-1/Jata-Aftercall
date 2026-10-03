import { emptyStateFor } from "@/lib/pos/presentation";
import { formSpec } from "@/lib/pos/forms";
import { expenseTotals, listExpenses } from "@/lib/pos/store";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { RecordBoard } from "@/components/pos/RecordBoard";
import { formatKES } from "@/lib/format";

/**
 * Expenses (§17). Categories come from the setup, including the ones the owner named themselves.
 * An expense can be added but never edited: the ledger stays a record of what actually happened
 * (§54).
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosExpensesPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadPosWorkspaceCached(businessId);
  const configuration = workspace.configuration;
  const spec = formSpec(configuration, "expense");

  const [expenses, totals] = await Promise.all([listExpenses(businessId, { take: 200 }), expenseTotals(businessId, {})]);

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{spec.plural}</p>
          <h2 className="text-xl font-bold">{spec.plural}</h2>
          <p className="pos-note">What the business spends, so the profit number means something.</p>
        </div>
        <span className="jata-status">{formatKES(totals.amountKES)} recorded</span>
      </div>

      <RecordBoard
        businessId={businessId}
        basePath={workspace.basePath}
        apiPath={`/api/pos/${encodeURIComponent(businessId)}/expenses`}
        word={spec.word}
        plural={spec.plural}
        fields={spec.fields}
        rows={(expenses as any[]).map((expense) => ({
          ...expense,
          when: new Date(expense.occurredAt).toLocaleDateString("en-KE"),
        }))}
        titleKey="categoryKey"
        subtitleKeys={["label", "when", "method"]}
        valueColumns={[{ key: "amountKES", money: true }]}
        canEdit={workspace.permissions.includes("CREATE_EXPENSE")}
        canEditRow={false}
        openNew={query.new === "1"}
        emptyState={emptyStateFor(configuration, "expenses", workspace.basePath)}
      />
    </div>
  );
}
