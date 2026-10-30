import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));
vi.mock("@prisma/client", async (original) => {
  const harness = process.env.PRISMA_WASM_HARNESS_DIR;
  if (!harness) return original();
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)(`${harness}/generated/wasm.js`);
});
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { recordRepayment, refundSale } from "@/lib/pos/sales";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any, ownerId: string, businessId: string;

describe.skipIf(!realPrismaConfigured)("customer repayment versus credit refund on PostgreSQL", () => {
  beforeAll(async () => {
    db = makeRealPrisma(); holder.client = db;
    ownerId = (await db.user.create({ data: { email: `credit-race-${stamp}@example.test`, name: "Owner", passwordHash: "test-only" } })).id;
    businessId = (await db.business.create({ data: { ownerId, slug: `credit-race-${stamp}`, name: "Business", category: "retail" } })).id;
  });
  afterAll(async () => {
    if (businessId) await db.business.delete({ where: { id: businessId } });
    if (ownerId) await db.user.delete({ where: { id: ownerId } });
    if (db) await db.$disconnect();
  });

  it("does not treat another sale's outstanding debt as this sale's unpaid credit after an unallocated repayment", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Ambiguous customer", balanceKES: 200 } });
    const older = await db.posSale.create({ data: { businessId, customerId: customer.id, receiptNumber: `OLD-${stamp}`, totalKES: 100, subtotalKES: 100, balanceKES: 100, status: "PARTIALLY_PAID" } });
    const newer = await db.posSale.create({ data: { businessId, customerId: customer.id, receiptNumber: `NEW-${stamp}`, totalKES: 100, subtotalKES: 100, balanceKES: 100, status: "PARTIALLY_PAID" } });
    await db.posCreditEntry.createMany({ data: [
      { businessId, partyType: "CUSTOMER", partyId: customer.id, saleId: older.id, direction: "DEBIT", amountKES: 100, balanceAfterKES: 100 },
      { businessId, partyType: "CUSTOMER", partyId: customer.id, saleId: newer.id, direction: "DEBIT", amountKES: 100, balanceAfterKES: 200 },
    ] });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true; configuration.sales.refunds = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const, "REFUND_SALE" as const], staffId: null, branchId: null };
    expect((await recordRepayment({ idempotencyKey: `test-repayment-${customer.id}`, businessId, customerId: customer.id, amountKES: 100, configuration, actor })).ok).toBe(true);
    const refund = await refundSale({ businessId, configuration, actor, request: { saleId: older.id, amountKES: 100 } });
    expect(refund).toMatchObject({ ok: false, code: "CREDIT_ALLOCATION_UNVERIFIED" });
    expect((await db.posCustomer.findFirst({ where: { businessId, id: customer.id } })).balanceKES).toBe(100);
    expect((await db.posSale.findFirst({ where: { businessId, id: older.id } })).creditRefundedKES).toBe(0);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: customer.id, direction: "CREDIT" } })).toBe(1);
  });

  it("rolls back claimed return items when ambiguity aborts a caller-owned transaction", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Rollback customer", balanceKES: 200 } });
    const sale = await db.posSale.create({ data: { businessId, customerId: customer.id, receiptNumber: `ROLL-${stamp}`, totalKES: 100, subtotalKES: 100, balanceKES: 100, status: "PARTIALLY_PAID", items: { create: [{ businessId, name: "Item", quantity: 1, unitPriceKES: 100, totalKES: 100 }] } }, include: { items: true } });
    await db.posCreditEntry.create({ data: { businessId, partyType: "CUSTOMER", partyId: customer.id, saleId: sale.id, direction: "DEBIT", amountKES: 100, balanceAfterKES: 100 } });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true; configuration.sales.refunds = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const, "REFUND_SALE" as const], staffId: null, branchId: null };
    expect((await recordRepayment({ idempotencyKey: `test-repayment-${customer.id}`, businessId, customerId: customer.id, amountKES: 100, configuration, actor })).ok).toBe(true);
    await expect(db.$transaction(async (tx: any) => refundSale({ businessId, configuration, actor, request: { saleId: sale.id, amountKES: 100, items: [{ saleItemId: sale.items[0].id, quantity: 1 }] }, client: tx }))).rejects.toThrow("CREDIT_ALLOCATION_UNVERIFIED");
    expect((await db.posSaleItem.findFirst({ where: { businessId, id: sale.items[0].id } })).returnedQty).toBe(0);
    expect((await db.posCustomer.findFirst({ where: { businessId, id: customer.id } })).balanceKES).toBe(100);
  });

  it("preserves a cash-only refund even when account repayments are unallocated", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Mixed customer", balanceKES: 60 } });
    const sale = await db.posSale.create({ data: { businessId, customerId: customer.id, receiptNumber: `MIXED-${stamp}`, totalKES: 100, subtotalKES: 100, paidKES: 40, balanceKES: 60, status: "PARTIALLY_PAID" } });
    await db.posPayment.create({ data: { businessId, saleId: sale.id, customerId: customer.id, purpose: "SALE", direction: "IN", status: "SETTLED", method: "cash", amountKES: 40 } });
    await db.posCreditEntry.create({ data: { businessId, partyType: "CUSTOMER", partyId: customer.id, saleId: sale.id, direction: "DEBIT", amountKES: 60, balanceAfterKES: 60 } });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true; configuration.sales.refunds = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const, "REFUND_SALE" as const], staffId: null, branchId: null };
    expect((await recordRepayment({ idempotencyKey: `test-repayment-${customer.id}`, businessId, customerId: customer.id, amountKES: 10, configuration, actor })).ok).toBe(true);
    expect(await refundSale({ businessId, configuration, actor, request: { saleId: sale.id, amountKES: 20 } })).toMatchObject({ ok: true, refundedKES: 20 });
    expect((await db.posCustomer.findFirst({ where: { businessId, id: customer.id } })).balanceKES).toBe(50);
    expect(await db.posPayment.count({ where: { businessId, saleId: sale.id, direction: "OUT", amountKES: 20 } })).toBe(1);
  });

  it("serializes credit refunds on different sales sharing one customer balance", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Shared account", balanceKES: 100 } });
    const sales = await Promise.all(["A", "B"].map((suffix) => db.posSale.create({ data: { businessId, customerId: customer.id, receiptNumber: `DUAL-${suffix}-${stamp}`, totalKES: 100, subtotalKES: 100, balanceKES: 100, status: "PARTIALLY_PAID" } })));
    await db.posCreditEntry.createMany({ data: sales.map((sale: any) => ({ businessId, partyType: "CUSTOMER", partyId: customer.id, saleId: sale.id, direction: "DEBIT", amountKES: 100, balanceAfterKES: 100 })) });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true; configuration.sales.refunds = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["REFUND_SALE" as const], staffId: null, branchId: null };
    let firstDone!: () => void, releaseFirst!: () => void, secondLock!: () => void;
    const firstReady = new Promise<void>((r) => { firstDone = r; });
    const commitAllowed = new Promise<void>((r) => { releaseFirst = r; });
    const secondReady = new Promise<void>((r) => { secondLock = r; });
    const first = db.$transaction(async (tx: any) => {
      const result = await refundSale({ businessId, configuration, actor, request: { saleId: sales[0].id, amountKES: 60 }, client: tx });
      firstDone(); await commitAllowed; return result;
    }, { timeout: 15000 });
    await firstReady;
    const second = db.$transaction(async (tx: any) => {
      let locks = 0;
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === "$queryRaw") return (...args: any[]) => { if (++locks === 2) secondLock(); return target.$queryRaw(...args); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      return refundSale({ businessId, configuration, actor, request: { saleId: sales[1].id, amountKES: 60 }, client: wrapped });
    }, { timeout: 15000 });
    try { await secondReady; } finally { releaseFirst(); }
    const [a, b] = await Promise.allSettled([first, second]);
    expect(a).toMatchObject({ status: "fulfilled", value: { ok: true, refundedKES: 60 } });
    expect(b.status).toBe("rejected");
    if (b.status === "rejected") expect(b.reason.message).toBe("REFUND_INVALID");
    expect((await db.posCustomer.findFirst({ where: { businessId, id: customer.id } })).balanceKES).toBe(40);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: customer.id, direction: "CREDIT" } })).toBe(1);
  }, 30000);

  it("rechecks the balance after a concurrent repayment commits before a credit refund", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Customer", balanceKES: 100 } });
    const sale = await db.posSale.create({ data: { businessId, customerId: customer.id, receiptNumber: `CR-${stamp}`, totalKES: 100, subtotalKES: 100, paidKES: 0, balanceKES: 100, status: "PARTIALLY_PAID" } });
    await db.posCreditEntry.create({ data: { businessId, partyType: "CUSTOMER", partyId: customer.id, saleId: sale.id, direction: "DEBIT", amountKES: 100, balanceAfterKES: 100 } });
    const configuration = baselineConfiguration();
    configuration.credit.enabled = true;
    configuration.sales.refunds = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const, "REFUND_SALE" as const], staffId: null, branchId: null };
    let repaymentWritten!: () => void, allowCommit!: () => void, refundLockAttempted!: () => void;
    const repaymentReady = new Promise<void>((r) => { repaymentWritten = r; });
    const commitAllowed = new Promise<void>((r) => { allowCommit = r; });
    const refundReady = new Promise<void>((r) => { refundLockAttempted = r; });
    const repayment = db.$transaction(async (tx: any) => {
      const outcome = await recordRepayment({ idempotencyKey: `test-repayment-${customer.id}`, businessId, customerId: customer.id, amountKES: 60, configuration, actor, client: tx });
      expect(outcome.ok).toBe(true);
      repaymentWritten();
      await commitAllowed;
      return outcome;
    }, { timeout: 15000 });
    await repaymentReady;
    const refund = db.$transaction(async (tx: any) => {
      let lockCalls = 0;
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === "$queryRaw") return (...args: any[]) => {
          if (++lockCalls === 2) refundLockAttempted();
          return target.$queryRaw(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return refundSale({ businessId, configuration, actor, request: { saleId: sale.id, amountKES: 60 }, client: wrapped });
    }, { timeout: 15000 });
    try { await refundReady; } finally { allowCommit(); }
    const [paid, reversed] = await Promise.allSettled([repayment, refund]);
    expect(paid).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(reversed.status).toBe("rejected");
    if (reversed.status === "rejected") expect(reversed.reason.message).toBe("REFUND_INVALID");
    expect((await db.posCustomer.findFirst({ where: { businessId, id: customer.id } })).balanceKES).toBe(40);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: customer.id, direction: "CREDIT" } })).toBe(1);
    expect((await db.posSale.findFirst({ where: { businessId, id: sale.id } })).creditRefundedKES).toBe(0);
  }, 30000);
  it("refuses fractional or capped repayments without spending a key or moving money", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Exact amount", balanceKES: 100_000_001 } });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
    const base = { businessId, customerId: customer.id, configuration, actor, idempotencyKey: "exact-amount", amountKES: 100_000_001 };
    expect(await recordRepayment(base)).toMatchObject({ ok: false, code: "REPAYMENT_INVALID" });
    expect(await recordRepayment({ ...base, amountKES: 100.4 })).toMatchObject({ ok: false, code: "REPAYMENT_INVALID" });
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id } })).toBe(0);
    expect(await db.posRepaymentRequest.count({ where: { businessId, customerId: customer.id } })).toBe(0);
    expect((await db.posCustomer.findUnique({ where: { id: customer.id } })).balanceKES).toBe(100_000_001);
    expect(await recordRepayment({ ...base, amountKES: 100 })).toMatchObject({ ok: true, amountKES: 100 });
    expect(await recordRepayment({ ...base, amountKES: 100.4 })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id } })).toBe(1);
  });

  it("serializes simultaneous retries, rejects changed payloads and replays the original result", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Replay customer", balanceKES: 200 } });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
    const base = { businessId, customerId: customer.id, amountKES: 60, configuration, actor, idempotencyKey: "same-retry" };
    const results = await Promise.all([recordRepayment(base), recordRepayment({ ...base, actor: { ...actor, actorId: "another-cashier" } })]);
    expect(results.every((r) => r.ok && r.amountKES === 60 && r.balanceKES === 140)).toBe(true);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id, purpose: "CREDIT_REPAYMENT" } })).toBe(1);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: customer.id } })).toBe(1);
    expect(await db.posRepaymentRequest.count({ where: { businessId, customerId: customer.id } })).toBe(1);
    const request = await db.posRepaymentRequest.findFirstOrThrow({ where: { businessId, customerId: customer.id } });
    await expect(db.posRepaymentRequest.update({ where: { id: request.id }, data: { amountKES: 1 } })).rejects.toThrow();
    await expect(db.posRepaymentRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    await expect(db.posPayment.delete({ where: { id: request.paymentId } })).rejects.toThrow();
    await expect(db.posCustomer.delete({ where: { id: customer.id } })).rejects.toThrow();
    expect((await db.posCustomer.findUnique({ where: { id: customer.id } })).balanceKES).toBe(140);
    expect(await recordRepayment({ ...base, amountKES: 20 })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id, purpose: "CREDIT_REPAYMENT" } })).toBe(1);
    expect(await recordRepayment({ ...base, idempotencyKey: "" })).toMatchObject({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(await recordRepayment({ ...base, idempotencyKey: "second-payment", amountKES: 140 })).toMatchObject({ ok: true, balanceKES: 0 });
    expect(await recordRepayment(base)).toMatchObject({ ok: true, replayed: true, balanceKES: 0, balanceAfterKES: 140 });
    expect((await db.posCustomer.findUnique({ where: { id: customer.id } })).balanceKES).toBe(0);
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id, purpose: "CREDIT_REPAYMENT" } })).toBe(2);
  });

  it("prevents a key from being spent on two different customers in the same business", async () => {
    const customers = await Promise.all(["A", "B"].map((name) => db.posCustomer.create({ data: { businessId, name, balanceKES: 100 } })));
    const configuration = baselineConfiguration(); configuration.credit.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
    const requests = customers.map((customer) => ({ businessId, customerId: customer.id, amountKES: 25, configuration, actor, idempotencyKey: "cross-customer-race" }));
    const results = await Promise.all(requests.map((request) => recordRepayment(request)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => result.code === "IDEMPOTENCY_CONFLICT")).toHaveLength(1);
    expect(await db.posPayment.count({ where: { businessId, customerId: { in: customers.map((customer) => customer.id) } } })).toBe(1);
    expect(await db.posRepaymentRequest.count({ where: { businessId, key: "cross-customer-race" } })).toBe(1);
    const balances = await db.posCustomer.findMany({ where: { id: { in: customers.map((customer) => customer.id) } }, select: { balanceKES: true } });
    expect(balances.map((customer: any) => customer.balanceKES).sort((a: number, b: number) => a - b)).toEqual([75, 100]);
  });

  it("rolls back a forced concurrent cross-customer key collision in caller-owned transactions", async () => {
    const customers = await Promise.all(["C", "D"].map((name) => db.posCustomer.create({ data: { businessId, name, balanceKES: 100 } })));
    const configuration = baselineConfiguration(); configuration.credit.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
    let reads = 0, release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const attempts = customers.map((customer) => db.$transaction(async (tx: any) => {
      const requestModel = new Proxy(tx.posRepaymentRequest, { get(target, key) {
        if (key === "findFirst") return async (...args: any[]) => {
          const result = await target.findFirst(...args);
          if (++reads === 2) release();
          await bothRead;
          return result;
        };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === "posRepaymentRequest") return requestModel;
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      return recordRepayment({ businessId, customerId: customer.id, amountKES: 25, configuration, actor, idempotencyKey: "forced-key-race", client: wrapped });
    }, { timeout: 15000 }));
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.posPayment.count({ where: { businessId, customerId: { in: customers.map((customer) => customer.id) } } })).toBe(1);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: { in: customers.map((customer) => customer.id) } } })).toBe(1);
    expect(await db.posRepaymentRequest.count({ where: { businessId, key: "forced-key-race" } })).toBe(1);
  }, 30000);

  it("rolls back a key and its financial writes together, allowing a genuine retry", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Rollback replay", balanceKES: 100 } });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
    const base = { businessId, customerId: customer.id, amountKES: 40, configuration, actor, idempotencyKey: "retry-after-rollback" };
    await expect(db.$transaction(async (tx: any) => {
      expect((await recordRepayment({ ...base, client: tx })).ok).toBe(true);
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    expect(await db.posRepaymentRequest.count({ where: { businessId, customerId: customer.id } })).toBe(0);
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id } })).toBe(0);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: customer.id } })).toBe(0);
    expect((await db.posCustomer.findUnique({ where: { id: customer.id } })).balanceKES).toBe(100);
    expect(await recordRepayment(base)).toMatchObject({ ok: true, replayed: false, balanceKES: 60 });
  });

  it("aborts payment and key if the balance movement fails inside a caller-owned transaction", async () => {
    const customer = await db.posCustomer.create({ data: { businessId, name: "Missing movement", balanceKES: 100 } });
    const configuration = baselineConfiguration(); configuration.credit.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
    await expect(db.$transaction(async (tx: any) => {
      const customerModel = new Proxy(tx.posCustomer, { get(target, key) {
        if (key === "updateMany") return async () => ({ count: 0 }); // simulate the guarded write missing its row
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === "posCustomer") return customerModel;
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      return recordRepayment({ businessId, customerId: customer.id, amountKES: 40, configuration, actor, idempotencyKey: "missing-movement", client: wrapped });
    })).rejects.toThrow("REPAYMENT_LEDGER_MISMATCH");
    expect(await db.posPayment.count({ where: { businessId, customerId: customer.id } })).toBe(0);
    expect(await db.posRepaymentRequest.count({ where: { businessId, customerId: customer.id } })).toBe(0);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: customer.id } })).toBe(0);
    expect((await db.posCustomer.findUnique({ where: { id: customer.id } })).balanceKES).toBe(100);
  });

  it("isolates request keys across tenants and never writes to another tenant's customer", async () => {
    const other = await db.business.create({ data: { ownerId, slug: `credit-replay-other-${stamp}`, name: "Other", category: "retail" } });
    try {
      const customerA = await db.posCustomer.create({ data: { businessId, name: "A", balanceKES: 100 } });
      const customerB = await db.posCustomer.create({ data: { businessId: other.id, name: "B", balanceKES: 100 } });
      const configuration = baselineConfiguration(); configuration.credit.enabled = true;
      const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["RECORD_REPAYMENT" as const], staffId: null, branchId: null };
      const base = { amountKES: 25, configuration, actor, idempotencyKey: "same-key" };
      expect((await recordRepayment({ ...base, businessId, customerId: customerA.id })).ok).toBe(true);
      expect(await recordRepayment({ ...base, businessId, customerId: customerB.id })).toMatchObject({ ok: false, code: "CUSTOMER_NOT_FOUND" });
      expect((await recordRepayment({ ...base, businessId: other.id, customerId: customerB.id })).ok).toBe(true);
      expect(await db.posRepaymentRequest.count({ where: { key: "same-key", businessId: { in: [businessId, other.id] } } })).toBe(2);
      const foreignPayment = await db.posPayment.findFirstOrThrow({ where: { businessId: other.id, customerId: customerB.id } });
      await expect(db.posRepaymentRequest.create({ data: { businessId, customerId: customerA.id, key: "forged-payment", requestHash: "x", paymentId: foreignPayment.id, amountKES: 25, balanceAfterKES: 75 } })).rejects.toThrow();
      await expect(db.posRepaymentRequest.create({ data: { businessId, customerId: customerB.id, key: "forged-customer", requestHash: "x", paymentId: foreignPayment.id, amountKES: 25, balanceAfterKES: 75 } })).rejects.toThrow();
    } finally { await db.business.delete({ where: { id: other.id } }); }
  });

});
