import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadCompliance } from "@/lib/erp/loaders";
import { Badge, Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";
import { COMPLIANCE_SOURCES, ETIMS_INVOICE_STATES, ETIMS_SOLUTIONS, TAX_RULE_REGISTRY_VERSION, etimsReadiness, sectorFor } from "@/lib/erp/compliance";
import { etimsAdapter, etimsSubmissionPosture } from "@/lib/erp/etims";
import { KENYA_TAX_OBLIGATIONS, TAX_DISCLAIMER } from "@/lib/erp/tax";

export const dynamic = "force-dynamic";

/**
 * Kenya Compliance Centre.
 *
 * This screen exists to stop a business believing something untrue. It shows what is recorded, what
 * is missing, which eTIMS route is blocked and why, and a dated source for each claim. It never
 * says "compliant", and invoice submission is switched off because there is no certified
 * connection.
 */
export default async function CompliancePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadCompliance(businessId);
  const base = workspace.basePath;
  const readiness = etimsReadiness(data.profile);
  const adapter = etimsAdapter();
  const posture = etimsSubmissionPosture();
  const sector = sectorFor(String(data.profile?.sector ?? workspace.pack.key));
  const failing = readiness.checks.filter((check) => check.status !== "PASS");

  return (
    <>
      <PageHead
        title="Kenya Compliance Centre"
        description="What is recorded, what is missing and which route is blocked. Not a certificate, and not statutory advice."
        actions={<Badge tone={readiness.invoiceSubmissionEnabled ? "good" : "warn"}>{readiness.invoiceSubmissionEnabled ? "Submission on" : "Submission off"}</Badge>}
      />

      <Notice tone="warn">
        <strong>{readiness.headline}</strong> The workspace prepares and validates records. It cannot submit invoices to KRA in this release, because no OSCU/VSCU certification or credentials are present.
      </Notice>

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Tax profile" value={data.profile?.kraPin ? "Recorded" : "Missing"} hint={data.profile?.kraPin ? "KRA PIN on file" : "Add it in Settings"} />
        <Kpi label="Readiness checks" value={`${readiness.checks.length - failing.length}/${readiness.checks.length}`} hint="Evidence-based" />
        <Kpi label="Tax rules" value={String(data.taxRules.length)} hint={`${data.taxRules.filter((rule) => rule.verified).length} independently verified`} />
        <Kpi label="Rule registry" value={TAX_RULE_REGISTRY_VERSION} hint="Reports name their version" />
      </dl>

      <section className="erp-card">
        <h2>Readiness</h2>
        <p className="erp-card-sub">Each line names its owner. A check with no evidence is a FAIL, not a maybe.</p>
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead><tr><th>Check</th><th>Owner</th><th>Status</th><th>Evidence</th><th>Next action</th></tr></thead>
            <tbody>
              {readiness.checks.map((check) => (
                <tr key={check.key}>
                  <td>
                    <div className="erp-strong">{check.label}</div>
                    <div className="erp-muted erp-small">{check.explanation}</div>
                  </td>
                  <td className="erp-small">{humanise(check.owner)}</td>
                  <td>
                    <span className={check.status === "PASS" ? "erp-pass erp-small" : check.status === "BLOCKED" ? "erp-blocked erp-small" : "erp-fail erp-small"}>{check.status}</span>
                  </td>
                  <td className="erp-small">{check.evidence}</td>
                  <td className="erp-small">{check.action ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="erp-actions" style={{ marginTop: 12 }}>
          <Link href={`${base}/settings#business`} className="erp-btn erp-btn-sm erp-btn-primary">Update tax profile</Link>
          <Link href={`${base}/invoices`} className="erp-btn erp-btn-sm erp-btn-secondary">Review invoices</Link>
        </div>
      </section>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Tax rules in force</h2>
          <p className="erp-card-sub">Effective-dated so history cannot change when a rate changes.</p>
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead><tr><th>Rule</th><th className="num">Rate</th><th>From</th><th>Verified</th></tr></thead>
              <tbody>
                {data.taxRules.map((rule: any) => (
                  <tr key={`${rule.key}-${rule.effectiveFrom}`}>
                    <td><div className="erp-strong">{rule.label}</div><div className="erp-mono erp-small">{rule.key}</div></td>
                    <td className="num">{(Number(rule.rateBps) / 100).toFixed(2)}%</td>
                    <td className="erp-small">{String(rule.effectiveFrom).slice(0, 10)}</td>
                    <td>{rule.verified ? <Badge tone="good">Verified</Badge> : <Badge tone="warn">Reference</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="erp-hint">Reference rates are defaults for this environment. Confirm them with your accountant and the current KRA guidance before relying on a return.</p>
        </div>

        <div className="erp-card">
          <h2>Invoice submission states</h2>
          <p className="erp-card-sub">“Accepted” has a narrow meaning here.</p>
          <ul className="erp-list">
            {ETIMS_INVOICE_STATES.map((state) => (
              <li key={state.key}>
                <span className="erp-small erp-strong">{state.label}</span>
                <span className="erp-muted erp-small" style={{ maxWidth: "34ch", textAlign: "right" }}>{state.meaning}</span>
              </li>
            ))}
          </ul>
          <p className="erp-hint">
            Currently: {data.counts.awaitingSubmission} awaiting submission · {data.counts.accepted} accepted · {data.counts.rejected} rejected · {data.counts.uncertain} uncertain. These counts come from your invoice records.
          </p>
        </div>
      </section>

      <section className="erp-card">
        <h2>Submission connection</h2>
        <p className="erp-card-sub">What this deployment can actually do with KRA today, stated before anything else on this page.</p>
        <div className="erp-grid erp-grid-3">
          <div>
            <div className="erp-muted erp-small">Adapter</div>
            <div className="erp-strong">{adapter.label}</div>
          </div>
          <div>
            <div className="erp-muted erp-small">Switch</div>
            <div className="erp-strong">{posture.enabled ? "On" : "Off"}</div>
          </div>
          <div>
            <div className="erp-muted erp-small">Can submit an invoice</div>
            <div className={posture.canSubmit ? "erp-pass" : "erp-blocked"}>{posture.canSubmit ? "Yes" : "No"}</div>
          </div>
        </div>
        <Notice tone="warn">{posture.headline}</Notice>
        <ul className="erp-list">
          {posture.requires.map((requirement) => (
            <li key={requirement}><span className="erp-small">{requirement}</span></li>
          ))}
        </ul>
        <p className="erp-hint">
          Invoices can be prepared, validated and queued. An invoice is only ever labelled accepted when KRA returns the control number — a timeout leaves it uncertain and it is reconciled before any resubmission, so a fiscal document is never duplicated.
        </p>
      </section>

      <section className="erp-card">
        <h2>eTIMS routes</h2>
        <p className="erp-card-sub">The right route depends on your VAT status, turnover and whether you already have an invoicing system.</p>
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead><tr><th>Route</th><th>Who it is for</th><th>Status here</th><th>Blocker</th></tr></thead>
            <tbody>
              {ETIMS_SOLUTIONS.map((solution) => (
                <tr key={solution.key}>
                  <td>
                    <div className="erp-strong">{solution.label}</div>
                    <div className="erp-muted erp-small">{solution.description}</div>
                  </td>
                  <td className="erp-small">{solution.eligibility}</td>
                  <td><span className={solution.status === "PASS" ? "erp-pass erp-small" : solution.status === "BLOCKED" ? "erp-blocked erp-small" : "erp-small"}>{solution.status}</span></td>
                  <td className="erp-small">{solution.blocker ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="erp-hint">KRA allows self-onboarding and more than one solution at once. Selecting a route here is a note for your records, not a registration.</p>
      </section>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Your sector: {sector.label}</h2>
          <p className="erp-card-sub">Status: {sector.status}. Nothing here is claimed as verified for release.</p>
          <ul className="erp-list">
            <li><span>Licences to check</span><span className="erp-small" style={{ maxWidth: "36ch", textAlign: "right" }}>{sector.licences.join(" · ") || "—"}</span></li>
            <li><span>Tax notes</span><span className="erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>{sector.taxNotes}</span></li>
            <li><span>eTIMS</span><span className="erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>{sector.etims}</span></li>
            <li><span>Data protection</span><span className="erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>{sector.privacy}</span></li>
            <li><span>Not supported</span><span className="erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>{sector.unsupported.join(" · ")}</span></li>
          </ul>
        </div>

        <div className="erp-card">
          <h2>Obligations to diarise</h2>
          <ul className="erp-list">
            {KENYA_TAX_OBLIGATIONS.map((obligation: any) => (
              <li key={obligation.key}>
                <div>
                  <div className="erp-strong">{obligation.label}</div>
                  <div className="erp-muted erp-small">{obligation.when}</div>
                </div>
                <span className="erp-small" style={{ maxWidth: "26ch", textAlign: "right" }}>{obligation.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="erp-card">
        <h2>Sources</h2>
        <p className="erp-card-sub">Dated so a reader can tell when this was last checked.</p>
        <ul className="erp-list">
          {COMPLIANCE_SOURCES.map((source) => (
            <li key={source.id}>
              <div>
                <a href={source.url} target="_blank" rel="noreferrer" className="erp-strong erp-small">{source.title}</a>
                <div className="erp-muted erp-small">{source.publisher} · used for: {source.usedFor}</div>
              </div>
              <span className="erp-muted erp-small">{source.retrievedOn}</span>
            </li>
          ))}
        </ul>
        <p className="erp-hint">{TAX_DISCLAIMER}</p>
      </section>
    </>
  );
}
