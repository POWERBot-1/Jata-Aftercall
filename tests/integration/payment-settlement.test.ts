/**
 * Payment settlement and webhook integrity. MOCK-ONLY: the fake database emulates unique keys, compare-and-set
 * updates and transactions that roll back as a whole. It is NOT the Prisma runtime and NOT PostgreSQL. Real-database
 * proof is still required (see the release report).
 */
import crypto from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "sk_test_settlement_suite";
const state = vi.hoisted(() => ({ store: null as any, verifyTransaction: null as any, dbClient: null as any }));

function uniqueError() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function cloneStore(s: any) {
  return structuredClone(s);
}

function matches(row: any, where: any) {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === "object" && "in" in v) return v.in.includes(row[k]);
    return row[k] === v;
  });
}

function models(d: any) {
  const table = (name: string) => d[name];
  return {
    payment: {
      findUnique: async ({ where }: any) => {
        const row = table("payments").find((p: any) => matches(p, where));
        return row ? structuredClone(row) : null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of table("payments")) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      },
      update: async ({ where, data }: any) => {
        const row = table("payments").find((p: any) => matches(p, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return structuredClone(row);
      },
    },
    order: {
      findUnique: async ({ where }: any) => {
        const row = table("orders").find((o: any) => matches(o, where));
        return row ? structuredClone(row) : null;
      },
      update: async ({ where, data }: any) => {
        const row = table("orders").find((o: any) => matches(o, where));
        Object.assign(row, data);
        return structuredClone(row);
      },
    },
    processedWebhook: {
      findUnique: async ({ where }: any) => {
        const row = table("processed").find((p: any) => p.id === where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }: any) => {
        if (table("processed").some((p: any) => p.id === data.id)) throw uniqueError();
        table("processed").push({ id: data.id });
        return { id: data.id };
      },
      upsert: async ({ where, create }: any) => {
        if (!table("processed").some((p: any) => p.id === where.id)) table("processed").push({ id: create.id });
        return { id: where.id };
      },
    },
    booking: { updateMany: async () => ({ count: 0 }) },
    analyticsEvent: { create: async ({ data }: any) => (table("analytics").push(data), data) },
    notification: {
      create: async ({ data }: any) => {
        // Fault injection lives in the stored state, so it reaches the transaction's draft.
        if (d.faultNotification) throw new Error("notification store down");
        table("notifications").push(data);
        return data;
      },
    },
    auditEvent: { create: async ({ data }: any) => (table("audit").push(data), data) },
    webhookFailureEvent: { create: async ({ data }: any) => data },
  };
}

/** Serialized transactions with rollback. Concurrent calls are queued, as a single-writer lock would. */
function fakeDb(store: any) {
  let chain: Promise<unknown> = Promise.resolve();
  const client: any = {
    ...models(store),
    $transaction: (fn: (tx: any) => Promise<any>) => {
      const run = chain.then(async () => {
        const draft = cloneStore(store);
        const result = await fn(models(draft));
        Object.assign(store, draft); // commit
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return client;
}

vi.mock("@/lib/db", () => ({
  get default() {
    return state.dbClient;
  },
}));
vi.mock("@/lib/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paystack")>();
  return { ...actual, verifyTransaction: (...args: any[]) => state.verifyTransaction(...args) };
});

import { settleOrderPayment } from "@/lib/experience/payments";
import { POST } from "@/app/api/paystack/webhook/route";

function freshStore() {
  return {
    payments: [
      { id: "pay1", reference: "JATA-PAY-1", amount: 150000, currency: "KES", status: "PENDING", orderId: "ord1", bookingId: null, purpose: "ORDER", userId: "u1", businessId: "b1", planId: null, paystackId: null, raw: null },
    ],
    orders: [{ id: "ord1", businessId: "b1", orderReference: "ORD-1", totalKES: 1500, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", customerName: "Amina" }],
    processed: [] as Array<{ id: string }>,
    analytics: [] as any[],
    notifications: [] as any[],
    audit: [] as any[],
  };
}

function event(id: string, reference = "JATA-PAY-1", type = "charge.success", data: Record<string, unknown> = {}) {
  return JSON.stringify({ id, event: type, data: { id: 555, reference, amount: 150000, currency: "KES", ...data } });
}

function signed(body: string) {
  return crypto.createHmac("sha512", SECRET).update(body).digest("hex");
}

function webhook(body: string, signature: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-paystack-signature"] = signature;
  return new Request("https://jata.test/api/paystack/webhook", { method: "POST", body, headers });
}

const verified = {
  id: 555,
  status: "success",
  reference: "JATA-PAY-1",
  amount: 150000,
  currency: "KES",
};

beforeAll(() => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
});

beforeEach(() => {
  state.store = freshStore();
  state.dbClient = fakeDb(state.store);
  state.verifyTransaction = vi.fn(async () => ({ ...verified }));
});

describe("settleOrderPayment (mock-only)", () => {
  it("settles once: the order is paid and confirmed, with one notification and one analytics row", async () => {
    const result = await settleOrderPayment("pay1", { eventId: "evt-1", verification: { paystackId: "555" } });
    expect(result.alreadySettled).toBe(false);
    expect(state.store.payments[0].status).toBe("PAID");
    expect(state.store.orders[0]).toMatchObject({ paymentStatus: "PAID", status: "CONFIRMED" });
    expect(state.store.notifications).toHaveLength(1);
    expect(state.store.analytics).toHaveLength(1);
  });

  it("a repeated callback with a new event id does not settle again or duplicate the notification", async () => {
    await settleOrderPayment("pay1", { eventId: "evt-1" });
    const again = await settleOrderPayment("pay1", { eventId: "evt-2" });
    expect(again.alreadySettled).toBe(true);
    expect(state.store.notifications).toHaveLength(1);
    expect(state.store.analytics).toHaveLength(1);
  });

  it("concurrent callbacks for one payment settle exactly once", async () => {
    const results = await Promise.all([1, 2, 3, 4].map((i) => settleOrderPayment("pay1", { eventId: `evt-c${i}` })));
    expect(results.filter((r) => !r.alreadySettled)).toHaveLength(1);
    expect(state.store.notifications).toHaveLength(1);
    expect(state.store.processed.map((p: any) => p.id).sort()).toEqual(["evt-c1", "evt-c2", "evt-c3", "evt-c4"]);
  });

  it("an event id seen twice concurrently does not double-settle; the loser is rolled back", async () => {
    const results = await Promise.allSettled([settleOrderPayment("pay1", { eventId: "same" }), settleOrderPayment("pay1", { eventId: "same" })]);
    expect(results.every((r) => r.status === "fulfilled" || r.status === "rejected")).toBe(true);
    expect(state.store.notifications).toHaveLength(1);
    expect(state.store.processed.filter((p: any) => p.id === "same")).toHaveLength(1);
  });

  it("a failure partway through settlement rolls back the payment update, the order and the notification", async () => {
    state.store.faultNotification = true;
    await expect(settleOrderPayment("pay1", { eventId: "evt-fail" })).rejects.toThrow("notification store down");
    expect(state.store.payments[0].status).toBe("PENDING");
    expect(state.store.orders[0]).toMatchObject({ paymentStatus: "UNPAID", status: "PENDING_PAYMENT" });
    expect(state.store.processed).toHaveLength(0);
    // Recovery: the same callback succeeds once the fault is gone.
    state.store.faultNotification = false;
    const retry = await settleOrderPayment("pay1", { eventId: "evt-fail" });
    expect(retry.alreadySettled).toBe(false);
    expect(state.store.payments[0].status).toBe("PAID");
    expect(state.store.notifications).toHaveLength(1);
  });

  it("recovers after a restart: a new client over the same stored state does not settle again", async () => {
    await settleOrderPayment("pay1", { eventId: "evt-r1" });
    state.dbClient = fakeDb(state.store); // simulated restart: only the stored state survives
    const after = await settleOrderPayment("pay1", { eventId: "evt-r2" });
    expect(after.alreadySettled).toBe(true);
    expect(state.store.notifications).toHaveLength(1);
  });

  it("a refunded payment is terminal and is never settled again", async () => {
    state.store.payments[0].status = "REFUNDED";
    await expect(settleOrderPayment("pay1", { eventId: "evt-ref" })).rejects.toThrow("PAYMENT_NOT_PENDING");
    expect(state.store.orders[0].paymentStatus).toBe("UNPAID");
  });
});

describe("POST /api/paystack/webhook (mock-only)", () => {
  it("rejects a missing or wrong signature before reading the payload, and writes nothing", async () => {
    const body = event("evt-sig-1");
    expect((await POST(webhook(body, null))).status).toBe(401);
    expect((await POST(webhook(body, "00".repeat(64)))).status).toBe(401);
    expect((await POST(webhook(body, signed(body).slice(0, 10))))).toMatchObject({ status: 401 });
    expect(state.verifyTransaction).not.toHaveBeenCalled();
    expect(state.store.payments[0].status).toBe("PENDING");
    expect(state.store.processed).toHaveLength(0);
  });

  it("rejects a valid signature over a different body (tampered payload)", async () => {
    const original = event("evt-tamper");
    const tampered = event("evt-tamper", "JATA-PAY-1", "charge.success", { amount: 1 });
    expect((await POST(webhook(tampered, signed(original))))).toMatchObject({ status: 401 });
    expect(state.store.payments[0].status).toBe("PENDING");
  });

  it("a signed charge.success settles the order once", async () => {
    const body = event("evt-ok");
    const response = await POST(webhook(body, signed(body)));
    expect(response.status).toBe(200);
    expect(state.verifyTransaction).toHaveBeenCalledWith("JATA-PAY-1");
    expect(state.store.payments[0].status).toBe("PAID");
  });

  it("a duplicate delivery of the same event id is acknowledged without a second settlement", async () => {
    const body = event("evt-dup");
    await POST(webhook(body, signed(body)));
    const second = await POST(webhook(body, signed(body)));
    expect(await second.json()).toMatchObject({ status: "already_processed" });
    expect(state.store.notifications).toHaveLength(1);
  });

  it("two different event ids for the same paid reference do not double-settle", async () => {
    const a = event("evt-x1");
    const b = event("evt-x2");
    await POST(webhook(a, signed(a)));
    const second = await POST(webhook(b, signed(b)));
    expect(second.status).toBe(200);
    expect((await second.json()).status).toBe("already_paid");
    expect(state.store.notifications).toHaveLength(1);
  });

  it("concurrent deliveries of the same event settle exactly once", async () => {
    const body = event("evt-race");
    const responses = await Promise.all([1, 2, 3].map(() => POST(webhook(body, signed(body)))));
    expect(state.store.notifications).toHaveLength(1);
    expect(state.store.payments[0].status).toBe("PAID");
    expect(responses.every((r) => r.status === 200 || r.status === 503)).toBe(true);
  });

  it("a verified amount mismatch is refused and does not settle", async () => {
    state.verifyTransaction = vi.fn(async () => ({ ...verified, amount: 1 }));
    const body = event("evt-amt");
    expect((await POST(webhook(body, signed(body)))).status).toBe(400);
    expect(state.store.payments[0].status).toBe("PENDING");
  });

  it("a failed attempt followed by a verified success on the same reference still settles", async () => {
    const failed = event("evt-fail-attempt", "JATA-PAY-1", "charge.failed");
    const failedRes = await POST(webhook(failed, signed(failed)));
    expect(failedRes.status).toBe(200);
    expect(state.store.payments[0].status).toBe("FAILED");
    const success = event("evt-success-attempt");
    const successRes = await POST(webhook(success, signed(success)));
    expect(successRes.status).toBe(200);
    expect(state.store.payments[0].status).toBe("PAID");
    expect(state.store.orders[0].paymentStatus).toBe("PAID");
  });

  it("a late charge.failed never overwrites a paid payment", async () => {
    const ok = event("evt-paid-first");
    await POST(webhook(ok, signed(ok)));
    const late = event("evt-late-failed", "JATA-PAY-1", "charge.failed");
    await POST(webhook(late, signed(late)));
    expect(state.store.payments[0].status).toBe("PAID");
  });
});
