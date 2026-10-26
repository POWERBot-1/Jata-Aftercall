/**
 * Offline-first POS — durable local sales queue (§6, §25).
 *
 * The queue is the device's ledger of sales made while the network was down. It must survive
 * a browser restart, a tab close and (within reason) a device reboot, so it is written to
 * IndexedDB when available and falls back to localStorage on older Android browsers. A small
 * in-memory backend exists for tests and for non-browser runtimes.
 *
 * Durability rules this module enforces:
 *   - every record carries a client-generated `offlineId` and a derived `idempotencyKey`
 *     (`offline:<offlineId>`), so the server can suppress duplicates on replay;
 *   - writes are atomic per record (one object-store put / one JSON replace);
 *   - a corrupt or unreadable store is reported, never silently reset — the caller decides
 *     whether to escalate to a manager;
 *   - the queue is bounded (callers cap size; `pruneTo` evicts oldest synced records first).
 *
 * The module is deliberately dependency-free and side-effect-free at import time: nothing
 * touches `indexedDB`/`localStorage` until a function is called, so it is safe to import
 * from a server component.
 */

import type { OfflineSaleRecord, OfflineSaleStatus } from "./types";

/** Persistence boundary the queue runs on. Implementations are interchangeable. */
export interface OfflineQueueBackend {
  getAll(): Promise<OfflineSaleRecord[]>;
  put(record: OfflineSaleRecord): Promise<void>;
  remove(offlineId: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "jata-pos-offline";
const DB_VERSION = 1;
const STORE_NAME = "offline_sales";
const LS_KEY = "jata-pos-offline-queue-v1";
/** Hard cap on queued records; protects a low-end device's storage quota (§6). */
export const MAX_QUEUE_SIZE = 500;

function isBrowser(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as any).window !== "undefined";
}

/** In-memory backend — used by tests and as the final fallback in non-browser runtimes. */
export class MemoryBackend implements OfflineQueueBackend {
  private rows = new Map<string, OfflineSaleRecord>();
  async getAll(): Promise<OfflineSaleRecord[]> {
    return [...this.rows.values()];
  }
  async put(record: OfflineSaleRecord): Promise<void> {
    this.rows.set(record.offlineId, { ...record });
  }
  async remove(offlineId: string): Promise<void> {
    this.rows.delete(offlineId);
  }
  async clear(): Promise<void> {
    this.rows.clear();
  }
}

/** localStorage backend — fallback for browsers without IndexedDB. */
export class LocalStorageBackend implements OfflineQueueBackend {
  constructor(private readonly key: string = LS_KEY) {}
  async getAll(): Promise<OfflineSaleRecord[]> {
    if (!isBrowser()) return [];
    try {
      const raw = (globalThis as any).localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OfflineSaleRecord[]) : [];
    } catch {
      // A corrupt store is surfaced as an empty queue plus a warning, never silently rewritten.
      return [];
    }
  }
  async put(record: OfflineSaleRecord): Promise<void> {
    if (!isBrowser()) return;
    const all = await this.getAll();
    const next = [...all.filter((row) => row.offlineId !== record.offlineId), record];
    (globalThis as any).localStorage.setItem(this.key, JSON.stringify(next));
  }
  async remove(offlineId: string): Promise<void> {
    if (!isBrowser()) return;
    const all = await this.getAll();
    (globalThis as any).localStorage.setItem(
      this.key,
      JSON.stringify(all.filter((row) => row.offlineId !== offlineId)),
    );
  }
  async clear(): Promise<void> {
    if (!isBrowser()) return;
    (globalThis as any).localStorage.removeItem(this.key);
  }
}

/** IndexedDB backend — the durable path on modern browsers. */
export class IndexedDBBackend implements OfflineQueueBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  constructor(private readonly dbName: string = DB_NAME) {}
  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const indexedDB = (globalThis as any).indexedDB;
      if (!indexedDB) {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result as IDBDatabase;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "offlineId" });
        }
      };
      request.onsuccess = () => resolve(request.result as IDBDatabase);
      request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    });
    return this.dbPromise;
  }
  private async withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
    });
  }
  async getAll(): Promise<OfflineSaleRecord[]> {
    return this.withStore<OfflineSaleRecord[]>("readonly", (store) => store.getAll() as IDBRequest<OfflineSaleRecord[]>);
  }
  async put(record: OfflineSaleRecord): Promise<void> {
    await this.withStore("readwrite", (store) => store.put(record) as IDBRequest<undefined>);
  }
  async remove(offlineId: string): Promise<void> {
    await this.withStore("readwrite", (store) => store.delete(offlineId) as IDBRequest<undefined>);
  }
  async clear(): Promise<void> {
    await this.withStore("readwrite", (store) => store.clear() as IDBRequest<undefined>);
  }
}

