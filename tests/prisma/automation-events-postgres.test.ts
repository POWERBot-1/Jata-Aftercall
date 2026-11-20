import { afterAll, describe, expect, it } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";

describe.skipIf(!realPrismaConfigured)("automation inbox/outbox PostgreSQL durability and claims", () => {
  const db = realPrismaConfigured ? sharedPrisma() : (null as any);
  const created: string[] = [];
  afterAll(async () => {
    if (db && created.length) await db.automationEvent.deleteMany({ where: { id: { in: created } } });
    await db?.$disconnect().catch(() => {});
  });

  const createOutbox = (eventId: string) => db.automationEvent.create({ data: {
    eventId, tenantId: `tenant_${uid()}`, product: "business_page", eventType: "test.delivery",
    direction: "OUTBOUND", status: "PENDING", payload: { id: eventId, data: { sample: true } },
  } });

  it("persists idempotency with a database unique key", async () => {
    const eventId = `auto_${uid()}`;
    const row = await createOutbox(eventId);
    created.push(row.id);
    await expect(createOutbox(eventId)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows exactly one concurrent worker claim and recovers an expired lease", async () => {
    const row = await createOutbox(`auto_${uid()}`);
    created.push(row.id);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 30_000);
    const claim = () => db.automationEvent.updateMany({
      where: { id: row.id, attempts: 0, OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lt: now } }] },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil },
    });
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.map((result: { count: number }) => result.count).sort()).toEqual([0, 1]);
    const expired = new Date(Date.now() - 1_000);
    await db.automationEvent.update({ where: { id: row.id }, data: { leaseUntil: expired } });
    const recovered = await db.automationEvent.updateMany({
      where: { id: row.id, status: "PROCESSING", leaseUntil: { lt: new Date() } },
      data: { leaseUntil: new Date(Date.now() + 30_000) },
    });
    expect(recovered.count).toBe(1);
  });

  it("persists retry scheduling and terminal failure state", async () => {
    const row = await createOutbox(`auto_${uid()}`);
    created.push(row.id);
    const retryAt = new Date(Date.now() + 5_000);
    const retried = await db.automationEvent.update({ where: { id: row.id }, data: {
      attempts: { increment: 1 }, status: "PENDING", availableAt: retryAt,
      lastError: "HTTP_503", leaseUntil: null,
    } });
    expect(retried.status).toBe("PENDING");
    expect(retried.attempts).toBe(1);
    expect(retried.availableAt.getTime()).toBe(retryAt.getTime());
    const failed = await db.automationEvent.update({ where: { id: row.id }, data: {
      attempts: 8, status: "FAILED", lastError: "RETRY_LIMIT_REACHED", leaseUntil: null,
    } });
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(8);
  });
});
