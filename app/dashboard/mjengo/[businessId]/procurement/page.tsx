import { notFound } from "next/navigation";
import { loadProcurementOverview } from "@/lib/mjengo/workspace";
import { formatKES } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MjengoProcurement({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const { suppliers, purchaseOrders, requisitions, payableKES } = await loadProcurementOverview(businessId);

  return (
    <section aria-labelledby="mjengo-procurement-heading">
      <h2 id="mjengo-procurement-heading" className="text-lg font-semibold">Procurement</h2>
      <p className="text-sm text-muted-foreground">
        Requisition → purchase order → goods received → supplier bill. Receiving stock and billing are
        separate steps, so an order is never treated as stock until it is received.
      </p>
      <p className="mt-2 text-sm">Suppliers: {suppliers.length} · payable {formatKES(payableKES)}</p>

      <h3 className="mt-6 font-medium">Open purchase orders</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {purchaseOrders.map((po: any) => (
          <li key={po.id} className="flex justify-between gap-3 border-t py-1">
            <span>{po.orderNumber} — {po.supplierName}</span>
            <span className="text-muted-foreground">{po.status} · {formatKES(Number(po.totalCents) / 100)}</span>
          </li>
        ))}
        {purchaseOrders.length === 0 ? <li className="text-muted-foreground">No open purchase orders.</li> : null}
      </ul>

      <h3 className="mt-6 font-medium">Requisitions awaiting a decision</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {requisitions.map((req: any) => (
          <li key={req.id} className="flex justify-between gap-3 border-t py-1">
            <span>{req.requisitionNumber}</span>
            <span className="text-muted-foreground">{req.status} · {formatKES(Number(req.totalCents) / 100)}</span>
          </li>
        ))}
        {requisitions.length === 0 ? <li className="text-muted-foreground">No open requisitions.</li> : null}
      </ul>
    </section>
  );
}
