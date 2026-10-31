-- Operational scheduler execution evidence; no scheduler is enabled by this table.
CREATE TABLE "AgentReferralReportScheduleRun" (
  "id" TEXT NOT NULL,
  "periodType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "periodKey" TEXT,
  "result" TEXT,
  "processed" INTEGER,
  "failureCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AgentReferralReportScheduleRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentReferralReportScheduleRun_period_check" CHECK ("periodType" IN ('DAILY', 'MONTHLY')),
  CONSTRAINT "AgentReferralReportScheduleRun_status_check" CHECK (
    ("status" = 'RUNNING' AND "finishedAt" IS NULL AND "result" IS NULL AND "processed" IS NULL AND "failureCode" IS NULL) OR
    ("status" = 'SUCCEEDED' AND "finishedAt" IS NOT NULL AND "periodKey" IS NOT NULL AND "result" IS NOT NULL AND "processed" IS NOT NULL AND "result" IN ('CAUGHT_UP', 'BATCH', 'PERIOD_COMPLETE') AND "processed" BETWEEN 0 AND 20 AND "failureCode" IS NULL) OR
    ("status" = 'FAILED' AND "finishedAt" IS NOT NULL AND "result" IS NULL AND "processed" IS NULL AND "failureCode" IS NOT NULL AND "failureCode" IN ('BATCH_FAILED', 'SCHEDULE_START_CHANGED'))
  )
);
CREATE INDEX "AgentReferralReportScheduleRun_startedAt_id_idx" ON "AgentReferralReportScheduleRun"("startedAt", "id");
