"use client";

import { useState } from "react";
import { formatKES } from "@/lib/format";

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

      {busy ? <p className="pos-note">Building the report…</p> : null}

      {closing ? (
        <section className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">Close the day · {closing.date}</p>
            <h3 className="text-base font-semibold">Count this against the drawer</h3>
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
                      <td>{formatKES(Number(row.amount))}</td>
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
                {new Date(report.range.from).toLocaleDateString("en-KE")} — {new Date(report.range.to).toLocaleDateString("en-KE")}
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
