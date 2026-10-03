import Link from "next/link";
import { formatKES, formatDateTime } from "@/lib/format";
import { listMovements, listSales, stockWithProducts } from "@/lib/pos/store";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";

/**
 * Produce (§18 farm and agribusiness).
 *
 * A farm's harvest log is not part of this release, and the screen says so instead of showing
 * invented numbers (§35). What it does show is real: what was sold, what went out of the store,
 * and what is still standing in the stock room — the records the business already keeps.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Produce" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosProducePage({ params }: Props) {
  const { businessId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);

  const [sales, movements, stock] = await Promise.all([
    listSales(businessId, { take: 30 }),
    listMovements(businessId, { take: 40 }),
    stockWithProducts(businessId),
  ]);

  const soldLines = (sales as any[]).flatMap((sale) =>
    (sale.items ?? []).map((item: any) => ({
      id: `${sale.id}-${item.id}`,
      name: item.name,
      quantity: Number(item.quantity ?? 0),
      unitKey: item.unitKey ?? "",
      totalKES: Number(item.totalKES ?? 0),
      when: sale.createdAt,
      receipt: sale.receiptNumber,
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="jata-kicker">Produce</p>
        <h2 className="text-xl font-bold">What went out, and what is left</h2>
        <p className="pos-note">
          Harvest records — what you gathered, from which plot and in which season — are not part of
          your POS yet. Everything below is real, from your sales and your stock room.
        </p>
      </div>

      <section className="jata-card p-4">
        <p className="jata-kicker">Sold recently</p>
        {soldLines.length === 0 ? (
          <div className="pos-empty">
            <strong>Nothing sold yet</strong>
            <p>Record a sale at the till and it appears here with its quantity and value.</p>
            <Link href={`${workspace.basePath}/sell`} className="jata-btn jata-btn-primary">
              + New {workspace.terminology.sale.toLowerCase()}
            </Link>
          </div>
        ) : (
          <div className="pos-scroll">
            <table className="pos-table">
              <thead><tr><th>When</th><th>Item</th><th>Quantity</th><th>Value</th><th>Receipt</th></tr></thead>
              <tbody>
                {soldLines.slice(0, 40).map((line) => (
                  <tr key={line.id}>
                    <td>{formatDateTime(line.when)}</td>
                    <td>{line.name}</td>
                    <td>{line.quantity} {line.unitKey}</td>
                    <td>{formatKES(line.totalKES)}</td>
                    <td>{line.receipt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="jata-card p-4">
        <p className="jata-kicker">In the store</p>
        {(stock as any[]).length === 0 ? (
          <p className="pos-note">Nothing recorded in stock yet.</p>
        ) : (
          <div className="pos-scroll">
            <table className="pos-table">
              <thead><tr><th>Item</th><th>On hand</th><th>Unit</th></tr></thead>
              <tbody>
                {(stock as any[]).slice(0, 40).map((item) => (
                  <tr key={item.id}>
                    <td>{item.product?.name ?? "Item"}</td>
                    <td>{Number(item.quantity ?? 0)}</td>
                    <td>{item.product?.unitKey ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="jata-card p-4">
        <p className="jata-kicker">Recent movements</p>
        {(movements as any[]).length === 0 ? (
          <p className="pos-note">Nothing has moved yet.</p>
        ) : (
          <div className="pos-rows">
            {(movements as any[]).slice(0, 12).map((movement) => (
              <div className="pos-row" key={movement.id}>
                <div className="pos-row-main">
                  <strong>{movement.product?.name ?? "Item"}</strong>
                  <small>{formatDateTime(movement.createdAt)}{movement.note ? ` · ${movement.note}` : ""}</small>
                </div>
                <div className="pos-row-values">
                  <span className="pos-chip">{String(movement.reason).replace(/_/g, " ").toLowerCase()}</span>
                  <strong>{Number(movement.delta) > 0 ? `+${movement.delta}` : movement.delta}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="pos-form-actions">
        <Link href={`${workspace.basePath}/reports?report=produce`} className="jata-btn jata-btn-secondary">Produce report</Link>
        <Link href={`${workspace.basePath}/inventory`} className="jata-btn jata-btn-ghost">Stock room</Link>
      </div>
    </div>
  );
}
