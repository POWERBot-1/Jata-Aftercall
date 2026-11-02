import { notFound } from "next/navigation";
import { loadReportsOverview } from "@/lib/mjengo/workspace";

export const dynamic = "force-dynamic";
const money = (v: number) => `KES ${Math.round(Number(v) || 0).toLocaleString("en-KE")}`;

export default async function MjengoReports({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const report = await loadReportsOverview(businessId);

  return (
    <section aria-labelledby="mjengo-reports-heading">
      <h2 id="mjengo-reports-heading" className="text-lg font-semibold">Reports</h2>
      <p className="text-sm text-muted-foreground">
        Summaries of records this workspace already loads — no separate reporting database and no
        derived number that the source module does not produce.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Revenue, last 30 days</dt><dd className="text-xl font-bold">{money(report.revenueKES)}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Unpaid on till sales</dt><dd className="text-xl font-bold">{money(report.outstandingKES)}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Customer receivable</dt><dd className="text-xl font-bold">{money(report.receivableKES)}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Tracked inventory items</dt><dd className="text-xl font-bold">{report.inventoryTracked}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">At or below reorder level</dt><dd className="text-xl font-bold">{report.lowStock}</dd></div>
        <div className="rounded-sm border p-4"><dt className="text-sm text-muted-foreground">Journals on record</dt><dd className="text-xl font-bold">{report.journals}</dd></div>
      </dl>
      <p className="mt-4 text-sm">
        Ledger integrity:{" "}
        {report.integrity.available
          ? report.integrity.anomalies === 0
            ? "no empty or unbalanced posted journal."
            : `${report.integrity.anomalies} anomaly/anomalies.`
          : "not available (database not migrated)."}
      </p>
    </section>
  );
}
