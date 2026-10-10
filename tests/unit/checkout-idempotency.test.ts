/**
 * MOCK-ONLY coverage of lib/checkout-transaction.ts. The fake client emulates the parts of PostgreSQL that the logic
 * relies on: a unique index on (businessId, scope, key), transactions that roll back as a whole, and serialized
 * transactions. It does NOT prove the real database behaviour. The real-PostgreSQL unique-index race is a separate check.
 */
import { describe, expect, it } from "vitest";
import { commitOrderOnce, requestHashOf, StockConflictError } from "@/lib/checkout-transaction";

type Store = {
  products: Map<string, { id: string; businessId: string; name: string; quantity: number | null; stockStatus: string }>;
  records: Map<string, any>;
  orders: Map<string, any>;
  seq: number;
};

function newStore(): Store {
  return {
    products: new Map([
      ["p1", { id: "p1", businessId: "b1", name: "Blue Shirt", quantity: 2, stockStatus: "IN_STOCK" }],
      ["p2", { id: "p2", businessId: "b1", name: "Hat", quantity: 1, stockStatus: "IN_STOCK" }],
    ]),
    records: new Map(),
    orders: new Map(),
    seq: 0,
  };
}

function cloneStore(s: Store): Store {
  return {
    products: new Map([...s.products].map(([k, v]) => [k, { ...v }])),
    records: new Map([...s.records].map(([k, v]) => [k, { ...v }])),
    orders: new Map([...s.orders].map(([k, v]) => [k, { ...v }])),
    seq: s.seq,
  };
}

