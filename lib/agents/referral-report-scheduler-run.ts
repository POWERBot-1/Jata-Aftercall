import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { processReferralReportBatch, type SchedulePeriod } from "@/lib/agents/referral-report-scheduler";

/** Persists a run before work. The cursor, snapshots and success record commit together. */
export async function runReferralReportBatch(db: PrismaClient, kind: SchedulePeriod, start: Date, now: Date) {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO "AgentReferralReportScheduleRun" ("id", "periodType", "status") VALUES (${id}, ${kind}, 'RUNNING')`;
  try {
    return await db.$transaction(async (tx) => {
      // Prisma's transaction timer alone may not promptly interrupt a blocked PostgreSQL query.
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '12s'`;
      // A live transaction holds this row lock until commit/rollback. Recovery uses SKIP LOCKED,
      // so it cannot declare a still-running batch dead or race its atomic success update.
      const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "AgentReferralReportScheduleRun" WHERE "id" = ${id} FOR UPDATE`;
      if (rows.length !== 1 || rows[0].status !== "RUNNING") throw new Error("SCHEDULE_RUN_CHANGED");
      const result = await processReferralReportBatch(tx, kind, start, now);
      const updated = await tx.$executeRaw`
        UPDATE "AgentReferralReportScheduleRun" SET "status" = 'SUCCEEDED', "periodKey" = ${result.periodKey},
          "result" = ${result.status}, "processed" = ${result.processed}, "finishedAt" = clock_timestamp()
        WHERE "id" = ${id} AND "status" = 'RUNNING'`;
      if (updated !== 1) throw new Error("SCHEDULE_RUN_CHANGED");
      return result;
    }, { maxWait: 2000, timeout: 15000 });
  } catch (error) {
    // A process crash can leave RUNNING; never infer success or automatically replay it from age.
    // Store only a fixed classification, never database text, credentials, or recipient details.
    const failureCode = error instanceof Error && error.message === "SCHEDULE_START_CHANGED" ? "SCHEDULE_START_CHANGED" : "BATCH_FAILED";
    try { await db.$executeRaw`UPDATE "AgentReferralReportScheduleRun" SET "status" = 'FAILED', "failureCode" = ${failureCode}, "finishedAt" = clock_timestamp() WHERE "id" = ${id} AND "status" = 'RUNNING'`; } catch { /* Fail closed; RUNNING remains unresolved. */ }
    throw error;
  }
}

/** Recover abandoned DB-only runs in bounded pages. Active workers hold the run row lock.
 * BATCH_FAILED is the existing sanitized failure classification; this is not an operator audit
 * or a retry limit. A resumed invocation always starts from the last committed cursor. */
export async function recoverStaleReferralReportRuns(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    WITH abandoned AS (
      SELECT "id" FROM "AgentReferralReportScheduleRun"
      WHERE "status" = 'RUNNING' AND "startedAt" < clock_timestamp() - INTERVAL '2 minutes'
      ORDER BY "startedAt", "id" FOR UPDATE SKIP LOCKED LIMIT 50
    )
    UPDATE "AgentReferralReportScheduleRun" r
    SET "status" = 'FAILED', "failureCode" = 'BATCH_FAILED', "finishedAt" = clock_timestamp()
    FROM abandoned a WHERE r."id" = a."id" AND r."status" = 'RUNNING'`;
}
