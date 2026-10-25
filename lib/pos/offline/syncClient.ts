/**
 * Offline-first POS — client synchronization (§6, §25).
 *
 * Two jobs:
 *   1. `submitSaleOfflineFirst` — record a sale now, on the device, whether or not the network
 *      is up. When online it posts through the normal till path; when the request cannot reach
 *      the server it falls back to the durable queue instead of failing the sale.
 *   2. `flushOfflineQueue` — when connectivity returns, replay queued sales to the server in one
 *      batch. Each record carries a stable idempotency key, so a replay after a crash, a second
 *      tap or a second device cannot create a duplicate sale. Progress is reported per record and
 *      mirrored back into the local queue so the recovery interface always shows truth.
 *
 * The client never decides whether money was received: `paymentKind` is captured at the counter
 * (`cash` = handed over, `pending` = unconfirmed method). The server strips unconfirmed payment
 * lines on sync, so an offline M-Pesa sale lands PARTIALLY_PAID, never COMPLETED.
 *
 * Everything is injected (fetcher, backend) so the whole flow is testable without a browser.
 */

import type { OfflineQueueBackend } from "./queueStore";
import {
  createOfflineSaleRecord,
  enqueueOfflineSale,
  getDefaultBackend,
  listOfflineSales,
  updateOfflineSale,
} from "./queueStore";
import type { OfflineSaleRecord, OfflineSyncResult, OfflineSyncSummary } from "./types";

export type OfflineSubmitResult = {
  offline: boolean;
  offlineId?: string;
  recordedAt?: string;
  ok?: boolean;
  saleId?: string;
  receiptNumber?: string;
  error?: string;
};

export type FlushOptions = {
  fetcher?: typeof fetch;
  backend?: OfflineQueueBackend;
  /** Abort the in-flight batch (e.g. on logout). */
  signal?: AbortSignal;
  onProgress?: (summary: OfflineSyncSummary) => void;
};

function online(): boolean {
  const nav = (globalThis as any).navigator;
  return typeof nav === "undefined" ? true : nav.onLine !== false;
}

function syncUrl(businessId: string): string {
  return `/api/pos/${encodeURIComponent(businessId)}/sync`;
}

function salesUrl(businessId: string): string {
  return `/api/pos/${encodeURIComponent(businessId)}/sales`;
}

/**
 * Record a sale, falling back to the offline queue when the network is down or the request
 * fails to reach the server. Business-rule refusals (e.g. stock short) are NOT enqueued — only
 * transport failures are, because a refusal will still be true when the network returns.
 */
export async function submitSaleOfflineFirst(
  businessId: string,
  input: {
    request: OfflineSaleRecord["request"];
    branchId: string | null;
    paymentKind: OfflineSaleRecord["paymentKind"];
    paymentReference?: string | null;
    fetcher?: typeof fetch;
    backend?: OfflineQueueBackend;
  },
): Promise<OfflineSubmitResult> {
  const fetcher = input.fetcher ?? (globalThis as any).fetch;
  const backend = input.backend ?? getDefaultBackend();

  if (!online() || !fetcher) {
    const record = createOfflineSaleRecord({
      request: input.request,
      branchId: input.branchId,
      paymentKind: input.paymentKind,
      paymentReference: input.paymentReference ?? null,
    });
    await enqueueOfflineSale(record);
    return { offline: true, offlineId: record.offlineId, recordedAt: record.recordedAt };
  }

  try {
    const response = await fetcher(salesUrl(businessId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input.request),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.ok === false) {
      // A server refusal is authoritative; do not queue it for later.
      return {
        offline: false,
        ok: false,
        error: typeof data.error === "string" ? data.error : "We couldn't record that sale.",
      };
    }
    const sale = data.sale as { id?: string; receiptNumber?: string } | undefined;
    return {
      offline: false,
      ok: true,
      saleId: sale?.id ?? undefined,
      receiptNumber: sale?.receiptNumber ?? undefined,
    };
  } catch {
    // Transport failure while nominally online: the sale happened at the counter, so queue it.
    const record = createOfflineSaleRecord({
      request: input.request,
      branchId: input.branchId,
      paymentKind: input.paymentKind,
      paymentReference: input.paymentReference ?? null,
    });
    await enqueueOfflineSale(record);
    return { offline: true, offlineId: record.offlineId, recordedAt: record.recordedAt };
  }
}

