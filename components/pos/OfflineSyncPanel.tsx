"use client";

/**
 * Offline-first POS — sync status and recovery panel (§6, §38).
 *
 * Shows the till operator exactly what the device knows about its offline sales: the queue count,
 * connectivity, a live sync status, and a recovery list for anything that failed or is still waiting.
 * It is deliberately plain-language: "Saved on this device, will sync when connected" rather than
 * configuration or queue terminology. The panel never claims a sale was paid unless the server
 * confirmed it — the recovery list distinguishes synced, waiting, failed and needing-attention.
 */

import { useOfflineSync } from "@/lib/pos/offline/useOfflineSync";
import type { OfflineSaleRecord } from "@/lib/pos/offline/types";
import { formatDateTime } from "@/lib/dateFormat";
import { OfflineBadge } from "@/components/ui/StateBlocks";

function statusLabel(record: OfflineSaleRecord): { text: string; tone: string } {
  switch (record.status) {
    case "synced":
      return { text: record.syncedReceiptNumber ? `Synced · ${record.syncedReceiptNumber}` : "Synced", tone: "var(--jata-live)" };
    case "syncing":
      return { text: "Syncing…", tone: "var(--color-muted, var(--jata-line))" };
    case "failed":
      return { text: "Needs attention", tone: "var(--jata-danger)" };
    case "conflict":
      return { text: "Conflict — review", tone: "var(--jata-warning)" };
    default:
      return { text: "Waiting to sync", tone: "var(--color-muted, var(--jata-line))" };
  }
}

export function OfflineSyncPanel({ businessId }: { businessId: string }) {
  const { records, online, busy, lastSummary, error, syncNow, retryFailed, dismiss } = useOfflineSync(businessId);

  const pending = records.filter((row) => row.status !== "synced");
  const synced = records.filter((row) => row.status === "synced");
  const needsAttention = records.filter((row) => row.status === "failed" || row.status === "conflict");

  return (
    <section className="jata-card p-5" data-pos-offline="panel" aria-label="Offline sales status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="jata-kicker">Offline sales</p>
          <h3 className="text-base font-bold">
            {online ? "Connected" : "You are offline"}
          </h3>
          <p className="pos-note mt-0.5">
            {records.length === 0
              ? "Sales made without a connection will appear here."
              : `${pending.length} waiting, ${synced.length} synced.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={!online || busy || pending.length === 0}
            className="jata-btn jata-btn-secondary"
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
          {needsAttention.length > 0 ? (
            <button type="button" onClick={() => void retryFailed()} className="jata-btn jata-btn-ghost">
              Retry {needsAttention.length}
            </button>
          ) : null}
        </div>
      </div>

      {!online ? <OfflineBadge>Sales are being saved on this device and will sync when you reconnect.</OfflineBadge> : null}

      {error ? (
        <p className="pos-note mt-2" role="alert">
          {error}
        </p>
      ) : null}

      {lastSummary ? (
        <p className="pos-note mt-2">
          Last sync: {lastSummary.synced} synced, {lastSummary.duplicate} already recorded, {lastSummary.rejected} needing
          attention.
        </p>
      ) : null}

      {records.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-[var(--jata-line)] pt-3">
          {records.slice(0, 8).map((record) => {
            const { text, tone } = statusLabel(record);
            return (
              <li key={record.offlineId} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {record.paymentKind === "pending" ? "Unconfirmed payment · " : ""}
                    recorded {formatDateTime(record.recordedAt)}
                  </p>
                  <p className="pos-note">
                    {record.request.items.length} item(s) ·{" "}
                    {record.request.items.reduce((sum, item) => sum + (Number(item.quantity ?? 0)), 0)} units
                    {record.lastError ? ` · ${record.lastError}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="jata-status" style={{ color: tone }}>{text}</span>
                  {record.status === "synced" ? (
                    <button
                      type="button"
                      onClick={() => void dismiss(record.offlineId)}
                      className="jata-btn jata-btn-ghost"
                      aria-label="Dismiss this synced sale from the device"
                    >
                      Dismiss
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {records.length > 8 ? (
        <p className="pos-note mt-2">Showing 8 of {records.length} records.</p>
      ) : null}
    </section>
  );
}
