import { notFound } from "next/navigation";
import { loadSalesOverview } from "@/lib/mjengo/workspace";

export const dynamic = "force-dynamic";
const money = (v: number) => `KES ${Math.round(Number(v) || 0).toLocaleString("en-KE")}`;

export default async function MjengoSales({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const { sales, orders, revenueKES, outstandingKES } = await loadSalesOverview(businessId);

  return (
    <section aria-labelledby="mjengo-sales-heading">
      <h2 id="mjengo-sales-heading" className="text-lg font-semibold">Sales &amp; orders</h2>
      <p className="text-sm text-muted-foreground">
        Till sales come from the POS engine (immutable once completed — a correction is a refund or a
        reversal). Storefront orders come from the Order module. Prices shown are stored amounts, not
        recomputed here.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Revenue, last 30 days</dt><dd className="text-xl font-bold">{money(revenueKES)}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Unpaid balance</dt><dd className="text-xl font-bold">{money(outstandingKES)}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Storefront orders</dt><dd className="text-xl font-bold">{orders.length}</dd></div>
      </dl>

      <table className="mt-6 w-full text-sm">
        <caption className="sr-only">Recent till sales</caption>
        <thead><tr className="text-left text-muted-foreground"><th scope="col">Receipt</th><th scope="col">Total</th><th scope="col">Paid</th><th scope="col">Balance</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {sales.map((sale: any) => (
            <tr key={sale.id} className="border-t">
              <td className="py-1">{sale.receiptNumber}</td>
              <td>{money(sale.totalKES)}</td>
              <td>{money(sale.paidKES)}</td>
              <td>{money(sale.balanceKES)}</td>
              <td>{sale.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sales.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No till sales in the last 30 days.</p> : null}

      <h3 className="mt-8 font-medium">Storefront orders</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {orders.map((order: any) => (
          <li key={order.id} className="flex justify-between gap-3 border-t py-1">
            <span>{order.orderReference}</span>
            <span className="text-muted-foreground">{money(order.totalKES)} · {order.status}</span>
          </li>
        ))}
        {orders.length === 0 ? <li className="text-muted-foreground">No storefront orders.</li> : null}
      </ul>
    </section>
  );
}
