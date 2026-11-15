import { afterAll, describe, expect, it } from "vitest";
import { createEnquiry, enquiryAutomationEventId, type ValidatedEnquiry } from "@/lib/business-hub/enquiries";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";

describe.skipIf(!realPrismaConfigured)("Business Page enquiry/outbox PostgreSQL atomicity and isolation", () => {
  const db = realPrismaConfigured ? sharedPrisma() : (null as any);
  const businesses: { id: string; ownerId: string }[] = [];
  const eventIds = new Set<string>();

  afterAll(async () => {
    if (!db) return;
    for (const business of businesses) {
      await db.automationEvent.deleteMany({ where: { tenantId: business.id } });
      await db.customerEnquiry.deleteMany({ where: { businessId: business.id } });
      await db.businessHubActivity.deleteMany({ where: { businessId: business.id } });
      await db.business.deleteMany({ where: { id: business.id } });
      await db.user.deleteMany({ where: { id: business.ownerId } });
    }
    if (eventIds.size) await db.automationEvent.deleteMany({ where: { eventId: { in: [...eventIds] } } });
    await db.$disconnect().catch(() => {});
  });

  async function tenant() {
    const seeded = await seedBusiness(db, { isPublished: true, status: "ACTIVE" });
    businesses.push({ id: seeded.business.id, ownerId: seeded.owner.id });
    return seeded.business;
  }

  function input(requestKey: string, message = "Please send the menu."): ValidatedEnquiry {
    return {
      requestKey, customerName: "Synthetic Customer", contactMethod: "EMAIL", contactValue: "synthetic@example.test",
      subject: "Question", message,
    };
  }

  function submit(businessId: string, requestKey: string) {
    return createEnquiry({ businessId, input: input(requestKey), source: "BUSINESS_PAGE" });
  }

  it("commits enquiry and minimal tenant-bound event together", async () => {
    const business = await tenant();
    const key = `commit-${uid()}`;
    const result = await submit(business.id, key);
    const eventId = enquiryAutomationEventId(business.id, key);
    eventIds.add(eventId);
    const event = await db.automationEvent.findUnique({ where: { eventId } });
    expect(result.idempotent).toBe(false);
    expect(result.record.businessId).toBe(business.id);
    expect(event).toMatchObject({ tenantId: result.record.businessId, product: "business_page", eventType: "enquiry.created", direction: "OUTBOUND", status: "PENDING" });
    expect(event.payload).toMatchObject({ id: eventId, tenantId: business.id, data: { businessId: business.id, enquiryId: result.record.id, reference: result.record.reference } });
    expect(JSON.stringify(event.payload)).not.toContain("Synthetic Customer");
    expect(JSON.stringify(event.payload)).not.toContain("synthetic@example.test");
    expect(JSON.stringify(event.payload)).not.toContain("Please send the menu");
  });

  it("rolls back the enquiry when the deterministic outbox key cannot be inserted", async () => {
    const business = await tenant();
    const key = `outbox-failure-${uid()}`;
    const eventId = enquiryAutomationEventId(business.id, key);
    eventIds.add(eventId);
    await db.automationEvent.create({ data: {
      eventId, tenantId: business.id, product: "business_page", eventType: "enquiry.created",
      direction: "OUTBOUND", status: "PENDING", payload: { id: eventId, tenantId: business.id, source: "business_page", data: {} },
    } });
    await expect(submit(business.id, key)).rejects.toMatchObject({ code: "P2002" });
    expect(await db.customerEnquiry.count({ where: { businessId: business.id, requestKey: key } })).toBe(0);
    expect(await db.automationEvent.count({ where: { eventId } })).toBe(1);
  });

  it("binds each producer to its persisted business and cannot leak across tenants", async () => {
    const first = await tenant();
    const second = await tenant();
    const key = `isolation-${uid()}`;
    const [a, b] = await Promise.all([submit(first.id, key), submit(second.id, key)]);
    const eventA = await db.automationEvent.findUnique({ where: { eventId: enquiryAutomationEventId(first.id, key) } });
    const eventB = await db.automationEvent.findUnique({ where: { eventId: enquiryAutomationEventId(second.id, key) } });
    eventIds.add(enquiryAutomationEventId(first.id, key));
    eventIds.add(enquiryAutomationEventId(second.id, key));
    expect(a.record.businessId).toBe(first.id);
    expect(b.record.businessId).toBe(second.id);
    expect(eventA.tenantId).toBe(first.id);
    expect(eventA.payload.data.businessId).toBe(first.id);
    expect(eventB.tenantId).toBe(second.id);
    expect(eventB.payload.data.businessId).toBe(second.id);
    expect(await db.automationEvent.count({ where: { tenantId: first.id, eventId: eventB.eventId } })).toBe(0);
  });

  it("repeated processing returns the existing enquiry and does not duplicate its event", async () => {
    const business = await tenant();
    const key = `repeat-${uid()}`;
    const first = await submit(business.id, key);
    const second = await submit(business.id, key);
    const eventId = enquiryAutomationEventId(business.id, key);
    eventIds.add(eventId);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(await db.customerEnquiry.count({ where: { businessId: business.id, requestKey: key } })).toBe(1);
    expect(await db.automationEvent.count({ where: { eventId, tenantId: business.id } })).toBe(1);
  });

  it("concurrent duplicate submissions commit one enquiry and one outbox event", async () => {
    const business = await tenant();
    const key = `concurrent-${uid()}`;
    const results = await Promise.all([submit(business.id, key), submit(business.id, key)]);
    const eventId = enquiryAutomationEventId(business.id, key);
    eventIds.add(eventId);
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true]);
    expect(results[0].record.id).toBe(results[1].record.id);
    expect(await db.customerEnquiry.count({ where: { businessId: business.id, requestKey: key } })).toBe(1);
    expect(await db.automationEvent.count({ where: { eventId, tenantId: business.id } })).toBe(1);
  });

  it("keeps existing outbox claim, lease recovery, retry and terminal failure semantics", async () => {
    const business = await tenant();
    const key = `recovery-${uid()}`;
    const result = await submit(business.id, key);
    const eventId = enquiryAutomationEventId(business.id, key);
    eventIds.add(eventId);
    const row = await db.automationEvent.findUnique({ where: { eventId } });
    const now = new Date();
    const claim = () => db.automationEvent.updateMany({
      where: { id: row.id, attempts: 0, OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lt: now } }] },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 30_000) },
    });
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.map((value: { count: number }) => value.count).sort()).toEqual([0, 1]);
    await db.automationEvent.update({ where: { id: row.id }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
    expect((await db.automationEvent.updateMany({
      where: { id: row.id, status: "PROCESSING", leaseUntil: { lt: new Date() } },
      data: { leaseUntil: new Date(Date.now() + 30_000) },
    })).count).toBe(1);
    const retryAt = new Date(Date.now() + 5_000);
    const retry = await db.automationEvent.update({ where: { id: row.id }, data: { status: "PENDING", availableAt: retryAt, leaseUntil: null, lastError: "HTTP_503" } });
    expect(retry.status).toBe("PENDING");
    const failed = await db.automationEvent.update({ where: { id: row.id }, data: { status: "FAILED", attempts: 8, lastError: "RETRY_LIMIT_REACHED", leaseUntil: null } });
    expect(failed.status).toBe("FAILED");
    expect(result.record.businessId).toBe(business.id);
  });
});
