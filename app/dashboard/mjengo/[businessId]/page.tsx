/**
 * MJENGO OS — overview.
 *
 * Real tenant-scoped reads only. Counts come from the module that owns the data; anything this
 * deployment cannot read reports "unavailable" rather than a fabricated number.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { mjengoPath } from "@/lib/mjengo/navigation";
import {
  loadAccountingOverview,
  loadCustomerCreditOverview,
  loadInventoryOverview,
  loadProcurementOverview,
  loadSalesOverview,
} from "@/lib/mjengo/workspace";

import { formatKES } from "@/lib/format";

export const dynamic = "force-dynamic";


export default async function MjengoOverview({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();

  const [sales, inventory, procurement, credit, accounting] = await Promise.all([
    loadSalesOverview(businessId),
    loadInventoryOverview(businessId),
    loadProcurementOverview(businessId),
    loadCustomerCreditOverview(businessId),
    loadAccountingOverview(businessId),
  ]);

  const cards = [
    { label: "Sales, last 30 days", value: formatKES(sales.revenueKES), note: `${sales.sales.length} till sale(s)`, href: mjengoPath(businessId, "/sales") },
    { label: "Unpaid on till sales", value: formatKES(sales.outstandingKES), note: "Balance still owed", href: mjengoPath(businessId, "/sales") },
    { label: "Stock items", value: String(inventory.stock.length), note: `${inventory.low.length} at or below reorder level`, href: mjengoPath(businessId, "/inventory") },
    { label: "Suppliers", value: String(procurement.suppliers.length), note: `Payable ${formatKES(procurement.payableKES)}`, href: mjengoPath(businessId, "/procurement") },
    { label: "Open purchase orders", value: String(procurement.purchaseOrders.length), note: `${procurement.requisitions.length} requisition(s) awaiting a decision`, href: mjengoPath(businessId, "/procurement") },
    { label: "Customer credit", value: formatKES(credit.receivableKES), note: `${credit.overdueInvoices.length} overdue invoice(s)`, href: mjengoPath(businessId, "/customers") },
    { label: "Journals on record", value: String(accounting.journals.length), note: accounting.integrity.available ? `${accounting.integrity.anomalies} integrity anomaly/anomalies` : "Integrity view not available (database not migrated)", href: mjengoPath(businessId, "/accounting") },
    { label: "Reports", value: "Open", note: "Operational + financial summaries", href: mjengoPath(businessId, "/reports") },
  ];

  return (
    <>
      <section aria-labelledby="mjengo-overview-heading">
        <h2 id="mjengo-overview-heading" className="text-lg font-semibold">
          Today, at a glance
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Link key={card.label} href={card.href} className="rounded-sm border p-4 hover:bg-muted">
              <div className="text-sm text-muted-foreground">{card.label}</div>
              <div className="mt-1 text-2xl font-bold">{card.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{card.note}</div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="mjengo-recent-heading">
        <h2 id="mjengo-recent-heading" className="text-lg font-semibold">
          Latest activity
        </h2>
        {sales.sales.length === 0 && accounting.journals.length === 0 ? (
          <p className="mt-2 rounded-sm border bg-muted/30 p-4 text-sm text-muted-foreground">
            Nothing recorded yet in this business. Sales, stock movements and journal entries appear
            here as soon as they are recorded through the POS or the accounting module — this page
            never invents activity.
          </p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div className="rounded-sm border p-4">
              <h3 className="font-medium">Recent till sales</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {sales.sales.slice(0, 5).map((sale: any) => (
                  <li key={sale.id} className="flex justify-between gap-3">
                    <span>{sale.receiptNumber}</span>
                    <span className="text-muted-foreground">
                      {formatKES(sale.totalKES)} · {sale.status}
                    </span>
                  </li>
                ))}
                {sales.sales.length === 0 ? <li className="text-muted-foreground">No till sales in the last 30 days.</li> : null}
              </ul>
            </div>
            <div className="rounded-sm border p-4">
              <h3 className="font-medium">Recent journals</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {accounting.journals.slice(0, 5).map((journal: any) => (
                  <li key={journal.id} className="flex justify-between gap-3">
                    <span>
                      {journal.journalNumber} — {journal.description}
                    </span>
                    <span className="text-muted-foreground">{journal.status}</span>
                  </li>
                ))}
                {accounting.journals.length === 0 ? <li className="text-muted-foreground">No journals recorded yet.</li> : null}
              </ul>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
