"use client";

/**
 * Offline-first POS — React hook for the till (§6).
 *
 * Owns the device-side queue state and drives synchronization: it lists the queue on mount, flushes
 * automatically when the network returns (and on a manual "Sync now"), and exposes recovery actions
 * (retry failed, dismiss a synced record). The hook never claims a sale succeeded unless the server
 * confirmed it — `flushOfflineQueue` updates each record to its authoritative state.
 *
 * Kept deliberately small: the queue logic lives in `syncClient`/`queueStore` so it is testable
 * without React, and this hook is a thin stateful view over it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearOfflineQueue,
  flushOfflineQueue,
  listOfflineSales,
  removeOfflineSale,
  requeueFailed,
} from "@/lib/pos/offline";
import type { OfflineSaleRecord, OfflineSyncSummary } from "@/lib/pos/offline/types";

export type OfflineSyncState = {
  records: OfflineSaleRecord[];
  online: boolean;
  busy: boolean;
  lastSummary: OfflineSyncSummary | null;
  error: string | null;
};

export function useOfflineSync(businessId: string): OfflineSyncState & {
  syncNow: () => Promise<OfflineSyncSummary>;
  retryFailed: () => Promise<void>;
  dismiss: (offlineId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearAll: () => Promise<void>;
} {
  const [records, setRecords] = useState<OfflineSaleRecord[]>([]);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  const [busy, setBusy] = useState(false);
  const [lastSummary, setLastSummary] = useState<OfflineSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flushing = useRef(false);

  const refresh = useCallback(async () => {
    setRecords(await listOfflineSales());
  }, []);

  const syncNow = useCallback(async () => {
    if (flushing.current) return lastSummary;
    flushing.current = true;
    setBusy(true);
    setError(null);
    try {
      const summary = await flushOfflineQueue(businessId, { onProgress: setLastSummary });
      setLastSummary(summary);
      await refresh();
      return summary;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synchronization failed.");
      return lastSummary;
    } finally {
      flushing.current = false;
      setBusy(false);
    }
  }, [businessId, lastSummary, refresh]);

  // Load the queue once on mount (a data fetch, not a derived-state effect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Re-sync automatically when connectivity returns.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      if (!flushing.current) void syncNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncNow]);

  const retryFailed = useCallback(async () => {
    await requeueFailed();
    await refresh();
  }, [refresh]);

  const dismiss = useCallback(
    async (offlineId: string) => {
      await removeOfflineSale(offlineId);
      await refresh();
    },
    [refresh],
  );

  const clearAll = useCallback(async () => {
    await clearOfflineQueue();
    await refresh();
  }, [refresh]);

  return {
    records,
    online,
    busy,
    lastSummary,
    error,
    syncNow,
    retryFailed,
    dismiss,
    refresh,
    clearAll,
  };
}
