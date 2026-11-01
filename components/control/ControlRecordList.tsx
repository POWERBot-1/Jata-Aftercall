"use client";

import type { RecordKind, RecordList } from "./control-record-types";

const LABELS: Record<RecordKind, string> = {
  subscriptions: "Subscription records",
  payments: "Payment status records",
  agents: "Agent application records",
  commissions: "Immutable ledger record metadata",
};

const COLUMNS: Record<RecordKind, Array<{ key: string; label: string }>> = {
  subscriptions: [
    { key: "id", label: "Subscription reference" }, { key: "businessId", label: "Business ID" },
    { key: "plan", label: "Plan key" }, { key: "status", label: "Status" },
    { key: "startAt", label: "Start" }, { key: "expiresAt", label: "Expires" }, { key: "createdAt", label: "Created" },
  ],
  payments: [
    { key: "id", label: "Payment record ID" }, { key: "businessId", label: "Business ID" },
    { key: "status", label: "Status" }, { key: "purpose", label: "Purpose" }, { key: "createdAt", label: "Created" },
  ],
  agents: [
    { key: "id", label: "Application reference" }, { key: "status", label: "Application status" },
    { key: "agentStatus", label: "Agent status" }, { key: "createdAt", label: "Submitted" }, { key: "updatedAt", label: "Last updated" },
  ],
  commissions: [
    { key: "id", label: "Ledger entry reference" }, { key: "entryType", label: "Stored entry type" }, { key: "createdAt", label: "Recorded" },
  ],
};

export function ControlRecordList({ kind, list, onLoadMore }: { kind: RecordKind; list: RecordList; onLoadMore: (kind: RecordKind) => void }) {
  const columns = COLUMNS[kind];
  return (
    <div className="mt-4">
      <h3 className="font-semibold">{LABELS[kind]}</h3>
      {list.error ? <p role="alert" className="mt-2 text-sm text-red-700">{list.error}</p> : null}
      {list.loading && !list.items.length ? <p className="ws-muted mt-2" role="status">Loading authoritative records…</p> : null}
      {!list.loading && !list.error && !list.items.length ? <p className="ws-muted mt-2">No records are available in this permission scope.</p> : null}
      {list.items.length ? <div className="mt-2 max-w-full overflow-x-auto rounded-lg border border-[color:var(--ws-border)]">
        <table className="min-w-full border-collapse text-left text-sm">
          <caption className="sr-only">{LABELS[kind]} — fields are limited to the currently available permission scope</caption>
          <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap border-b px-3 py-2 font-semibold">{column.label}</th>)}</tr></thead>
          <tbody>{list.items.map((row, index) => <tr key={`${row.id}-${index}`} className="border-b last:border-b-0">
            {columns.map((column) => <td key={column.key} className="max-w-64 break-words px-3 py-2 align-top">{cellText(row, column.key)}</td>)}
          </tr>)}</tbody>
        </table>
      </div> : null}
      {list.nextCursor ? <button type="button" className="ws-btn-outline ws-btn-outline--ink mt-3" disabled={list.loading} onClick={() => onLoadMore(kind)}>{list.loading ? "Loading…" : "Load next record page"}</button> : null}
    </div>
  );
}

function cellText(row: any, key: string) {
  if (key === "plan") return row.plan?.key || "Unavailable";
  if (["startAt", "expiresAt", "createdAt", "updatedAt"].includes(key)) return row[key] ? formatTimestamp(row[key]) : "—";
  return typeof row[key] === "string" ? row[key] : "—";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(date);
}
