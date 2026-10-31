-- Cursor tracks bounded manual scheduler invocations; no cron or report delivery is enabled.
CREATE TABLE "AgentReferralReportSchedule" (
  "periodType" TEXT NOT NULL,
  "configuredStart" TIMESTAMP(3) NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "lastApplicationId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReferralReportSchedule_pkey" PRIMARY KEY ("periodType"),
  CONSTRAINT "AgentReferralReportSchedule_period_check" CHECK ("periodType" IN ('DAILY', 'MONTHLY')),
  CONSTRAINT "AgentReferralReportSchedule_order_check" CHECK ("periodStart" >= "configuredStart")
);
