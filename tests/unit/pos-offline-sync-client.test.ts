/**
 * Offline-first POS — client synchronization (§6, §25).
 *
 * Pins the two client-side behaviours that make offline selling safe:
 *   - a sale made without a usable network is saved to the durable queue, not lost;
 *   - a server refusal is never queued (it will still be true when connectivity returns), while a
 *     transport failure is.
 * and the flush contract: each queued record is driven to its authoritative state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryBackend,
  createOfflineSaleRecord,
  enqueueOfflineSale,
  flushOfflineQueue,
  listOfflineSales,
  setDefaultBackend,
  submitSaleOfflineFirst,
} from "@/lib/pos/offline";
import type { OfflineSaleRecord, OfflineSyncResult } from "@/lib/pos/offline/types";

function record(overrides: Partial<OfflineSaleRecord> = {}): OfflineSaleRecord {
  return createOfflineSaleRecord({
    request: { items: [{ productId: "p1", quantity: 2 }] },
    branchId: null,
    paymentKind: "cash",
    paymentReference: null,
    ...overrides,
  });
}

function jsonResponse(payload: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => payload } as unknown as Response);
}

beforeEach(() => {
  setDefaultBackend(new MemoryBackend());
  vi.unstubAllGlobals();
});

describe("submitSaleOfflineFirst (§6)", () => {
  it("posts online and does not queue when the server accepts", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ ok: true, sale: { id: "s1", receiptNumber: "NCK-1" } }),
    ) as unknown as typeof fetch;
    const result = await submitSaleOfflineFirst(
      "bizA",
      { request: { items: [{ productId: "p1", quantity: 1 }] }, branchId: null, paymentKind: "cash", fetcher },
    );
    expect(result).toMatchObject({ offline: false, ok: true, saleId: "s1" });
    expect(await listOfflineSales()).toHaveLength(0);
  });

  it("queues the sale when the network fails mid-request", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const result = await submitSaleOfflineFirst(
      "bizA",
      { request: { items: [{ productId: "p1", quantity: 1 }] }, branchId: null, paymentKind: "cash", fetcher },
    );
    expect(result.offline).toBe(true);
    const queued = await listOfflineSales();
    expect(queued).toHaveLength(1);
    expect(queued[0].paymentKind).toBe("cash");
  });

  it("queues the sale when the device is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await submitSaleOfflineFirst(
      "bizA",
      { request: { items: [{ productId: "p1", quantity: 1 }] }, branchId: null, paymentKind: "cash", fetcher },
    );
    expect(result.offline).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await listOfflineSales()).toHaveLength(1);
  });

  it("does not queue a server refusal (it stays true when connectivity returns)", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: false, error: "Insufficient stock" }, false)) as unknown as typeof fetch;
    const result = await submitSaleOfflineFirst(
      "bizA",
      { request: { items: [{ productId: "p1", quantity: 1 }] }, branchId: null, paymentKind: "cash", fetcher },
    );
    expect(result).toMatchObject({ offline: false, ok: false });
    expect(await listOfflineSales()).toHaveLength(0);
  });
});

describe("flushOfflineQueue (§6, §25)", () => {
  it("returns an empty summary when the queue is empty", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const summary = await flushOfflineQueue("bizA", { fetcher });
    expect(summary).toEqual({ total: 0, synced: 0, duplicate: 0, conflict: 0, rejected: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drives each queued record to its authoritative state", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    await enqueueOfflineSale(record({ offlineId: "off_2", paymentKind: "pending" }));

    const results: OfflineSyncResult[] = [
      { offlineId: "off_1", status: "synced", saleId: "s1", receiptNumber: "NCK-1" },
      { offlineId: "off_2", status: "synced", saleId: "s2", receiptNumber: "NCK-2", unconfirmedPayment: true },
    ];
    const fetcher = vi.fn(async () => jsonResponse({ results })) as unknown as typeof fetch;

    const summary = await flushOfflineQueue("bizA", { fetcher });
    expect(summary).toMatchObject({ total: 2, synced: 2 });

    const all = await listOfflineSales();
    const first = all.find((r) => r.offlineId === "off_1")!;
    const second = all.find((r) => r.offlineId === "off_2")!;
    expect(first.status).toBe("synced");
    expect(first.syncedReceiptNumber).toBe("NCK-1");
    expect(second.status).toBe("synced");
    expect(second.syncedSaleId).toBe("s2");
  });

  it("marks records failed when the network drops during the flush", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const summary = await flushOfflineQueue("bizA", { fetcher });
    expect(summary.rejected).toBe(1);
    expect((await listOfflineSales())[0].status).toBe("failed");
  });

  it("treats a duplicate replay as resolved, not a failure", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    const results: OfflineSyncResult[] = [
      { offlineId: "off_1", status: "duplicate", saleId: "s1", receiptNumber: "NCK-1" },
    ];
    const fetcher = vi.fn(async () => jsonResponse({ results })) as unknown as typeof fetch;
    const summary = await flushOfflineQueue("bizA", { fetcher });
    expect(summary.duplicate).toBe(1);
    expect((await listOfflineSales())[0].status).toBe("synced");
  });
});
