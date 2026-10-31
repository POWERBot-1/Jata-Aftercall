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
