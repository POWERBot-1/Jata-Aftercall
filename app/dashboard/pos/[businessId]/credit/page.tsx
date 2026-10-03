import Link from "next/link";
import { formatKES } from "@/lib/format";
import { ageingBucket, creditExposure, daysOverdue, supplierSummary } from "@/lib/pos/credit";
import { partiesWithBalances } from "@/lib/pos/store";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { PosRefusal } from "@/components/pos/PosRefusal";

/**
 * Credit (§30).
 *
 * Two ledgers, deliberately never merged: what customers owe the business and what the business
 * owes its suppliers. Ageing is calculated from the oldest open entry and the configured terms,
 * and a figure that depends on missing data is labelled rather than presented as fact (§35).
 *
 * Credit balances are somebody else's money, so the page asks for the same permission its data
 * requires — `VIEW_CREDIT` — before it reads anything (§11, §36). A role without it gets the
 * refusal, not the ledger.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Credit" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosCreditPage({ params }: Props) {
  const { businessId } = await params;
  const gate = await loadPosPageWorkspace(businessId, "VIEW_CREDIT");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;
  const configuration = workspace.configuration;

  const [debtors, creditors] = await Promise.all([
    configuration.credit.enabled ? partiesWithBalances(businessId, "CUSTOMER") : Promise.resolve([]),
    configuration.suppliers.credit ? partiesWithBalances(businessId, "SUPPLIER") : Promise.resolve([]),
  ]);

  const owing = (debtors as any[])
    .filter((party) => Number(party.balanceKES ?? 0) > 0)
    .sort((a, b) => new Date(a.oldestEntryAt ?? Date.now()).getTime() - new Date(b.oldestEntryAt ?? Date.now()).getTime());

  const exposure = creditExposure(
    (debtors as any[]).map((party) => ({ balanceKES: Number(party.balanceKES ?? 0), limitKES: Number(party.creditLimitKES ?? 0) })),
  );
  const payables = supplierSummary(configuration, creditors as any[]);

  const buckets = ["CURRENT", "1-30", "31-60", "61-90", "90+"] as const;
  const byBucket = buckets.map((bucket) => ({
    bucket,
    amountKES: owing
      .filter((party) => ageingBucket(daysOverdue(party.oldestEntryAt, configuration.credit.termsDays)) === bucket)
      .reduce((total, party) => total + Number(party.balanceKES ?? 0), 0),
  }));

  return (
    <div className="space-y-4">
      <div>
        <p className="jata-kicker">Credit</p>
        <h2 className="text-xl font-bold">Who owes what</h2>
        <p className="pos-note">
          {configuration.credit.enabled
            ? `Terms are ${configuration.credit.termsDays} days${configuration.credit.staffCanApprove ? "" : ", and only a manager can approve credit"}.`
            : "Credit is switched off for this business."}
        </p>
      </div>

      {configuration.credit.enabled ? (
        <>
          <dl className="jata-stat-grid">
            <div className="jata-stat"><dt>Owed to you</dt><dd>{formatKES(exposure.totalKES)}</dd></div>
            <div className="jata-stat"><dt>Accounts</dt><dd>{owing.length}</dd></div>
            <div className="jata-stat"><dt>Over their limit</dt><dd>{exposure.overLimit}</dd></div>
            <div className="jata-stat"><dt>Over 90 days</dt><dd>{formatKES(byBucket.find((entry) => entry.bucket === "90+")?.amountKES ?? 0)}</dd></div>
          </dl>

          <section className="jata-card p-4">
            <p className="jata-kicker">How old is it?</p>
            <div className="pos-bars mt-2">
              {byBucket.map((entry) => {
                const max = Math.max(1, ...byBucket.map((row) => row.amountKES));
                return (
                  <div className="pos-bar" key={entry.bucket}>
                    <span>{entry.bucket === "CURRENT" ? "Not due yet" : `${entry.bucket} days`}</span>
                    <span><i style={{ width: `${Math.max(2, Math.round((entry.amountKES / max) * 100))}%` }} /></span>
                    <span>{formatKES(entry.amountKES)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <p className="jata-kicker">{workspace.terminology.customers} with a balance</p>
            {owing.length === 0 ? (
              <div className="pos-empty">
                <strong>Nobody owes you anything</strong>
                <p>When a {workspace.terminology.customer.toLowerCase()} buys on credit, they appear here oldest first.</p>
                <Link href={`${workspace.basePath}/sell`} className="jata-btn jata-btn-primary">Record a {workspace.terminology.sale.toLowerCase()}</Link>
              </div>
            ) : (
              <div className="pos-rows">
                {owing.map((party) => {
                  const days = daysOverdue(party.oldestEntryAt, configuration.credit.termsDays);
                  const bucket = ageingBucket(days);
                  return (
                    <Link className="pos-row" key={party.id} href={`${workspace.basePath}/customers/${party.id}`}>
                      <div className="pos-row-main">
                        <strong>{party.name}</strong>
                        <small>
                          {party.phone ?? "No phone"}
                          {party.oldestEntryAt ? ` · oldest ${new Date(party.oldestEntryAt).toLocaleDateString("en-KE")}` : ""}
                          {party.creditLimitKES ? ` · limit ${formatKES(Number(party.creditLimitKES))}` : ""}
                        </small>
                      </div>
                      <div className="pos-row-values">
                        <span>{formatKES(Number(party.balanceKES))}</span>
                        <span className="pos-pill" data-tone={bucket === "CURRENT" ? "success" : bucket === "90+" ? "danger" : "warn"}>
                          {bucket === "CURRENT" ? "Not due yet" : `${days} days`}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="pos-empty">
          <strong>Credit is off</strong>
          <p>Turn it on in your setup if you let {workspace.terminology.customers.toLowerCase()} pay later.</p>
          <Link href={`${workspace.basePath}/configure`} className="jata-btn jata-btn-primary">Change my setup</Link>
        </div>
      )}

      {configuration.suppliers.credit ? (
        <section className="jata-card p-4">
          <div>
            <p className="jata-kicker">Kept separate on purpose</p>
            <h3 className="text-base font-semibold">What you owe your {workspace.terminology.suppliers.toLowerCase()}</h3>
            <p className="pos-note">
              {payables.count} {payables.count === 1 ? "account" : "accounts"} · {formatKES(payables.totalOwedKES)} outstanding
              {payables.oldest ? ` · oldest ${payables.oldest.name} at ${formatKES(payables.oldest.balanceKES)}` : ""}
            </p>
          </div>
          <Link href={`${workspace.basePath}/suppliers`} className="jata-btn jata-btn-secondary mt-3">Open {workspace.terminology.suppliers.toLowerCase()}</Link>
        </section>
      ) : null}
    </div>
  );
}
