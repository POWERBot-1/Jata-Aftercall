import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { getAIPackageStatus, syncAIPackageEntitlement } from "@/lib/ai-entitlement";
import { assertAIFrontDeskPricing } from "@/lib/pricing";

/**
 * §2, §3, §49 — the AI Business Front Desk commercial gate, read from a real database.
 *
 * Every other AI Front Desk suite drives the gate through a mocked Prisma client, which proves the
 * logic but not that the plan row, the subscription window and the per-business entitlement row
 * exist in the shape the gate assumes. This suite asks the database itself. It skips without
 * DATABASE_URL (this sandbox cannot generate a Prisma client) and runs in CI, where the workflow
 * migrates and seeds PostgreSQL 16 first.
 *
 * The rule it pins: live AI needs the AI_BUSINESS_FRONT_DESK plan, a current subscription window
 * AND a server-verified payment (or an ACTIVE entitlement row). An active subscription on its own
 * is PENDING — it never serves customers (§49).
 */

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0);
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const created: { userIds: string[]; businessIds: string[]; paymentIds: string[] } = {
  userIds: [],
  businessIds: [],
  paymentIds: [],
};

async function makeOwner(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `ai-entitlement-${label}-${stamp}@example.test`,
      name: `AI entitlement ${label}`,
      passwordHash: "not-a-real-login",
    },
  });
  created.userIds.push(user.id);
  return user;
}

async function makeBusiness(ownerId: string, label: string) {
  const business = await prisma.business.create({
    data: {
      ownerId,
      slug: `ai-entitlement-${label}-${stamp}`,
      name: `AI entitlement ${label}`,
      category: "retail",
    },
  });
  created.businessIds.push(business.id);
  return business;
}

async function subscribe(businessId: string, userId: string, planId: string, opts: { status?: "ACTIVE" | "SUSPENDED"; expiresInDays: number }) {
  await prisma.subscription.create({
    data: {
      businessId,
      userId,
      planId,
      status: opts.status ?? "ACTIVE",
      startAt: new Date(),
      expiresAt: new Date(Date.now() + opts.expiresInDays * 86_400_000),
    },
  });
}

async function recordPaidPayment(businessId: string, userId: string, planId: string, label: string, amountKES: number) {
  const payment = await prisma.payment.create({
    data: {
      reference: `AI-ENT-${label}-${stamp}`,
      businessId,
      userId,
      planId,
      amount: amountKES * 100,
      currency: "KES",
      status: "PAID",
      purpose: "SUBSCRIPTION",
    },
  });
  created.paymentIds.push(payment.id);
  return payment;
}

