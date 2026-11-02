/**
 * MJENGO OS settlement — the money rule.
 *
 * These tests use a small in-memory transaction double that records the calls it receives. That is
 * deliberate and it is a limitation: it proves the *branching and guards* (which product key
 * settles, whether a mispriced plan can activate, whether a replay double-extends), not that
 * PostgreSQL enforces anything. The database-level proof is the `*-postgres` suites, which are
 * BLOCKED in this environment (no database) and are reported as such.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: {}, prisma: {} }));

import {
  MJENGO_PLAN_KEY,
  MJENGO_PLAN_PRICE_KES,
  MJENGO_PLAN_DURATION_DAYS,
} from "../../lib/mjengo/entitlement";
import {
  MjengoCheckoutRefused,
  assertMjengoStorageAvailable,
  mjengoCheckoutRefusal,
  settleMjengoPayment,
} from "../../lib/mjengo/settlement";

type Recorded = { upsert: any[]; updates: any[]; webhooks: string[] };

function fakeTx(options: {
  subscription?: any;
  entitlement?: any;
  payment?: any;
  casCount?: number;
} = {}): { tx: any; seen: Recorded } {
  const seen: Recorded = { upsert: [], updates: [], webhooks: [] };
  const payment = options.payment ?? { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING", reference: "ref_1" };
  const tx = {
    payment: {
      updateMany: async (args: any) => {
        seen.updates.push(args);
        return { count: options.casCount ?? 1 };
      },
      findUnique: async () => ({ ...payment, status: "PAID" }),
    },
    erpSubscription: {
      findUnique: async () => options.subscription ?? null,
      upsert: async (args: any) => {
        seen.upsert.push(args);
        return { id: "sub_1", ...args.create, ...args.update };
      },
    },
    erpEntitlement: {
      findUnique: async () => options.entitlement ?? null,
      upsert: async (args: any) => {
        seen.upsert.push(args);
        return { id: "ent_1", ...args.create, ...args.update };
      },
    },
    processedWebhook: {
      create: async (args: any) => {
        seen.webhooks.push(args.data.id);
        return args.data;
      },
    },
  };
  return { tx, seen };
}

const plan = { id: "plan_mjengo", key: MJENGO_PLAN_KEY, priceKES: MJENGO_PLAN_PRICE_KES, durationDays: MJENGO_PLAN_DURATION_DAYS, isActive: true };
const evidence = { paystackId: "ps_123456" };

describe("mjengo: checkout refusal (before any money moves)", () => {
  it("refuses when the deployment has MJENGO OS switched off", () => {
    const previous = process.env.MJENGO_OS_DISABLED;
    process.env.MJENGO_OS_DISABLED = "true";
    try {
      expect(mjengoCheckoutRefusal(plan)).toMatch(/not enabled/i);
    } finally {
      if (previous === undefined) delete process.env.MJENGO_OS_DISABLED;
      else process.env.MJENGO_OS_DISABLED = previous;
    }
  });

  it("refuses a missing plan row and a plan that is not MJENGO OS", () => {
    expect(mjengoCheckoutRefusal(null)).toMatch(/not configured/i);
    expect(mjengoCheckoutRefusal({ ...plan, key: "BUSINESS_POS", priceKES: 499 })).toMatch(/not MJENGO OS/i);
  });

  it("refuses POS 499 and ERP 3000 price rows offered as MJENGO OS", () => {
    expect(mjengoCheckoutRefusal({ ...plan, priceKES: 499 })).toMatch(/1,?000|2,000/);
    expect(mjengoCheckoutRefusal({ ...plan, priceKES: 3000 })).toMatch(/2,000/);
    expect(mjengoCheckoutRefusal({ ...plan, durationDays: 31 })).toMatch(/2,000/);
  });

  it("refuses an inactive row, and allows exactly 2000 / 30 days", () => {
    expect(mjengoCheckoutRefusal({ ...plan, isActive: false })).toMatch(/not currently offered/i);
    expect(mjengoCheckoutRefusal(plan)).toBeNull();
  });
});

describe("mjengo: settlement", () => {
  it("activates a MJENGO_OS subscription and entitlement from verified evidence", async () => {
    const { tx, seen } = fakeTx();
    const result = await settleMjengoPayment(tx, { payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING", reference: "ref_1" }, plan, verification: evidence });
    expect(result.alreadySettled).toBe(false);
    expect(result.mjengoSubscription).toBe(true);
    expect(seen.updates[0].data.status).toBe("PAID");
    const subscriptionWrite = seen.upsert.find((args) => args.where?.businessId === "biz1" && args.create?.planKey);
    expect(subscriptionWrite.create.planKey).toBe(MJENGO_PLAN_KEY);
    expect(subscriptionWrite.create.status).toBe("ACTIVE");
    // 30 days of paid period, plus the documented 3-day grace.
    const days = (new Date(subscriptionWrite.create.expiresAt).getTime() - new Date(subscriptionWrite.create.startAt).getTime()) / 86_400_000;
    expect(days).toBeCloseTo(MJENGO_PLAN_DURATION_DAYS, 5);
    const graceDays = (new Date(subscriptionWrite.create.graceUntil).getTime() - new Date(subscriptionWrite.create.expiresAt).getTime()) / 86_400_000;
    expect(graceDays).toBeCloseTo(3, 5);
  });

  it("refuses to settle without provider evidence", async () => {
    const { tx } = fakeTx();
    await expect(
      settleMjengoPayment(tx, { payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING" }, plan }),
    ).rejects.toThrow(/PAYMENT_EVIDENCE_REQUIRED/);
  });

  it("refuses to activate a plan whose stored terms are not 2000 / 30d", async () => {
    const { tx, seen } = fakeTx();
    await expect(
      settleMjengoPayment(tx, {
        payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING" },
        plan: { ...plan, priceKES: 499 },
        verification: evidence,
      }),
    ).rejects.toBeInstanceOf(MjengoCheckoutRefused);
    expect(seen.upsert).toEqual([]);
    expect(seen.updates).toEqual([]);
  });

  it("refuses a non-MJENGO plan key outright (POS payment cannot grant MJENGO)", async () => {
    const { tx } = fakeTx();
    await expect(
      settleMjengoPayment(tx, {
        payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING" },
        plan: { ...plan, key: "BUSINESS_POS" },
        verification: evidence,
      }),
    ).rejects.toThrow(/MJENGO_PLAN_KEY_MISMATCH/);
  });

  it("is idempotent: a replayed webhook returns alreadySettled and does not extend the window", async () => {
    const { tx, seen } = fakeTx({
      subscription: { id: "sub_1", businessId: "biz1", planKey: MJENGO_PLAN_KEY, status: "ACTIVE", paymentId: "pay_1" },
      payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PAID", reference: "ref_1" },
    });
    const result = await settleMjengoPayment(tx, {
      payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PAID" },
      plan,
      eventId: "evt_1",
      verification: evidence,
    });
    expect(result.alreadySettled).toBe(true);
    expect(seen.upsert).toEqual([]);
    expect(seen.webhooks).toEqual(["evt_1"]);
  });

  it("resolves a lost compare-and-set race idempotently instead of double-extending", async () => {
    const { tx, seen } = fakeTx({ casCount: 0 });
    const result = await settleMjengoPayment(tx, {
      payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING" },
      plan,
      eventId: "evt_2",
      verification: evidence,
    });
    expect(result.alreadySettled).toBe(true);
    expect(seen.upsert).toEqual([]);
  });

  it("refuses to overwrite another product's single storage row", async () => {
    const { tx, seen } = fakeTx({ entitlement: { businessId: "biz1", packageKey: "ERP_PRO", status: "ACTIVE" } });
    await expect(assertMjengoStorageAvailable(tx, "biz1")).rejects.toBeInstanceOf(MjengoCheckoutRefused);
    await expect(
      settleMjengoPayment(tx, {
        payment: { id: "pay_1", businessId: "biz1", userId: "user1", status: "PENDING" },
        plan,
        verification: evidence,
      }),
    ).rejects.toThrow(/STORAGE_CONFLICT/);
    expect(seen.upsert).toEqual([]);
  });

  it("renewal extends from the paid-through date, never from today", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000);
    const { tx, seen } = fakeTx({
      subscription: { id: "sub_1", businessId: "biz1", planKey: MJENGO_PLAN_KEY, status: "ACTIVE", paymentId: "pay_old", expiresAt: future },
    });
    await settleMjengoPayment(tx, {
      payment: { id: "pay_2", businessId: "biz1", userId: "user1", status: "PENDING" },
      plan,
      verification: evidence,
    });
    const write = seen.upsert.find((args) => args.where?.businessId === "biz1");
    expect(new Date(write.update.startAt).getTime()).toBe(future.getTime());
  });
});
