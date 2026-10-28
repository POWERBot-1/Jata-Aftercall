/**
 * Offline-first POS — public surface (§6).
 *
 * Device-side durable queue + synchronization. Server-side replay lives in
 * `app/api/pos/[businessId]/sync/route.ts` and reuses the existing sale engine.
 */

export * from "./types";
export {
  createOfflineSaleRecord,
  enqueueOfflineSale,
  listOfflineSales,
  updateOfflineSale,
  removeOfflineSale,
  clearOfflineQueue,
  requeueFailed,
  pruneTo,
  newOfflineId,
  offlineIdempotencyKey,
  getDefaultBackend,
  setDefaultBackend,
  MemoryBackend,
  LocalStorageBackend,
  IndexedDBBackend,
  MAX_QUEUE_SIZE,
  type OfflineQueueBackend,
} from "./queueStore";
export {
  submitSaleOfflineFirst,
  flushOfflineQueue,
  fetchSyncedOfflineIds,
  type OfflineSubmitResult,
  type FlushOptions,
} from "./syncClient";