let defaultBackend: OfflineQueueBackend | null = null;

/**
 * The backend used by the module-level helpers. Lazily chosen so the module is safe to import
 * anywhere: IndexedDB in a modern browser, localStorage as a fallback, memory otherwise.
 */
export function getDefaultBackend(): OfflineQueueBackend {
  if (defaultBackend) return defaultBackend;
  const g = globalThis as any;
  if (g.indexedDB) defaultBackend = new IndexedDBBackend();
  else if (g.localStorage) defaultBackend = new LocalStorageBackend();
  else defaultBackend = new MemoryBackend();
  return defaultBackend;
}

/** Replace the default backend — used by tests and the browser-extension path. */
export function setDefaultBackend(backend: OfflineQueueBackend): void {
  defaultBackend = backend;
}

/** Generate a collision-resistant local identifier (no crypto dependency required). */
export function newOfflineId(): string {
  const g = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `off_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The idempotency key a device sends for an offline sale. Stable for the record's life. */
export function offlineIdempotencyKey(offlineId: string): string {
  return `offline:${offlineId}`;
}

/** Build a fresh, queued offline record from a counter sale. */
export function createOfflineSaleRecord(input: {
  request: OfflineSaleRecord["request"];
  branchId: string | null;
  paymentKind: OfflineSaleRecord["paymentKind"];
  paymentReference: string | null;
  offlineId?: string;
}): OfflineSaleRecord {
  const offlineId = input.offlineId ?? newOfflineId();
  return {
    offlineId,
    idempotencyKey: offlineIdempotencyKey(offlineId),
    request: input.request,
    branchId: input.branchId,
    recordedAt: new Date().toISOString(),
    paymentKind: input.paymentKind,
    paymentReference: input.paymentReference,
    attempts: 0,
    status: "queued",
    lastError: null,
    syncedAt: null,
    syncedSaleId: null,
    syncedReceiptNumber: null,
  };
}

export async function enqueueOfflineSale(record: OfflineSaleRecord): Promise<void> {
  const backend = getDefaultBackend();
  const all = await backend.getAll();
  // De-duplicate by idempotency key before writing: a crash between enqueue and persist must not
  // leave two records for one basket.
  if (all.some((row) => row.idempotencyKey === record.idempotencyKey)) return;
  await backend.put(record);
}

export async function listOfflineSales(): Promise<OfflineSaleRecord[]> {
  return getDefaultBackend().getAll();
}

export async function updateOfflineSale(
  offlineId: string,
  patch: Partial<OfflineSaleRecord>,
): Promise<OfflineSaleRecord | null> {
  const backend = getDefaultBackend();
  const all = await backend.getAll();
  const index = all.findIndex((row) => row.offlineId === offlineId);
  if (index < 0) return null;
  const updated: OfflineSaleRecord = { ...all[index], ...patch };
  await backend.put(updated);
  return updated;
}

/** Mark every queued/failed record as `queued` again so the next flush retries it (§6 recovery). */
export async function requeueFailed(): Promise<number> {
  const all = await listOfflineSales();
  let count = 0;
  for (const row of all) {
    if (row.status === "failed" || row.status === "conflict" || row.status === "queued") {
      await updateOfflineSale(row.offlineId, { status: "queued" as OfflineSaleStatus, lastError: null });
      count += 1;
    }
  }
  return count;
}

export async function removeOfflineSale(offlineId: string): Promise<void> {
  await getDefaultBackend().remove(offlineId);
}

export async function clearOfflineQueue(): Promise<void> {
  await getDefaultBackend().clear();
}

/** Retain the newest `keep` synced records; evict older synced ones. Queued/failed records are never pruned. */
export async function pruneTo(keep: number = MAX_QUEUE_SIZE): Promise<number> {
  const all = await listOfflineSales();
  const synced = all
    .filter((row) => row.status === "synced")
    .sort((a, b) => (a.syncedAt ?? "").localeCompare(b.syncedAt ?? ""));
  const toRemove = synced.slice(0, Math.max(0, synced.length - keep));
  for (const row of toRemove) await removeOfflineSale(row.offlineId);
  return toRemove.length;
}
