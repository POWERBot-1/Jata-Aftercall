import { nairobiCalendarDay, parseCalendarDay } from "@/lib/dateFormat";
import { previousDailyPeriod, previousMonthlyPeriod } from "@/lib/agents/report-periods";
import type { Prisma } from "@prisma/client";

export type SchedulePeriod = "DAILY" | "MONTHLY";
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
const DAY_MS = 86_400_000;
const BATCH_SIZE = 20;

/** Start date is an explicit deployment decision, not a silently invented backfill period. */
export function reportScheduleStart(raw: string | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-01$/.test(raw)) return null;
  const parsed = parseCalendarDay(raw);
  if (!parsed || !Number.isFinite(parsed.getTime()) || nairobiCalendarDay(parsed) !== raw) return null;
  return parsed;
}

function periodAt(start: Date, kind: SchedulePeriod) {
  if (kind === "DAILY") return previousDailyPeriod(new Date(start.getTime() + DAY_MS));
  const [year, month] = nairobiCalendarDay(start).split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const nextDay = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const next = parseCalendarDay(nextDay);
  if (!next) throw new Error("INVALID_SCHEDULE_CURSOR");
  const period = previousMonthlyPeriod(next);
  if (period.startInclusive.getTime() !== start.getTime()) throw new Error("INVALID_SCHEDULE_CURSOR");
  return period;
}

/** One caller-provided transaction: serialized cursor, bounded page, no network or delivery. */
export async function processReferralReportBatch(tx: Tx, kind: SchedulePeriod, start: Date, now: Date): Promise<{ status: "CAUGHT_UP" | "BATCH" | "PERIOD_COMPLETE"; processed: number }> {
  if ((kind !== "DAILY" && kind !== "MONTHLY") || !Number.isFinite(start.getTime()) || !Number.isFinite(now.getTime()) || start > now) throw new Error("INVALID_SCHEDULE_CONFIG");
  await tx.$executeRaw`
    INSERT INTO "AgentReferralReportSchedule" ("periodType", "configuredStart", "periodStart")
    VALUES (${kind}, ${start}, ${start}) ON CONFLICT ("periodType") DO NOTHING`;
  const rows = await tx.$queryRaw<Array<{ configuredStart: Date; periodStart: Date; lastApplicationId: string | null }>>`
    SELECT "configuredStart", "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType" = ${kind} FOR UPDATE`;
  if (rows.length !== 1 || rows[0].configuredStart.getTime() !== start.getTime()) throw new Error("SCHEDULE_START_CHANGED");
  const cursor = rows[0];
  const period = periodAt(cursor.periodStart, kind);
  if (period.endExclusive > now) return { status: "CAUGHT_UP", processed: 0 };
  const applications = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "AgentApplication"
    WHERE "status" = 'PENDING' AND "agentStatus" = 'ACTIVE' AND "createdAt" < ${period.endExclusive}
      AND (${cursor.lastApplicationId}::text IS NULL OR "id" > ${cursor.lastApplicationId})
    ORDER BY "id" LIMIT ${BATCH_SIZE} FOR SHARE`;
  for (const application of applications) {
    // Existing manual snapshots are retained; no existing history is rewritten.
    await tx.$executeRaw`
      INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount")
      SELECT ${application.id}, ${period.key}, ${kind}, ${period.startInclusive}, ${period.endExclusive},
        COUNT(*) FILTER (WHERE "source" = 'REGISTRATION'), COUNT(*) FILTER (WHERE "source" = 'EXISTING_ACCOUNT')
      FROM "AgentReferralAttribution" WHERE "referrerApplicationId" = ${application.id}
        AND "createdAt" >= ${period.startInclusive} AND "createdAt" < ${period.endExclusive}
      ON CONFLICT ("applicationId", "periodKey") DO NOTHING`;
  }
  if (applications.length === BATCH_SIZE) {
    await tx.$executeRaw`UPDATE "AgentReferralReportSchedule" SET "lastApplicationId" = ${applications[applications.length - 1].id}, "updatedAt" = clock_timestamp() WHERE "periodType" = ${kind}`;
    return { status: "BATCH", processed: applications.length };
  }
  await tx.$executeRaw`UPDATE "AgentReferralReportSchedule" SET "periodStart" = ${period.endExclusive}, "lastApplicationId" = NULL, "updatedAt" = clock_timestamp() WHERE "periodType" = ${kind}`;
  return { status: "PERIOD_COMPLETE", processed: applications.length };
}
