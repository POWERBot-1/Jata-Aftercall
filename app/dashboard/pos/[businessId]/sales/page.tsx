import Link from "next/link";
import { formatKES, formatDateTime } from "@/lib/format";
import { emptyStateFor } from "@/lib/pos/presentation";
import { channelLabel } from "@/lib/pos/receipt";
import { listSales, salesTotals } from "@/lib/pos/store";
import { sanitizeRange } from "@/lib/pos/validation";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";

/**
 * Sales history (§27, §54).
 *
 * A completed sale is a record, not an editable row: it can be refunded, returned or voided, and
 * every one of those writes its own row so the ledger still explains itself months later.
 */

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
};

export default async function PosSalesPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadPosWorkspaceCached(businessId);
  const range = sanitizeRange({ from: query.from, to: query.to }, 7);
  const [sales, totals] = await Promise.all([
    listSales(businessId, { range: { from: range.from, to: range.to }, status: query.status, take: 100 }),
    salesTotals(businessId, { from: range.from, to: range.to }),
  ]);
  const empty = emptyStateFor(workspace.configuration, "history", workspace.basePath);

  return (
    <div className="space-y-4">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{workspace.terminology.sales}</p>
          <h2 className="text-xl font-bold">{workspace.terminology.sales}</h2>
          <p className="pos-note">
            {new Date(range.from).toLocaleDateString("en-KE")} — {new Date(range.to).toLocaleDateString("en-KE")}
          </p>
        </div>
        <Link href={`${workspace.basePath}/sell`} className="jata-btn jata-btn-primary">+ New {workspace.terminology.sale.toLowerCase()}</Link>
      </div>

      <dl className="jata-stat-grid">
        <div className="jata-stat"><dt>{workspace.terminology.sales}</dt><dd>{totals.count}</dd></div>
        <div className="jata-stat"><dt>Taken</dt><dd>{formatKES(totals.totalKES)}</dd></div>
        <div className="jata-stat"><dt>Still owed</dt><dd>{formatKES(totals.balanceKES)}</dd></div>
        <div className="jata-stat"><dt>Refunded</dt><dd>{formatKES(totals.refundedKES)}</dd></div>
      </dl>

      {(sales as any[]).length === 0 ? (
        <div className="pos-empty">
          <strong>{empty.title}</strong>
          <p>{empty.body}</p>
          <Link href={empty.action.href} className="jata-btn jata-btn-primary">{empty.action.label}</Link>
        </div>
      ) : (
        <div className="pos-rows">
          {(sales as any[]).map((sale) => (
            <Link className="pos-row" key={sale.id} href={`${workspace.basePath}/sales/${sale.id}`}>
              <div className="pos-row-main">
                <strong>{sale.receiptNumber}</strong>
                <small>
                  {formatDateTime(sale.createdAt)} · {channelLabel(sale.channel) || "Walk-in"}
                  {sale.customerName ? ` · ${sale.customerName}` : ""}
                  {sale.staffName ? ` · ${sale.staffName}` : ""}
                </small>
              </div>
              <div className="pos-row-values">
                <span>{formatKES(sale.totalKES)}</span>
                {sale.balanceKES > 0 ? <span className="pos-pill" data-tone="warn">Owes {formatKES(sale.balanceKES)}</span> : null}
                {sale.status === "REFUNDED" ? <span className="pos-pill" data-tone="danger">Refunded</span> : null}
                {sale.status === "VOIDED" ? <span className="pos-pill" data-tone="danger">Voided</span> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
