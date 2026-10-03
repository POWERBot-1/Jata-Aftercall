import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { getAIPackageStatus, syncAIPackageEntitlement } from "@/lib/ai-entitlement";
import { assertAIFrontDeskPricing } from "@/lib/pricing";

/**
 * §2, §3, §49 — the AI Business Front Desk commercial gate, read from a real database.
 *
 * Every other AI Front Desk suite drives the gate with a mocked Prisma client, which proves the
 * logic but cannot prove that the rows, the plan and the tenant scoping it depends on exist in the
 * shape the code assumes. This suite asks the database itself. It skips without DATABASE_URL (the
 * sandbox cannot generate a Prisma client) and runs in CI, where the workflow migrates and seeds
 * PostgreSQL 16 before running it.
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

describe.skipIf(!enabled)("AI Business Front Desk entitlement against real PostgreSQL (§2, §3, §49)", () => {
  afterAll(async () => {
    // Payments are deleted first: they reference both the user and the business, and the journey
    // suites run against this same database afterwards.
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

  it("a current subscription on the AI plan is entitled; another package is not", async () => {
    const aiPlan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });
    const otherPlan = await prisma.planConfig.findUnique({ where: { key: "INTERACTIVE_BUSINESS" } });
    expect(aiPlan).not.toBeNull();
    expect(otherPlan).not.toBeNull();

    const owner = await makeOwner("paid");
    const aiBusiness = await makeBusiness(owner.id, "paid");
    const otherOwner = await makeOwner("other");
    const otherBusiness = await makeBusiness(otherOwner.id, "other");

    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    await prisma.subscription.create({
      data: {
        businessId: aiBusiness.id,
        userId: owner.id,
        planId: aiPlan!.id,
        status: "ACTIVE",
        startAt: new Date(),
        expiresAt,
      },
    });
    await prisma.subscription.create({
      data: {
        businessId: otherBusiness.id,
        userId: otherOwner.id,
        planId: otherPlan!.id,
        status: "ACTIVE",
        startAt: new Date(),
        expiresAt,
      },
    });

    const payment = await prisma.payment.create({
      data: {
        reference: `AI-ENT-${stamp}`,
        businessId: aiBusiness.id,
        userId: owner.id,
        planId: aiPlan!.id,
        amount: 49900,
        currency: "KES",
        status: "PAID",
        purpose: "SUBSCRIPTION",
      },
    });
    created.paymentIds.push(payment.id);

    const entitled = await getAIPackageStatus(aiBusiness.id);
    expect(entitled.entitled).toBe(true);
    expect(entitled.status).toBe("ACTIVE");
    expect(entitled.priceKES).toBe(499);
    expect(entitled.billingCycleDays).toBe(30);
    expect(entitled.packageKey).toBe("AI_BUSINESS_FRONT_DESK");

    // A business paying for a different package never unlocks the AI Front Desk.
    const wrongPackage = await getAIPackageStatus(otherBusiness.id);
    expect(wrongPackage.entitled).toBe(false);
    expect(wrongPackage.status).toBe("NONE");
  });

  it("expiry and suspension revoke the entitlement", async () => {
    const aiPlan = await prisma.planConfig.findUnique({ where: { key: "AI_BUSINESS_FRONT_DESK" } });
    const owner = await makeOwner("expiring");
    const business = await makeBusiness(owner.id, "expiring");

    await prisma.subscription.create({
      data: {
        businessId: business.id,
        userId: owner.id,
        planId: aiPlan!.id,
        status: "ACTIVE",
        startAt: new Date(Date.now() - 60 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });

    const expired = await getAIPackageStatus(business.id);
    expect(expired.entitled).toBe(false);
    expect(expired.status).toBe("EXPIRED");

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

    await prisma.subscription.create({
      data: {
        businessId: entitledBusiness.id,
        userId: owner.id,
        planId: aiPlan!.id,
        status: "ACTIVE",
        startAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

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

    // Re-reading through the gate still agrees with the rows that were written.
    expect((await getAIPackageStatus(entitledBusiness.id)).entitled).toBe(true);
    expect((await getAIPackageStatus(unpaidBusiness.id)).entitled).toBe(false);
  });
});