function emptySummary(): OfflineSyncSummary {
  return { total: 0, synced: 0, duplicate: 0, conflict: 0, rejected: 0 };
}

/**
 * Replay every queued or failed offline sale to the server in one batch, updating the local queue
 * to match the authoritative result. Returns the summary and leaves each record in its true state
 * (synced, conflict or failed) so the recovery interface can retry just the failures.
 */
export async function flushOfflineQueue(
  businessId: string,
  options: FlushOptions = {},
): Promise<OfflineSyncSummary> {
  const fetcher = options.fetcher ?? (globalThis as any).fetch;
  const backend = options.backend ?? getDefaultBackend();
  const summary = emptySummary();

  const pending = (await listOfflineSales()).filter(
    (row) => row.status === "queued" || row.status === "failed",
  );
  summary.total = pending.length;
  if (pending.length === 0) {
    options.onProgress?.(summary);
    return summary;
  }

  // Mark the batch in-flight before the request so an interrupted flush is visibly "syncing".
  for (const row of pending) await updateOfflineSale(row.offlineId, { status: "syncing", attempts: row.attempts + 1 });

  if (!fetcher) {
    for (const row of pending) await updateOfflineSale(row.offlineId, { status: "failed", lastError: "No network fetch available." });
    summary.rejected = pending.length;
    options.onProgress?.(summary);
    return summary;
  }

  let results: OfflineSyncResult[] = [];
  try {
    const response = await fetcher(syncUrl(businessId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      signal: options.signal,
      body: JSON.stringify({ records: pending }),
    });
    const data = (await response.json().catch(() => ({}))) as { results?: OfflineSyncResult[] };
    results = Array.isArray(data.results) ? data.results : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    for (const row of pending) await updateOfflineSale(row.offlineId, { status: "failed", lastError: message });
    summary.rejected = pending.length;
    options.onProgress?.(summary);
    return summary;
  }

  for (const row of pending) {
    const result = results.find((entry) => entry.offlineId === row.offlineId);
    if (!result) {
      await updateOfflineSale(row.offlineId, { status: "failed", lastError: "No result returned for this sale." });
      summary.rejected += 1;
      continue;
    }
    if (result.status === "synced") {
      await updateOfflineSale(row.offlineId, {
        status: "synced",
        syncedAt: new Date().toISOString(),
        syncedSaleId: result.saleId ?? null,
        syncedReceiptNumber: result.receiptNumber ?? null,
        lastError: result.unconfirmedPayment ? "Recorded; payment unconfirmed." : null,
      });
      summary.synced += 1;
    } else if (result.status === "duplicate") {
      // Another device or an earlier retry already recorded it. Treat as resolved.
      await updateOfflineSale(row.offlineId, {
        status: "synced",
        syncedAt: new Date().toISOString(),
        syncedSaleId: result.saleId ?? null,
        syncedReceiptNumber: result.receiptNumber ?? null,
      });
      summary.duplicate += 1;
    } else if (result.status === "conflict") {
      await updateOfflineSale(row.offlineId, { status: "conflict", lastError: result.error ?? "Conflict" });
      summary.conflict += 1;
    } else {
      await updateOfflineSale(row.offlineId, { status: "failed", lastError: result.error ?? "Rejected" });
      summary.rejected += 1;
    }
  }

  options.onProgress?.(summary);
  return summary;
}

/** Reconcile the local queue against the server's record of consumed offline keys. */
export async function fetchSyncedOfflineIds(
  businessId: string,
  options: { fetcher?: typeof fetch } = {},
): Promise<string[]> {
  const fetcher = options.fetcher ?? (globalThis as any).fetch;
  if (!fetcher) return [];
  try {
    const response = await fetcher(syncUrl(businessId), {
      method: "GET",
      credentials: "same-origin",
    });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => ({}))) as { syncedOfflineIds?: string[] };
    return Array.isArray(data.syncedOfflineIds) ? data.syncedOfflineIds : [];
  } catch {
    return [];
  }
}
