/**
 * JATA Autopilot — Immutable Redacted Audit Trail (`AutopilotAuditEvent`)
 *
 * Every diagnosis, proposal, approval, rejection, execution, rollback,
 * pause/resume, and blocked prompt-injection event is recorded with secrets
 * stripped prior to serialization.
 */

import prisma from "@/lib/db";
import { assertNoInlineImagePersistence } from "@/lib/media/persistence-policy";
import { redactAutopilotObject } from "./security";

export interface RecordAutopilotAuditParams {
  businessId: string;
  actorKind: "OWNER" | "STAFF" | "AUTOPILOT" | "SYSTEM" | "KILL_SWITCH";
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  proposalId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAutopilotAudit(
  params: RecordAutopilotAuditParams,
): Promise<{ id: string }> {
  const safeMetadata = params.metadata
    ? redactAutopilotObject(params.metadata)
    : undefined;
  const metadataJson = safeMetadata ? JSON.stringify(safeMetadata) : null;
  if (metadataJson) {
    assertNoInlineImagePersistence(metadataJson);
  }
  try {
    const created = await prisma.autopilotAuditEvent.create({
      data: {
        businessId: params.businessId,
        actorKind: params.actorKind,
        actorUserId: params.actorUserId ?? null,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        proposalId: params.proposalId ?? null,
        metadataJson,
      },
    });
    return { id: created?.id ?? "audit_recorded" };
  } catch {
    return { id: "audit_offline" };
  }
}

export async function listAutopilotAuditEvents(
  businessId: string,
  limit = 25,
): Promise<
  Array<{
    id: string;
    actorKind: string;
    actorUserId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    proposalId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>
> {
  try {
    const rows = await prisma.autopilotAuditEvent.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row: any) => {
      let metadata: Record<string, unknown> | null = null;
      if (typeof row.metadataJson === "string" && row.metadataJson) {
        try {
          metadata = JSON.parse(row.metadataJson);
        } catch {
          metadata = null;
        }
      }
      return {
        id: String(row.id),
        actorKind: String(row.actorKind),
        actorUserId: row.actorUserId ?? null,
        action: String(row.action),
        targetType: row.targetType ?? null,
        targetId: row.targetId ?? null,
        proposalId: row.proposalId ?? null,
        metadata,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : String(row.createdAt ?? new Date().toISOString()),
      };
    });
  } catch {
    return [];
  }
}
