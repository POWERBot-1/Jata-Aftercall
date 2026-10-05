/**
 * M-PESA STK receipt persistence against the migrated PostgreSQL schema.
 *
 * The callback goes through the same token-authenticated webhook and payment engine as production;
 * no live Safaricom credential or provider connection is used.
 */

import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { applyProviderEvent } from "@/lib/payments/webhooks";

const enabled = Boolean(process.env.DATABASE_URL?.trim());
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const createdUsers: string[] = [];
const createdBusinesses: string[] = [];
const checkoutIds: string[] = [];
const token = `receipt-test-${stamp}`;
const originalToken = process.env.MPESA_CALLBACK_TOKEN;
const originalAllowedIps = process.env.MPESA_ALLOWED_IPS;

async function makeFixture(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wallet-stk-${label}-${stamp}@example.test`,
      name: "STK Receipt Test",
      passwordHash: "not-a-real-login",
    },
  });
  createdUsers.push(user.id);
  const business = await prisma.business.create({
    data: {
      ownerId: user.id,
      slug: `wallet-stk-${label}-${stamp}`,
      name: `STK test ${label}`,
      category: "retail",
    },
  });
  createdBusinesses.push(business.id);
  const destination = await prisma.paymentDestination.create({
    data: {
      businessId: business.id,
      kind: "MPESA_TILL",
      provider: "MPESA",
      providerDestinationId: `4${String(Date.now()).slice(-6)}`,
      providerAccountRef: "",
      currency: "KES",
      capabilities: ["PAYMENT_INSTRUCTIONS", "REAL_TIME_CONFIRMATION", "WEBHOOKS"],
      status: "CONNECTED",
      verificationSource: "LIVE",
      isPrimary: true,
      isActive: true,
    },
  });
  const checkoutId = `ws_CO_${label}_${stamp}`;
  checkoutIds.push(checkoutId);
  const transaction = await prisma.paymentTransaction.create({
    data: {
      jataPaymentId: `JTP-STK-${label}-${stamp}`,
      businessId: business.id,
      destinationId: destination.id,
      provider: "MPESA",
      status: "PENDING",
      providerReference: `JTP-STK-REF-${label}-${stamp}`,
      providerTransactionId: checkoutId,
      idempotencyKey: `wallet-stk-idempotency-${label}-${stamp}`,
      method: "MPESA_STK",
      amountMinor: 35_000,
      amountPaidMinor: 0,
      amountRefundedMinor: 0,
      currency: "KES",
    },
  });
  return { businessId: business.id, transactionId: transaction.id, checkoutId };
}

function callback(fixture: Awaited<ReturnType<typeof makeFixture>>, receipt?: string) {
  const items: Record<string, unknown>[] = [
    { Name: "Amount", Value: 350 },
    { Name: "PhoneNumber", Value: 254712111111 },
  ];
  if (receipt !== undefined) items.push({ Name: "MpesaReceiptNumber", Value: receipt });
  const payload = {
    Body: {
      stkCallback: {
        MerchantRequestID: `merchant-${stamp}`,
        CheckoutRequestID: fixture.checkoutId,
        ResultCode: "0",
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: { Item: items },
      },
    },
  };
  const rawBody = JSON.stringify(payload);
  return {
    provider: "MPESA" as const,
    rawBody,
    payload,
    headers: new Headers(),
    url: new URL(`https://jata.test/api/payments/webhooks/mpesa/stk?token=${token}`),
    client: prisma,
  };
}

describe.skipIf(!enabled)("M-PESA STK receipt persistence against real PostgreSQL", () => {
  afterAll(async () => {
    for (const checkoutId of checkoutIds) {
      await prisma.paymentEvent.deleteMany({ where: { provider: "MPESA", providerEventId: { contains: checkoutId } } }).catch(() => undefined);
    }
    for (const businessId of createdBusinesses) {
      await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
    }
    for (const userId of createdUsers) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    if (originalToken === undefined) delete process.env.MPESA_CALLBACK_TOKEN;
    else process.env.MPESA_CALLBACK_TOKEN = originalToken;
    if (originalAllowedIps === undefined) delete process.env.MPESA_ALLOWED_IPS;
    else process.env.MPESA_ALLOWED_IPS = originalAllowedIps;
  });

  it("persists the provider receipt separately and ignores a conflicting duplicate callback", async () => {
    process.env.MPESA_CALLBACK_TOKEN = token;
    process.env.MPESA_ALLOWED_IPS = "";
    const fixture = await makeFixture("receipt");

    const first = await applyProviderEvent(callback(fixture, "NLJ7RT61SV"));
    expect(first.status).toBe("processed");
    let transaction = await prisma.paymentTransaction.findUnique({ where: { id: fixture.transactionId } });
    expect(transaction?.status).toBe("PAID");
    expect(transaction?.providerTransactionId).toBe(fixture.checkoutId);
    expect(transaction?.providerReceipt).toBe("NLJ7RT61SV");

    const duplicate = await applyProviderEvent(callback(fixture, "ABCD123456"));
    expect(duplicate.status).toBe("already_processed");
    transaction = await prisma.paymentTransaction.findUnique({ where: { id: fixture.transactionId } });
    expect(transaction?.providerTransactionId).toBe(fixture.checkoutId);
    expect(transaction?.providerReceipt).toBe("NLJ7RT61SV");
  });

  it("leaves an STK payment pending and records reconciliation when the receipt is missing", async () => {
    process.env.MPESA_CALLBACK_TOKEN = token;
    process.env.MPESA_ALLOWED_IPS = "";
    const fixture = await makeFixture("missing");

    const result = await applyProviderEvent(callback(fixture));
    expect(result.status).toBe("processed");
    const transaction = await prisma.paymentTransaction.findUnique({ where: { id: fixture.transactionId } });
    expect(transaction?.status).toBe("PENDING");
    expect(transaction?.amountPaidMinor).toBe(0);
    expect(transaction?.providerTransactionId).toBe(fixture.checkoutId);
    expect(transaction?.providerReceipt).toBeNull();
    expect(await prisma.paymentReconciliation.count({
      where: { businessId: fixture.businessId, transactionId: fixture.transactionId, result: "UNCONFIRMED" },
    })).toBe(1);
  });
});
