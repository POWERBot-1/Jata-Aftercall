import type { PrismaClient } from "@prisma/client";

/** Reauthorize only a proven no-message rejection. Never replay uncertain or accepted sends. */
export async function replayAdminNotification(db: PrismaClient, input: { applicationId: string; recipientKey: string; actorId: string; requestId: string }) {
  return db.$transaction(async (tx) => {
    const { applicationId, recipientKey, actorId, requestId } = input;
    const users = await tx.$queryRaw<Array<{ role: string }>>`SELECT "role" FROM "User" WHERE "id" = ${actorId} FOR SHARE`;
    if (users.length !== 1 || users[0].role !== "ADMIN") return "forbidden" as const;
    const rows = await tx.$queryRaw<Array<{ state: string; attempts: number }>>`SELECT "state", "attempts" FROM "AgentAdminNotificationClaimState" WHERE "applicationId" = ${applicationId} AND "recipientKey" = ${recipientKey} FOR UPDATE`;
    if (!rows.length) return "not_found" as const;
    const prior = await tx.$queryRaw<Array<{ applicationId: string; recipientKey: string; actorId: string }>>`SELECT "applicationId", "recipientKey", "actorId" FROM "AgentAdminNotificationReplay" WHERE "requestId" = ${requestId}`;
    if (prior.length) return prior[0].applicationId === applicationId && prior[0].recipientKey === recipientKey && prior[0].actorId === actorId ? "already" as const : "conflict" as const;
    const row = rows[0];
    if (row.state !== "DEAD" || row.attempts >= 15) return "conflict" as const;
    const reviews = await tx.$queryRaw<Array<{ applicationId: string }>>`SELECT "applicationId" FROM "AgentAdminNotificationReview" WHERE "applicationId" = ${applicationId} AND "recipientKey" = ${recipientKey}`;
    if (reviews.length) return "conflict" as const;
    // Require durable evidence for the exact latest attempt; legacy DEAD rows without evidence fail closed.
    const evidence = await tx.$queryRaw<Array<{ outcome: string }>>`SELECT "outcome" FROM "AgentAdminNotificationAttempt" WHERE "applicationId" = ${applicationId} AND "recipientKey" = ${recipientKey} AND "attempt" = ${row.attempts}`;
    if (evidence.length !== 1 || !["SAFE_TRANSIENT_REJECTION", "SAFE_PERMANENT_REJECTION"].includes(evidence[0].outcome)) return "conflict" as const;
    const ceiling = Math.min(15, row.attempts + 5);
    await tx.$executeRaw`INSERT INTO "AgentAdminNotificationReplay" ("requestId", "applicationId", "recipientKey", "actorId", "previousAttempt", "retryCeiling") VALUES (${requestId}, ${applicationId}, ${recipientKey}, ${actorId}, ${row.attempts}, ${ceiling})`;
    await tx.$executeRaw`UPDATE "AgentAdminNotificationClaimState" SET "state" = 'RETRY', "retryCeiling" = ${ceiling}, "nextAttemptAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE "applicationId" = ${applicationId} AND "recipientKey" = ${recipientKey}`;
    return "created" as const;
  });
}
