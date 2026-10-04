/**
 * Payment Wallet refund atomicity against real PostgreSQL.
 *
 * This suite deliberately uses the real generated Prisma client and database row locks. In the
 * race regression, the first request is held inside provider I/O after its reservation commits;
 * a second independent request must observe that committed reservation before the first provider
 * call returns. It is not an in-memory or serialized-call concurrency simulation.
 */

import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { requestRefund } from "@/lib/payments/refunds";

const enabled = Boolean(process.env.DATABASE_URL?.trim());
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const ownerIds: string[] = [];
const businessIds: string[] = [];
const originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY;

const ownerActor = (actorId: string) => ({
  actorId,
  actorName: "Refund Test Owner",
  roleKey: "OWNER",
  permissions: ["REFUND_PAYMENT"],
  confirmed: true,
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function paystackResponse(ok = true, id = "refund-test-provider-id") {
  return new Response(JSON.stringify(ok
    ? { status: true, data: { id } }
    : { status: false, message: "Refund refused by test provider." }), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
}

async function makeFixture(label: string, paidMinor = 10_000) {
  const user = await prisma.user.create({
    data: {
      email: `wallet-refund-${label}-${stamp}@example.test`,
      name: "Refund Test Owner",
      passwordHash: "not-a-real-login",
    },
  });
  ownerIds.push(user.id);
  const business = await prisma.business.create({
    data: {
      ownerId: user.id,
      slug: `wallet-refund-${label}-${stamp}`,
      name: `Refund test ${label}`,
      category: "retail",
    },
  });
  businessIds.push(business.id);
  const transaction = await prisma.paymentTransaction.create({
    data: {
      jataPaymentId: `JTP-REFUND-${label}-${stamp}`,
      businessId: business.id,
      provider: "PAYSTACK",
      status: "PAID",
      providerReference: `wallet-refund-reference-${label}-${stamp}`,
      providerTransactionId: `wallet-refund-provider-id-${label}-${stamp}`,
      idempotencyKey: `wallet-refund-idempotency-${label}-${stamp}`,
      method: "PAYSTACK_CHECKOUT",
      amountMinor: paidMinor,
      amountPaidMinor: paidMinor,
      amountRefundedMinor: 0,
      currency: "KES",
    },
  });
  return { userId: user.id, businessId: business.id, transactionId: transaction.id, paidMinor };
}

async function request(fixture: Awaited<ReturnType<typeof makeFixture>>, amountKES: number, fetchImpl: typeof fetch, actor = ownerActor(fixture.userId)) {
  return requestRefund({
    businessId: fixture.businessId,
    transactionId: fixture.transactionId,
    amountKES,
    reason: "Customer requested refund",
    actor,
    fetchImpl,
  });
}

async function checkInvariant(transactionId: string, paidMinor: number) {
  const [transaction, completedRows, reservations] = await Promise.all([
    prisma.paymentTransaction.findUnique({ where: { id: transactionId } }),
    prisma.refund.aggregate({ where: { transactionId, status: "COMPLETED" }, _sum: { amountMinor: true } }),
    prisma.refund.aggregate({
      where: { transactionId, status: { in: ["REQUESTED", "PENDING_PROVIDER"] } },
      _sum: { amountMinor: true },
    }),
  ]);
  const completed = Number(completedRows._sum.amountMinor ?? 0);
  const outstanding = Number(reservations._sum.amountMinor ?? 0);
  expect(completed + outstanding).toBeLessThanOrEqual(paidMinor);
  expect(Number(transaction?.amountRefundedMinor ?? 0)).toBe(completed);
  return { transaction, completed, outstanding };
}

describe.skipIf(!enabled)("Payment Wallet refund reservation with real PostgreSQL", () => {
  afterAll(async () => {
    for (const businessId of businessIds) {
      await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
    }
    for (const ownerId of ownerIds) {
      await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    }
    if (originalPaystackSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret;
  });

  it("rejects the competing full-balance request while the first provider call is still in flight", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_refund_atomicity";
    const fixture = await makeFixture("race");
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<void>();
    let firstProviderCalls = 0;
    let secondProviderCalls = 0;
    const firstFetch = (async () => {
      firstProviderCalls += 1;
      providerStarted.resolve();
      await releaseProvider.promise;
      return paystackResponse(true, `refund-${stamp}-first`);
    }) as unknown as typeof fetch;

    const firstPromise = request(fixture, 100, firstFetch);
    try {
      // Reaching provider I/O proves the first request's database reservation has committed.
      await providerStarted.promise;
      const second = await request(fixture, 100, (async () => {
        secondProviderCalls += 1;
        return paystackResponse(true, `refund-${stamp}-second`);
      }) as unknown as typeof fetch);

      expect(second).toMatchObject({ ok: false, code: "AMOUNT_TOO_HIGH" });
      expect(secondProviderCalls).toBe(0);
      const { outstanding } = await checkInvariant(fixture.transactionId, fixture.paidMinor);
      expect(outstanding).toBe(10_000);
    } finally {
      releaseProvider.resolve();
    }

    const first = await firstPromise;
    expect(first).toMatchObject({ ok: true, amountKES: 100, remainingKES: 0, status: "COMPLETED" });
    expect(firstProviderCalls).toBe(1);
    const { transaction, outstanding } = await checkInvariant(fixture.transactionId, fixture.paidMinor);
    expect(outstanding).toBe(0);
    expect(transaction?.amountRefundedMinor).toBe(10_000);
    expect(transaction?.status).toBe("FULLY_REFUNDED");
    expect(await prisma.refund.count({ where: { transactionId: fixture.transactionId, status: "COMPLETED" } })).toBe(1);
  });

  it("permits sequential partial refunds up to the paid amount and rejects a fully refunded payment", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_refund_sequential";
    const fixture = await makeFixture("sequential");
    let providerCall = 0;
    const fetchImpl = (async () => paystackResponse(true, `refund-${stamp}-${++providerCall}`)) as unknown as typeof fetch;

    const first = await request(fixture, 40, fetchImpl);
    expect(first).toMatchObject({ ok: true, amountKES: 40, remainingKES: 60 });
    const second = await request(fixture, 60, fetchImpl);
    expect(second).toMatchObject({ ok: true, amountKES: 60, remainingKES: 0 });
    const over = await request(fixture, 1, fetchImpl);
    expect(over).toMatchObject({ ok: false, code: "NOT_REFUNDABLE" });

    const { transaction, outstanding } = await checkInvariant(fixture.transactionId, fixture.paidMinor);
    expect(transaction?.amountRefundedMinor).toBe(10_000);
    expect(transaction?.status).toBe("FULLY_REFUNDED");
    expect(outstanding).toBe(0);
    expect(providerCall).toBe(2);
  });

  it("releases a reservation after a definitive provider failure so it can be refunded later", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_refund_failure";
    const fixture = await makeFixture("failure");
    const failed = await request(fixture, 100, (async () => paystackResponse(false)) as unknown as typeof fetch);
    expect(failed).toMatchObject({ ok: false, code: "PAYSTACK_REFUND_FAILED" });

    const afterFailure = await checkInvariant(fixture.transactionId, fixture.paidMinor);
    expect(afterFailure.outstanding).toBe(0);
    expect(afterFailure.transaction?.amountRefundedMinor).toBe(0);
    expect(await prisma.refund.count({ where: { transactionId: fixture.transactionId, status: "FAILED" } })).toBe(1);

    const succeeded = await request(fixture, 100, (async () => paystackResponse(true, `refund-${stamp}-retry`)) as unknown as typeof fetch);
    expect(succeeded).toMatchObject({ ok: true, remainingKES: 0 });
    const afterSuccess = await checkInvariant(fixture.transactionId, fixture.paidMinor);
    expect(afterSuccess.transaction?.amountRefundedMinor).toBe(10_000);
    expect(afterSuccess.outstanding).toBe(0);
  });

  it("keeps refund permission, reason and tenant checks mandatory", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_refund_authorization";
    const fixture = await makeFixture("authorization");
    const fetchImpl = (async () => paystackResponse()) as unknown as typeof fetch;
    const noPermission = await request(fixture, 1, fetchImpl, {
      ...ownerActor(fixture.userId),
      permissions: ["VIEW_PAYMENTS"],
    });
    expect(noPermission).toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    const noReason = await requestRefund({
      businessId: fixture.businessId,
      transactionId: fixture.transactionId,
      amountKES: 1,
      reason: " ",
      actor: ownerActor(fixture.userId),
      fetchImpl,
    });
    expect(noReason).toMatchObject({ ok: false, code: "REASON_REQUIRED" });

    const foreignTenant = await requestRefund({
      businessId: `not-${fixture.businessId}`,
      transactionId: fixture.transactionId,
      amountKES: 1,
      reason: "Attempt across tenants",
      actor: ownerActor(fixture.userId),
      fetchImpl,
    });
    expect(foreignTenant).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await prisma.refund.count({ where: { transactionId: fixture.transactionId } })).toBe(0);
  });
});