describe.skipIf(!enabled)("AI Business Front Desk entitlement against real PostgreSQL (§2, §3, §49)", () => {
  afterAll(async () => {
    // Payments first: they reference both the user and the business, and the journey suites run
    // against this same database afterwards.
    for (const id of created.paymentIds) {
      await prisma.payment.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of created.businessIds) {
      await prisma.business.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of created.userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("the canonical AI_BUSINESS_FRONT_DESK plan is KES 499 / 30 days in the database", async () => {
    const plan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });

    expect(plan).not.toBeNull();
    expect(plan?.priceKES).toBe(499);
    expect(plan?.durationDays).toBe(30);
    expect(plan?.isActive).toBe(true);
    expect(() => assertAIFrontDeskPricing(plan)).not.toThrow();
  });

  it("an AI-plan subscriber with a verified payment is entitled; another package is not", async () => {
    const aiPlan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });
    const otherPlan = await prisma.planConfig.findUnique({ where: { key: "INTERACTIVE_BUSINESS" } });
    expect(aiPlan).not.toBeNull();
    expect(otherPlan).not.toBeNull();

    // A business on the AI package: current window + server-verified payment.
    const owner = await makeOwner("paid");
    const aiBusiness = await makeBusiness(owner.id, "paid");
    await subscribe(aiBusiness.id, owner.id, aiPlan!.id, { expiresInDays: 30 });
    await recordPaidPayment(aiBusiness.id, owner.id, aiPlan!.id, "paid", 499);

    const entitled = await getAIPackageStatus(aiBusiness.id);
    expect(entitled.entitled).toBe(true);
    expect(entitled.status).toBe("ACTIVE");
    expect(entitled.priceKES).toBe(499);
    expect(entitled.billingCycleDays).toBe(30);
    expect(entitled.packageKey).toBe("AI_BUSINESS_FRONT_DESK");

    // The same shape of subscription on a different package never unlocks the AI Front Desk.
    const otherOwner = await makeOwner("other");
    const otherBusiness = await makeBusiness(otherOwner.id, "other");
    await subscribe(otherBusiness.id, otherOwner.id, otherPlan!.id, { expiresInDays: 30 });
    await recordPaidPayment(otherBusiness.id, otherOwner.id, otherPlan!.id, "other", 999);

    const wrongPackage = await getAIPackageStatus(otherBusiness.id);
    expect(wrongPackage.entitled).toBe(false);
    expect(wrongPackage.status).toBe("NONE");
  });

  it("an active AI subscription without a verified payment is not entitled", async () => {
    const aiPlan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });
    const owner = await makeOwner("unpaid");
    const business = await makeBusiness(owner.id, "unpaid");
    await subscribe(business.id, owner.id, aiPlan!.id, { expiresInDays: 30 });
    // No payment row at all: the window is current but nothing has been server-verified.

    const status = await getAIPackageStatus(business.id);
    expect(status.entitled).toBe(false);
    expect(status.active).toBe(false);
    expect(status.status).toBe("PENDING");
  });

  it("expiry and suspension revoke an entitlement that was previously granted", async () => {
    const aiPlan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });
    const owner = await makeOwner("expiring");
    const business = await makeBusiness(owner.id, "expiring");
    await subscribe(business.id, owner.id, aiPlan!.id, { expiresInDays: 30 });
    await recordPaidPayment(business.id, owner.id, aiPlan!.id, "expiring", 499);

    expect((await getAIPackageStatus(business.id)).entitled).toBe(true);

    // The window lapses.
    await prisma.subscription.update({
      where: { businessId: business.id },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });
    const expired = await getAIPackageStatus(business.id);
    expect(expired.entitled).toBe(false);
    expect(expired.status).toBe("EXPIRED");

    // The window is restored but the subscription is suspended by the platform.
    await prisma.subscription.update({
      where: { businessId: business.id },
      data: { status: "SUSPENDED", expiresAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    const suspended = await getAIPackageStatus(business.id);
    expect(suspended.entitled).toBe(false);
    expect(suspended.status).toBe("SUSPENDED");
  });

  it("sync writes the entitlement row for the entitled tenant only", async () => {
    const aiPlan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });
    const owner = await makeOwner("sync");
    const entitledBusiness = await makeBusiness(owner.id, "sync-a");
    const unpaidBusiness = await makeBusiness(owner.id, "sync-b");

    await subscribe(entitledBusiness.id, owner.id, aiPlan!.id, { expiresInDays: 30 });
    await recordPaidPayment(entitledBusiness.id, owner.id, aiPlan!.id, "sync", 499);

    await syncAIPackageEntitlement(entitledBusiness.id);
    await syncAIPackageEntitlement(unpaidBusiness.id);

    const entitledRow = await prisma.aIPackageEntitlement.findUnique({
      where: { businessId: entitledBusiness.id },
    });
    const unpaidRow = await prisma.aIPackageEntitlement.findUnique({
      where: { businessId: unpaidBusiness.id },
    });

    expect(entitledRow?.status).toBe("ACTIVE");
    expect(entitledRow?.packageKey).toBe("AI_BUSINESS_FRONT_DESK");
    expect(unpaidRow?.status ?? "PENDING").not.toBe("ACTIVE");

    // Re-reading through the gate agrees with the rows that were written.
    expect((await getAIPackageStatus(entitledBusiness.id)).entitled).toBe(true);
    expect((await getAIPackageStatus(unpaidBusiness.id)).entitled).toBe(false);
  });
});
