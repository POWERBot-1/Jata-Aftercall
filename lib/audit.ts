import prisma from "./db";

export async function logAudit(params: {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: params.actorId || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    });
  } catch {
    // Audit must not fail an otherwise successful registration or other write.
    console.error("audit write failed");
  }
}
