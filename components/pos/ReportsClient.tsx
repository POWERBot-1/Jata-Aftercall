"use client";

import { useState } from "react";
import { formatKES } from "@/lib/format";
import { formatDate } from "@/lib/dateFormat";

/**
 * Reports (§35, §71).
 *
 * The list is what this business is configured for, and every number says what kind of number it
 * is: from your records, calculated, or an estimate because something is missing. A report the
 * configuration does not include is never rendered with invented zeros.
 */

export type ReportCatalogueGroup = {
  group: string;
  reports: { key: string; label: string; blurb: string; basis: string }[];
};

type ReportPayload = {
  key: string;
  label: string;
  blurb: string;
  basis: string;
  available: boolean;
  partial: boolean;
  notice: string | null;
  range: { from: string; to: string };
  summary: { label: string; value: string }[];
  rows: Record<string, string | number | null>[];
  series: { label: string; value: number }[];
};

const BASIS_LABELS: Record<string, string> = {
  recorded: "From your records",
  calculated: "Calculated",
  estimate: "Estimate",
};

export function ReportsClient({
  businessId,
  catalogue,
  canCloseDay,
  initialReport,
}: {
  businessId: string;
  catalogue: ReportCatalogueGroup[];
  canCloseDay: boolean;
  initialReport: string | null;
}) {
  const [key, setKey] = useState<string | null>(initialReport);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [closing, setClosing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<any[]>([]);
  const [capturesLoaded, setCapturesLoaded] = useState(false);
  const [capture, setCapture] = useState<any | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");

  async function loadCaptures(id?: string) {
    setBusy(true); setError(null);
    try {
      const url = `/api/pos/${encodeURIComponent(businessId)}/reports/snapshots${id ? `?id=${encodeURIComponent(id)}` : ""}`;
      const response = await fetch(url); const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Couldn't load finalized captures.");
      if (id) setCapture(data.snapshot); else { setCaptures(data.snapshots); setCapturesLoaded(true); }
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load finalized captures."); }
    finally { setBusy(false); }
  }

  async function finalizeCapture(supersedesId?: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/reports/snapshots`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, supersedesId, reason: correctionReason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Couldn't finalize the capture.");
      setCapture(data.snapshot); setCorrectionReason("");
      const list = await fetch(`/api/pos/${encodeURIComponent(businessId)}/reports/snapshots`);
      if (list.ok) { setCaptures((await list.json()).snapshots); setCapturesLoaded(true); }
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't finalize the capture."); }
    finally { setBusy(false); }
  }

  async function load(nextKey: string, nextFrom = from, nextTo = to) {
    setKey(nextKey);
    setBusy(true);
    setError(null);
    setReport(null);
    setClosing(null);
    try {
      const params = new URLSearchParams({ report: nextKey });
      if (nextFrom) params.set("from", nextFrom);
      if (nextTo) params.set("to", nextTo);
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/reports?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't build that report.");
        setBusy(false);
        return;
      }
      if (data.closing) setClosing(data.closing);
      else if (data.report) setReport(data.report);
      setBusy(false);
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  const maxSeries = Math.max(1, ...(report?.series ?? []).map((point) => point.value));

  return (
    <div className="space-y-4">
      <div className="pos-tabs">
        {catalogue.map((group) => (
          <span key={group.group} className="pos-chip">{group.group}</span>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {catalogue.flatMap((group) =>
          group.reports.map((entry) => (
            <button
              type="button"
              key={entry.key}
              className="pos-option"
              data-selected={key === entry.key}
              onClick={() => void load(entry.key)}
            >
              <strong>{entry.label}</strong>
              <small>{entry.blurb}</small>
              <small>{BASIS_LABELS[entry.basis] ?? entry.basis}</small>
            </button>
          )),
        )}
        {canCloseDay ? (
          <button type="button" className="pos-option" data-selected={key === "daily_closing"} onClick={() => void load("daily_closing")}>
            <strong>Close the day</strong>
            <small>Cash, M-Pesa, credit and expenses in one place.</small>
            <small>From your records</small>
          </button>
        ) : null}
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}

      <div className="pos-toolbar">
        <div className="pos-grid-2">
          <div className="jata-field">
            <label className="jata-label" htmlFor="report-from">From</label>
            <input id="report-from" className="jata-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="report-to">To</label>
            <input id="report-to" className="jata-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>
        {key ? (
          <button type="button" className="jata-btn jata-btn-secondary" onClick={() => void load(key)} disabled={busy}>
            {busy ? "Working…" : "Run it"}
          </button>
        ) : null}
      </div>

      <section className="jata-card p-4 space-y-3" aria-labelledby="capture-heading">
        <h3 id="capture-heading" className="text-base font-semibold">Finalized financial captures</h3>
        <p className="pos-note">Choose completed UTC dates above. A capture is made manually for the whole business; it freezes the sale cohort’s current status and the period ledger during finalization, not at the end of the period. The range starts at 00:00 UTC on the first date and ends at 00:00 UTC after the last date (exclusive). Corrections replace earlier revisions; do not add revisions or overlapping periods together.</p>
        <div className="pos-toolbar">
          <button type="button" className="jata-btn jata-btn-secondary" disabled={busy} onClick={() => void loadCaptures()}>Load finalized captures</button>
          {canCloseDay ? <button type="button" className="jata-btn jata-btn-secondary" disabled={busy || !from || !to} onClick={() => void finalizeCapture()}>Finalize selected dates</button> : null}
        </div>
        {captures.length ? <ul className="space-y-2">{captures.map((item) => (
          <li key={item.id}><button type="button" className="pos-option" disabled={busy} onClick={() => void loadCaptures(item.id)}>
            <strong>{item.periodStart.slice(0, 10)} to {item.lastDay} UTC · revision {item.revision}</strong>
            <small>Finalization started {item.finalizedAt}{item.reason ? ` · ${item.reason}` : ""}</small>
          </button></li>
        ))}</ul> : <p className="pos-note">{capturesLoaded ? "No finalized captures yet." : "Load captures to see up to the 100 most recent revisions."}</p>}
        {capture ? <div className="space-y-2">
          <h4 className="font-semibold">Finalized revision {capture.revision}</h4>
          <p className="pos-note">Business-wide period: {capture.periodStart} inclusive to {capture.periodEnd} exclusive (UTC). Finalization transaction started: {capture.finalizedAt}. Capture read time, approximate: {capture.payload.capturedAt}. Finalized by: {capture.finalizedById}.</p>
          {capture.reason ? <p className="pos-note">Correction reason: {capture.reason}. Replaces capture {capture.supersedesId}.</p> : null}
          <p className="pos-note">{capture.payload.note}</p>
          <dl className="jata-stat-grid">
            <div className="jata-stat"><dt>Cohort retained</dt><dd>{formatKES(capture.payload.saleCohort.totals.netKES)}</dd></div>
            <div className="jata-stat"><dt>Cohort refunded</dt><dd>{formatKES(capture.payload.saleCohort.totals.refundedKES)}</dd></div>
            <div className="jata-stat"><dt>Period cash in</dt><dd>{formatKES(capture.payload.periodLedger.cashInKES)}</dd></div>
            <div className="jata-stat"><dt>Period cash out</dt><dd>{formatKES(capture.payload.periodLedger.cashOutKES)}</dd></div>
          </dl>
          <details><summary>View captured reconciliation and transaction references</summary><pre className="pos-scroll text-xs">{JSON.stringify(capture.payload, null, 2)}</pre></details>
          {canCloseDay ? <div className="space-y-2">
            <label className="jata-label" htmlFor="capture-reason">Reason for correction</label>
            <input id="capture-reason" className="jata-input" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} />
            <button type="button" className="jata-btn jata-btn-secondary" disabled={busy || !correctionReason.trim() || from !== capture.periodStart.slice(0, 10) || to !== capture.lastDay} onClick={() => void finalizeCapture(capture.id)}>Create replacement revision</button>
            <p className="pos-note">Select the capture dates above and explain the correction. Only the latest revision can be replaced.</p>
          </div> : null}
        </div> : null}
      </section>

      {busy ? <p className="pos-note">Building the report…</p> : null}

      {closing ? (
        <section className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">Close the day · {closing.date}</p>
            <h3 className="text-base font-semibold">Count this against the drawer</h3>
            <p className="pos-note">Sales and payment methods reflect the current status of sales created today. The drawer amount reflects today’s settled cash movements, including refunds for earlier sales.</p>
          </div>
          <dl className="jata-stat-grid">
            {closing.summary.map((entry: { label: string; value: string }) => (
              <div className="jata-stat" key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
          {closing.rows?.length ? (
            <div className="pos-scroll">
              <table className="pos-table">
                <thead><tr><th>Method</th><th>Transactions</th><th>Amount</th></tr></thead>
                <tbody>
                  {closing.rows.map((row: any) => (
                    <tr key={row.method}>
                      <td>{row.method}</td>
                      <td>{row.transactions}</td>
                      <td>{row.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {report ? (
        <section className="jata-card p-4 space-y-3">
          <div className="pos-toolbar">
            <div>
              <p className="jata-kicker">{report.label}</p>
              <h3 className="text-base font-semibold">{report.blurb}</h3>
              <p className="pos-note">
                {formatDate(report.range.from)} — {formatDate(report.range.to)}
              </p>
            </div>
            <span className="pos-pill" data-tone={report.basis === "recorded" ? "success" : report.partial ? "warn" : "info"}>
              {report.partial ? "Estimate — something is missing" : BASIS_LABELS[report.basis] ?? report.basis}
            </span>
          </div>

          {!report.available ? (
            <div className="pos-empty">
              <strong>Not available yet</strong>
              <p>{report.notice}</p>
            </div>
          ) : (
            <>
              {report.notice ? <p className="pos-note">{report.notice}</p> : null}

              {report.summary.length ? (
                <dl className="jata-stat-grid">
                  {report.summary.map((entry) => (
                    <div className="jata-stat" key={entry.label}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {report.series.length ? (
                <div className="pos-bars">
                  {report.series.slice(0, 12).map((point) => (
                    <div className="pos-bar" key={point.label}>
                      <span>{point.label}</span>
                      <span><i style={{ width: `${Math.max(2, Math.round((point.value / maxSeries) * 100))}%` }} /></span>
                      <span>{formatKES(point.value)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {report.rows.length ? (
                <div className="pos-scroll">
                  <table className="pos-table">
                    <thead>
                      <tr>{Object.keys(report.rows[0]).map((column) => <th key={column}>{column}</th>)}</tr>
                    </thead>
                    <tbody>
                      {report.rows.slice(0, 100).map((row, index) => (
                        <tr key={index}>
                          {Object.keys(report.rows[0]).map((column) => (
                            <td key={column}>{row[column] === null || row[column] === undefined ? "—" : String(row[column])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