function uniqueError() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function modelsOver(d: Store) {
  return {
    checkoutIdempotencyRecord: {
      create: async ({ data }: any) => {
        for (const r of d.records.values()) {
          if (r.businessId === data.businessId && r.scope === data.scope && r.key === data.key) throw uniqueError();
        }
        const id = `rec${++d.seq}`;
        const row = { id, orderId: null, paymentId: null, responseJson: null, ...data };
        d.records.set(id, row);
        return { id };
      },
      findUnique: async ({ where }: any) => {
        const { businessId, scope, key } = where.businessId_scope_key;
        for (const r of d.records.values()) {
          if (r.businessId === businessId && r.scope === scope && r.key === key) return { ...r };
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const row = d.records.get(where.id);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of d.records.values()) {
          if (r.id === where.id && where.state.in.includes(r.state)) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },
    product: {
      findFirst: async ({ where }: any) => {
        const p = d.products.get(where.id);
        return p && p.businessId === where.businessId ? { ...p } : null;
      },
      updateMany: async ({ where, data }: any) => {
        const p = d.products.get(where.id);
        if (!p || p.businessId !== where.businessId || p.quantity !== where.quantity) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    order: {
      create: async ({ data }: any) => {
        const id = `ord${++d.seq}`;
        d.orders.set(id, { id, ...data });
        return { id };
      },
    },
  };
}

/** Serialized transactions with rollback: a failing callback discards its draft. Stands in for the real database. */
function fakeDb(store: Store) {
  let chain: Promise<unknown> = Promise.resolve();
  const client: any = {
    ...modelsOver(store),
    $transaction: (fn: (tx: any) => Promise<any>) => {
      const run = chain.then(async () => {
        const draft = cloneStore(store);
        const result = await fn(modelsOver(draft));
        // Commit: replace the store's contents with the draft.
        store.products = draft.products;
        store.records = draft.records;
        store.orders = draft.orders;
        store.seq = draft.seq;
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return client;
}

const hash = (items: unknown) => requestHashOf({ scope: "storefront.checkout", items });

async function place(db: any, key: string | null, lines: Array<{ productId: string; quantity: number; name: string }>, requestHash = hash(lines)) {
  return commitOrderOnce<{ id: string }>({
    businessId: "b1",
    scope: "storefront.checkout",
    idempotencyKey: key,
    requestHash,
    stockLines: lines,
    create: async (tx) => tx.order.create({ data: { businessId: "b1", totalKES: 100 } }),
    client: db,
  });
}

describe("commitOrderOnce (mock-only)", () => {
  it("creates one order and decrements stock once for a single request", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const result = await place(db, "k1", [{ productId: "p1", quantity: 1, name: "Blue Shirt" }]);
    expect(result.kind).toBe("CREATED");
    expect(store.orders.size).toBe(1);
    expect(store.products.get("p1")!.quantity).toBe(1);
  });

  it("duplicate submit with the same key returns a replay and does not decrement stock again", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const lines = [{ productId: "p1", quantity: 1, name: "Blue Shirt" }];
    const first = await place(db, "k1", lines);
    const second = await place(db, "k1", lines);
    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("REPLAY");
    expect(store.orders.size).toBe(1);
    expect(store.products.get("p1")!.quantity).toBe(1);
  });

  it("concurrent submits with the same key create exactly one order", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const lines = [{ productId: "p1", quantity: 1, name: "Blue Shirt" }];
    const results = await Promise.all([place(db, "k2", lines), place(db, "k2", lines), place(db, "k2", lines)]);
    expect(results.filter((r) => r.kind === "CREATED")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "REPLAY")).toHaveLength(2);
    expect(store.orders.size).toBe(1);
    expect(store.products.get("p1")!.quantity).toBe(1);
  });

  it("reusing a key for a different request is refused, not replayed", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await place(db, "k3", [{ productId: "p1", quantity: 1, name: "Blue Shirt" }]);
    const other = await place(db, "k3", [{ productId: "p1", quantity: 2, name: "Blue Shirt" }]);
    expect(other.kind).toBe("KEY_REUSED");
    expect(store.orders.size).toBe(1);
  });

  it("a stock conflict on a later line rolls back the whole order, record included", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const lines = [
      { productId: "p1", quantity: 1, name: "Blue Shirt" },
      { productId: "p2", quantity: 5, name: "Hat" },
    ];
    await expect(place(db, "k4", lines)).rejects.toBeInstanceOf(StockConflictError);
    expect(store.orders.size).toBe(0);
    expect(store.records.size).toBe(0);
    expect(store.products.get("p1")!.quantity).toBe(2);
  });

  it("a rejected quantity (more than in stock) creates nothing and leaves no key behind, so a corrected retry can succeed", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await expect(place(db, "k5", [{ productId: "p2", quantity: 2, name: "Hat" }])).rejects.toThrow(/Insufficient stock/);
    const retry = await place(db, "k5", [{ productId: "p2", quantity: 1, name: "Hat" }]);
    expect(retry.kind).toBe("CREATED");
    expect(store.products.get("p2")!.quantity).toBe(0);
  });

  it("durable across restart: a new client over the same store still replays the first order", async () => {
    const store = newStore();
    const lines = [{ productId: "p1", quantity: 1, name: "Blue Shirt" }];
    await place(fakeDb(store), "k6", lines);
    // Simulated restart: the in-process objects are gone; only the store (the database) remains.
    const afterRestart = await place(fakeDb(store), "k6", lines);
    expect(afterRestart.kind).toBe("REPLAY");
    expect(store.orders.size).toBe(1);
  });

  it("a failed order write rolls back its stock decrement and key", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await expect(
      commitOrderOnce({
        businessId: "b1",
        scope: "storefront.checkout",
        idempotencyKey: "k7",
        requestHash: hash("x"),
        stockLines: [{ productId: "p1", quantity: 1, name: "Blue Shirt" }],
        create: async () => {
          throw new Error("disk full");
        },
        client: db,
      }),
    ).rejects.toThrow("disk full");
    expect(store.products.get("p1")!.quantity).toBe(2);
    expect(store.records.size).toBe(0);
  });

  it("a product from another business is not decremented and is refused", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await expect(
      commitOrderOnce({
        businessId: "b2",
        scope: "storefront.checkout",
        idempotencyKey: null,
        requestHash: hash("y"),
        stockLines: [{ productId: "p1", quantity: 1, name: "Blue Shirt" }],
        create: async (tx) => tx.order.create({ data: {} }),
        client: db,
      }),
    ).rejects.toBeInstanceOf(StockConflictError);
    expect(store.products.get("p1")!.quantity).toBe(2);
  });
});
