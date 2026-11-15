import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { enqueueAutomationEvent } from "@/lib/automation/events";
import { logErpAudit } from "@/lib/erp/audit";

function sourceKey(businessId: string, sourceId: string) {
  return `ai_handoff_${createHash("sha256").update(`${businessId}:${sourceId}`).digest("hex")}`;
}

function eventId(taskId: string) {
  return `ai_handoff_created_${createHash("sha256").update(`ai_front_desk.followup_task.created:v1:${taskId}`).digest("hex")}`;
}

/**
 * Persist an explicit human-handoff request as an internal task and its routing event atomically.
 * The conversation identifier is an opaque source reference, not conversation content or identity.
 */
export async function createAIFrontDeskHandoffTask(input: {
  businessId: string;
  conversationId: string;
}) {
  const businessId = input.businessId.trim();
  const sourceId = input.conversationId.trim().slice(0, 100);
  if (!businessId || !sourceId) throw new Error("AI_HANDOFF_SOURCE_REQUIRED");
  const activeKey = sourceKey(businessId, sourceId);
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true } });
      if (!business) throw new Error("AI_HANDOFF_BUSINESS_NOT_FOUND");
      const active = await tx.erpTask.findFirst({ where: { businessId: business.id, aiHandoffActiveKey: activeKey } });
      if (active) return { task: active, created: false };

      const task = await tx.erpTask.create({ data: {
        businessId: business.id,
        title: "AI Front Desk: human follow-up requested",
        detail: null,
        status: "OPEN",
        priority: "NORMAL",
        assignedRole: "OWNER",
        createdBy: null,
        sourceType: "AI_FRONT_DESK_HANDOFF",
        sourceId,
        aiHandoffActiveKey: activeKey,
        idempotencyKey: null,
      } });

      await logErpAudit({
        businessId: task.businessId,
        actorId: null,
        action: "AI_FRONT_DESK_HANDOFF_TASK_CREATED",
        targetType: "TASK",
        targetId: task.id,
        after: { sourceType: task.sourceType, status: task.status, priority: task.priority },
        client: tx,
      });
      await enqueueAutomationEvent(tx, {
        id: eventId(task.id),
        type: "ai_front_desk.followup_task.created",
        occurredAt: task.createdAt.toISOString(),
        tenantId: task.businessId,
        source: "ai_front_desk",
        data: { businessId: task.businessId, taskId: task.id, purpose: "HUMAN_HANDOFF" },
      });
      return { task, created: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // Unique active-source key resolves concurrent duplicate calls. Return the committed winner only.
    if ((error as { code?: string })?.code === "P2002" || (error as { code?: string })?.code === "P2034") {
      const existing = await prisma.erpTask.findFirst({ where: { businessId, aiHandoffActiveKey: activeKey } });
      if (existing) return { task: existing, created: false };
    }
    throw error;
  }
}
