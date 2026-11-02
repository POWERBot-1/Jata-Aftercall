import { notFound } from "next/navigation";
import { loadAccountingOverview } from "@/lib/mjengo/workspace";

export const dynamic = "force-dynamic";

export default async function MjengoAccounting({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const { journals, periods, integrity } = await loadAccountingOverview(businessId);

  return (
    <section aria-labelledby="mjengo-accounting-heading">
      <h2 id="mjengo-accounting-heading" className="text-lg font-semibold">Accounting &amp; reconciliation</h2>
      <p className="text-sm text-muted-foreground">
        A journal is created DRAFT, its lines are written, and only then is it sealed POSTED — so the
        ledger is never readable half-written. Once POSTED, lines and header fields are immutable in
        the database; a correction is a mirrored reversal journal that points at the original.
      </p>

      <div className="mt-4 rounded-sm border p-4">
        <h3 className="font-medium">Ledger integrity</h3>
        {integrity.available ? (
          <p className={`mt-1 text-sm ${integrity.anomalies === 0 ? "text-green-700" : "text-red-600"}`}>
            {integrity.anomalies === 0
              ? "No empty or unbalanced posted journal found for this business."
              : `${integrity.anomalies} posted journal(s) are empty or unbalanced. Investigate before closing the period.`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-700">
            Integrity view unavailable — the ledger-immutability migration has not been applied to this
            database, so no integrity claim is made here.
          </p>
        )}
      </div>

      <h3 className="mt-6 font-medium">Journals</h3>
      <table className="mt-2 w-full text-sm">
        <caption className="sr-only">Recent journals</caption>
        <thead><tr className="text-left text-muted-foreground"><th scope="col">Number</th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Source</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {journals.map((journal: any) => (
            <tr key={journal.id} className="border-t">
              <td className="py-1">{journal.journalNumber}</td>
              <td>{new Date(journal.entryDate).toISOString().slice(0, 10)}</td>
              <td>{journal.description}</td>
              <td>{journal.sourceType}</td>
              <td>{journal.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {journals.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No journals recorded yet.</p> : null}

      <h3 className="mt-6 font-medium">Periods</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {periods.map((period: any) => (
          <li key={period.id} className="flex justify-between gap-3 border-t py-1">
            <span>{period.fiscalYear}-{String(period.month).padStart(2, "0")}</span>
            <span className="text-muted-foreground">{period.status}</span>
          </li>
        ))}
        {periods.length === 0 ? <li className="text-muted-foreground">No accounting periods opened.</li> : null}
      </ul>
    </section>
  );
}
