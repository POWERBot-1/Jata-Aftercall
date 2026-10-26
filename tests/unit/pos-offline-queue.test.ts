/**
 * Offline-first POS — durable local queue (§6, §25).
 *
 * The queue is the device's ledger of offline sales. These tests pin the durability rules: a record
 * survives a "reload" (a fresh backend read), a duplicate idempotency key is not written twice,
 * and pruning never touches records still waiting to sync.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  MemoryBackend,
  clearOfflineQueue,
  enqueueOfflineSale,
  listOfflineSales,
  newOfflineId,
  offlineIdempotencyKey,
  pruneTo,
  requeueFailed,
  setDefaultBackend,
  updateOfflineSale,
} from "@/lib/pos/offline";
import type { OfflineSaleRecord } from "@/lib/pos/offline/types";

function record(overrides: Partial<OfflineSaleRecord> = {}): OfflineSaleRecord {
  const offlineId = overrides.offlineId ?? newOfflineId();
  return {
    offlineId,
    idempotencyKey: overrides.idempotencyKey ?? offlineIdempotencyKey(offlineId),
    request: { items: [{ productId: "p1", quantity: 1 }] },
    branchId: null,
    recordedAt: new Date().toISOString(),
    paymentKind: "cash",
    paymentReference: null,
    attempts: 0,
    status: "queued",
    lastError: null,
    syncedAt: null,
    syncedSaleId: null,
    syncedReceiptNumber: null,
    ...overrides,
  };
}

beforeEach(() => {
  setDefaultBackend(new MemoryBackend());
});

describe("createOfflineSaleRecord (§6)", () => {
  it("generates a stable idempotency key from the offline id", () => {
    const a = record({ offlineId: "off_x" });
    expect(a.idempotencyKey).toBe(offlineIdempotencyKey("off_x"));
    expect(a.idempotencyKey).toBe("offline:off_x");
    expect(a.status).toBe("queued");
    expect(a.attempts).toBe(0);
  });

  it("gives every record a unique offline id by default", () => {
    const a = record();
    const b = record();
    expect(a.offlineId).not.toBe(b.offlineId);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
});

describe("enqueueOfflineSale (§6, §25)", () => {
  it("persists a record so it survives a fresh read", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    const all = await listOfflineSales();
    expect(all).toHaveLength(1);
    expect(all[0].offlineId).toBe("off_1");
  });

  it("does not write a duplicate idempotency key twice", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    expect(await listOfflineSales()).toHaveLength(1);
  });

  it("captures payment kind and reference for later verification", async () => {
    await enqueueOfflineSale(
      record({ offlineId: "off_p", paymentKind: "pending", paymentReference: "MPX999" }),
    );
    const [row] = await listOfflineSales();
    expect(row.paymentKind).toBe("pending");
    expect(row.paymentReference).toBe("MPX999");
  });
});

describe("updateOfflineSale (§6)", () => {
  it("updates a record in place and returns it", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    const updated = await updateOfflineSale("off_1", {
      status: "synced",
      syncedReceiptNumber: "NCK-100",
    });
    expect(updated?.status).toBe("synced");
    expect(updated?.syncedReceiptNumber).toBe("NCK-100");
    expect((await listOfflineSales())[0].status).toBe("synced");
  });

  it("returns null for an unknown record", async () => {
    expect(await updateOfflineSale("nope", { status: "synced" })).toBeNull();
  });
});

describe("requeueFailed + pruneTo (§6 recovery, §25 quota)", () => {
  it("requeues only failed/conflict/queued records", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1", status: "failed" }));
    await enqueueOfflineSale(record({ offlineId: "off_2", status: "synced", syncedAt: new Date().toISOString() }));
    const count = await requeueFailed();
    expect(count).toBe(1);
    const all = await listOfflineSales();
    expect(all.find((r) => r.offlineId === "off_1")?.status).toBe("queued");
    expect(all.find((r) => r.offlineId === "off_2")?.status).toBe("synced");
  });

  it("prunes oldest synced records first and leaves waiting ones alone", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_s1", status: "synced", syncedAt: "2026-01-01T00:00:00Z" }));
    await enqueueOfflineSale(record({ offlineId: "off_s2", status: "synced", syncedAt: "2026-02-01T00:00:00Z" }));
    await enqueueOfflineSale(record({ offlineId: "off_q", status: "queued" }));

    const removed = await pruneTo(1);
    expect(removed).toBe(1);
    const remaining = (await listOfflineSales()).map((r) => r.offlineId).sort();
    expect(remaining).toEqual(["off_q", "off_s2"]); // oldest synced evicted, waiting kept
  });
});

describe("clearOfflineQueue (§6)", () => {
  it("empties the queue", async () => {
    await enqueueOfflineSale(record({ offlineId: "off_1" }));
    await clearOfflineQueue();
    expect(await listOfflineSales()).toHaveLength(0);
  });
});
