import { afterAll, describe, expect, it } from "vitest";
import { createAIFrontDeskHandoffTask } from "@/lib/ai-followup";
import { enqueueAutomationEvent } from "@/lib/automation/events";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";

describe.skipIf(!realPrismaConfigured)("AI Front Desk human-handoff task/outbox PostgreSQL acceptance", () => {
  const db = realPrismaConfigured ? sharedPrisma() : (null as any);
  const tenants: Array<{ id: string; ownerId: string }> = [];
  const eventIds: string[] = [];

  afterAll(async () => {
    if (!db) return;
    for (const tenant of tenants) {
      await db.automationEvent.deleteMany({ where: { tenantId: tenant.id } });
      await db.erpAuditEvent.deleteMany({ where: { businessId: tenant.id } });
      await db.erpTask.deleteMany({ where: { businessId: tenant.id } });
      await db.aIConfiguration.deleteMany({ where: { businessId: tenant.id } });
      await db.business.deleteMany({ where: { id: tenant.id } });
      await db.user.deleteMany({ where: { id: tenant.ownerId } });
    }
    if (eventIds.length) await db.automationEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await db.$disconnect().catch(() => {});
  });

  async function tenant() {
    const seeded = await seedBusiness(db);
    tenants.push({ id: seeded.business.id, ownerId: seeded.owner.id });
    return seeded.business;
  }

  it("commits task and minimal tenant-derived outbox event atomically", async () => {
    const business = await tenant();
    const source = `conv-${uid()}`;
    const result = await createAIFrontDeskHandoffTask({ businessId: business.id, conversationId: source });
    const event = await db.automationEvent.findFirst({ where: { tenantId: business.id, eventType: "ai_front_desk.followup_task.created" } });
    expect(result.created).toBe(true);
    expect(result.task).toMatchObject({ businessId: business.id, sourceType: "AI_FRONT_DESK_HANDOFF", sourceId: source, status: "OPEN", priority: "NORMAL", assignedRole: "OWNER" });
    expect(event).toMatchObject({ tenantId: result.task.businessId, product: "ai_front_desk", eventType: "ai_front_desk.followup_task.created", direction: "OUTBOUND", status: "PENDING" });
    expect(event.payload).toMatchObject({ tenantId: business.id, data: { businessId: business.id, taskId: result.task.id, purpose: "HUMAN_HANDOFF" } });
    expect(JSON.stringify(event.payload)).not.toContain(source);
    expect(JSON.stringify(event.payload)).not.toMatch(/phone|email|message|secret|payment/i);
    eventIds.push(event.eventId);
  });

  it("deduplicates sequential and concurrent active handoffs from one conversation", async () => {
    const business = await tenant();
    const source = `conv-${uid()}`;
    const results = await Promise.all([
      createAIFrontDeskHandoffTask({ businessId: business.id, conversationId: source }),
      createAIFrontDeskHandoffTask({ businessId: business.id, conversationId: source }),
    ]);
    const again = await createAIFrontDeskHandoffTask({ businessId: business.id, conversationId: source });
    expect(results[0].task.id).toBe(results[1].task.id);
    expect(again.task.id).toBe(results[0].task.id);
    expect((await db.erpTask.findMany({ where: { businessId: business.id, sourceId: source } })).length).toBe(1);
    expect(await db.automationEvent.count({ where: { tenantId: business.id, eventType: "ai_front_desk.followup_task.created" } })).toBe(1);
  });

  it("isolates source dedupe and events between tenants", async () => {
    const a = await tenant();
    const b = await tenant();
    const source = `conv-${uid()}`;
    const [first, second] = await Promise.all([
      createAIFrontDeskHandoffTask({ businessId: a.id, conversationId: source }),
      createAIFrontDeskHandoffTask({ businessId: b.id, conversationId: source }),
    ]);
    expect(first.task.businessId).toBe(a.id);
    expect(second.task.businessId).toBe(b.id);
    expect(first.task.id).not.toBe(second.task.id);
    expect(await db.automationEvent.count({ where: { tenantId: a.id, payload: { path: ["data", "taskId"], equals: second.task.id } } })).toBe(0);
  });

  it("rolls back a task when outbox validation fails in the same transaction", async () => {
    const business = await tenant();
    const source = `rollback-${uid()}`;
    const key = `rollback-${uid()}`;
    await expect(db.$transaction(async (tx: any) => {
      const task = await tx.erpTask.create({ data: {
        businessId: business.id, title: "Rollback test task", status: "OPEN", priority: "NORMAL",
        sourceType: "AI_FRONT_DESK_HANDOFF", sourceId: source, aiHandoffActiveKey: key,
      } });
      await enqueueAutomationEvent(tx, {
        id: "bad id", type: "invalid", occurredAt: new Date().toISOString(), tenantId: business.id,
        source: "ai_front_desk", data: { taskId: task.id },
      });
    })).rejects.toThrow("AUTOMATION_EVENT_INVALID");
    expect(await db.erpTask.count({ where: { businessId: business.id, sourceId: source } })).toBe(0);
  });

  it("allows a new task after the earlier task reaches a terminal state", async () => {
    const business = await tenant();
    const source = `reopen-${uid()}`;
    const first = await createAIFrontDeskHandoffTask({ businessId: business.id, conversationId: source });
    await db.erpTask.update({ where: { id: first.task.id }, data: { status: "DONE", aiHandoffActiveKey: null, completedAt: new Date() } });
    const second = await createAIFrontDeskHandoffTask({ businessId: business.id, conversationId: source });
    expect(second.created).toBe(true);
    expect(second.task.id).not.toBe(first.task.id);
  });
});
