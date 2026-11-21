import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSubscriptionPaymentLifecycleReport } from "@/lib/admin/subscription-payment-reconciliation-store";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let client: any;
let ownerId = "";
let planId = "";
const businessIds: string[] = [];
const paymentIds: string[] = [];
const subscriptionIds: string[] = [];

describe.skipIf(!enabled)("subscription/payment provenance on PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    const owner = await client.user.create({
      data: { email: `payment-link-${stamp}@example.test`, name: "Payment Link Fixture", passwordHash: "not-a-real-login" },
    });
    ownerId = owner.id;
    const plan = await client.planConfig.create({
      data: { key: `PAYMENT_LINK_FIXTURE_${stamp}`, name: "Payment Link Fixture", priceKES: 499, durationDays: 30, isActive: true },
    });
    planId = plan.id;
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      if (subscriptionIds.length) await client.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
      if (paymentIds.length) await client.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (businessIds.length) await client.business.deleteMany({ where: { id: { in: businessIds } } });
      if (planId) await client.planConfig.delete({ where: { id: planId } }).catch(() => undefined);
      if (ownerId) await client.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    } finally {
      await client.$disconnect?.();
    }
  }, 60_000);

  it("preserves unlinked history and reports only active subscriptions without payment provenance", async () => {
    const paidBusiness = await client.business.create({
      data: { ownerId, slug: `payment-link-paid-${stamp}`, name: "Payment Link Paid", category: "retail" },
    });
    const unpaidBusiness = await client.business.create({
      data: { ownerId, slug: `payment-link-unpaid-${stamp}`, name: "Payment Link Unpaid", category: "retail" },
    });
    businessIds.push(paidBusiness.id, unpaidBusiness.id);

    const reference = `PAYMENT-LINK-${stamp}`;
    const payment = await client.payment.create({
      data: {
        reference, businessId: paidBusiness.id, userId: ownerId, planId,
        amount: 49_900, currency: "KES", status: "PAID", purpose: "SUBSCRIPTION",
        environment: "LIVE", reconciliationStatus: "MATCHED",
        providerSettledAt: new Date(), providerSettlementReference: reference,
      },
    });
    paymentIds.push(payment.id);

    const linked = await client.subscription.create({
      data: {
        businessId: paidBusiness.id, userId: ownerId, planId, status: "ACTIVE",
        startAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000),
        paymentId: payment.id, paymentReference: reference,
      },
    });
    subscriptionIds.push(linked.id);

    const historical = await client.subscription.create({
      data: {
        businessId: unpaidBusiness.id, userId: ownerId, planId, status: "ACTIVE",
        startAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    subscriptionIds.push(historical.id);
    expect(historical.paymentId).toBeNull();

    const report = await loadSubscriptionPaymentLifecycleReport(client);
    expect(report.scope).toBe("READ_ONLY_SUBSCRIPTION_PAYMENT_INVENTORY");
    expect(report.findings).not.toContainEqual({
      exception: "ACTIVE_SUBSCRIPTION_WITH_UNPAID_PAYMENT", subscriptionId: linked.id, paymentId: payment.id,
    });
    expect(report.findings).toContainEqual({
      exception: "ACTIVE_SUBSCRIPTION_WITHOUT_PAYMENT", subscriptionId: historical.id,
    });
  }, 60_000);

  it("enforces one subscription per payment and rejects dangling payment IDs", async () => {
    const business = await client.business.create({
      data: { ownerId, slug: `payment-link-constraints-${stamp}`, name: "Payment Link Constraints", category: "retail" },
    });
    businessIds.push(business.id);
    const reference = `PAYMENT-LINK-CONSTRAINT-${stamp}`;
    const payment = await client.payment.create({
      data: { reference, businessId: business.id, userId: ownerId, planId, amount: 49_900, currency: "KES", status: "PAID", purpose: "SUBSCRIPTION" },
    });
    paymentIds.push(payment.id);
    const first = await client.subscription.create({
      data: { businessId: business.id, userId: ownerId, planId, paymentId: payment.id, paymentReference: reference },
    });
    subscriptionIds.push(first.id);

    const secondBusiness = await client.business.create({
      data: { ownerId, slug: `payment-link-duplicate-${stamp}`, name: "Payment Link Duplicate", category: "retail" },
    });
    businessIds.push(secondBusiness.id);
    await expect(client.subscription.create({
      data: { businessId: secondBusiness.id, userId: ownerId, planId, paymentId: payment.id, paymentReference: reference },
    })).rejects.toMatchObject({ code: "P2002" });

    const thirdBusiness = await client.business.create({
      data: { ownerId, slug: `payment-link-dangling-${stamp}`, name: "Payment Link Dangling", category: "retail" },
    });
    businessIds.push(thirdBusiness.id);
    await expect(client.subscription.create({
      data: { businessId: thirdBusiness.id, userId: ownerId, planId, paymentId: `missing-${stamp}`, paymentReference: "missing" },
    })).rejects.toMatchObject({ code: "P2003" });
  }, 60_000);
});
