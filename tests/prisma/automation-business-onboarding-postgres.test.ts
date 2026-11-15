import { afterAll, describe, expect, it } from "vitest";
import { createBusinessWithOnboardingEvent } from "@/lib/automation/business-onboarding";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";

describe.skipIf(!realPrismaConfigured)("Business Page onboarding transaction-coupled automation producer", () => {
  const db = realPrismaConfigured ? sharedPrisma() : (null as any);
  const businessIds: string[] = [];
  const eventIds: string[] = [];
  const ownerIds: string[] = [];
  afterAll(async () => {
    if (db) {
      if (eventIds.length) await db.automationEvent.deleteMany({ where: { eventId: { in: eventIds } } });
      if (businessIds.length) await db.business.deleteMany({ where: { id: { in: businessIds } } });
      if (ownerIds.length) await db.user.deleteMany({ where: { id: { in: ownerIds } } });
      await db.$disconnect().catch(() => {});
    }
  });

  async function createOnboardedBusiness() {
    const key = uid();
    const owner = await db.user.create({ data: {
      email: `automation-owner-${key}@test.invalid`, name: "Synthetic owner", passwordHash: "test-only", role: "CUSTOMER",
    } });
    ownerIds.push(owner.id);
    const business = await db.$transaction(async (tx: any) => {
      return createBusinessWithOnboardingEvent(tx, {
        ownerId: owner.id, slug: `automation-${key}`, name: "Synthetic business", category: "Other", theme: "clean",
        members: { create: { userId: owner.id, role: "OWNER" } },
      });
    });
    businessIds.push(business.id);
    const eventId = `business_created_${business.id}`;
    eventIds.push(eventId);
    return { owner, business, eventId };
  }

  it("commits onboarding, owner membership and one tenant-bound outbox event together", async () => {
    const { owner, business, eventId } = await createOnboardedBusiness();
    const [member, event] = await Promise.all([
      db.businessMember.findUnique({ where: { userId_businessId: { userId: owner.id, businessId: business.id } } }),
      db.automationEvent.findUnique({ where: { eventId } }),
    ]);
    expect(member?.role).toBe("OWNER");
    expect(event).toMatchObject({ tenantId: business.id, product: "business_page", eventType: "business.created", direction: "OUTBOUND", status: "PENDING" });
    expect(event.payload).toMatchObject({ id: eventId, tenantId: business.id, source: "business_page", data: { businessId: business.id } });
    const otherTenant = `other_${uid()}`;
    expect(await db.automationEvent.findMany({ where: { tenantId: otherTenant, eventId } })).toHaveLength(0);
  });

  it("rolls back the business and membership when outbox insertion fails", async () => {
    const key = uid();
    const owner = await db.user.create({ data: {
      email: `automation-rollback-${key}@test.invalid`, name: "Synthetic owner", passwordHash: "test-only", role: "CUSTOMER",
    } });
    ownerIds.push(owner.id);
    const businessId = `rollback_${key}`;
    const duplicateEventId = `business_created_${businessId}`;
    eventIds.push(duplicateEventId);
    await db.automationEvent.create({ data: {
      eventId: duplicateEventId, tenantId: `tenant_${key}`, product: "business_page", eventType: "business.created",
      direction: "OUTBOUND", status: "PENDING", payload: { id: duplicateEventId },
    } });
    businessIds.push(businessId);
    await expect(db.$transaction((tx: any) => createBusinessWithOnboardingEvent(tx, {
      id: businessId, ownerId: owner.id, slug: `rollback-${key}`, name: "Must roll back", category: "Other", theme: "clean",
      members: { create: { userId: owner.id, role: "OWNER" } },
    }))).rejects.toMatchObject({ code: "P2002" });
    expect(await db.business.findUnique({ where: { id: businessId } })).toBeNull();
    expect(await db.businessMember.findUnique({ where: { userId_businessId: { userId: owner.id, businessId } } })).toBeNull();
    expect(await db.automationEvent.count({ where: { eventId: duplicateEventId } })).toBe(1);
  });

  it("uses a stable business-derived event key so onboarding retries resolve to one event", async () => {
    const { business, eventId } = await createOnboardedBusiness();
    expect(eventId).toBe(`business_created_${business.id}`);
    const [businessCount, eventCount] = await Promise.all([
      db.business.count({ where: { id: business.id } }),
      db.automationEvent.count({ where: { eventId, tenantId: business.id } }),
    ]);
    expect(businessCount).toBe(1);
    expect(eventCount).toBe(1);
  });
});
