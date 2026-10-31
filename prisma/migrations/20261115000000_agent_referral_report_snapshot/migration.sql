-- Operational referral-evidence counts only, not sales, commission or payout.
CREATE TABLE "AgentReferralReportSnapshot" (
  "applicationId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "periodType" TEXT NOT NULL,
  "startInclusive" TIMESTAMP(3) NOT NULL,
  "endExclusive" TIMESTAMP(3) NOT NULL,
  "registrationCount" BIGINT NOT NULL,
  "existingApplicationCount" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReferralReportSnapshot_pkey" PRIMARY KEY ("applicationId", "periodKey"),
  CONSTRAINT "AgentReferralReportSnapshot_application_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentReferralReportSnapshot_period_check" CHECK (("periodType" = 'DAILY' AND "periodKey" ~ '^daily:[0-9]{4}-[0-9]{2}-[0-9]{2}$') OR ("periodType" = 'MONTHLY' AND "periodKey" ~ '^monthly:[0-9]{4}-[0-9]{2}$')),
  CONSTRAINT "AgentReferralReportSnapshot_bounds_check" CHECK ("startInclusive" < "endExclusive"),
  CONSTRAINT "AgentReferralReportSnapshot_counts_check" CHECK ("registrationCount" >= 0 AND "existingApplicationCount" >= 0)
);
CREATE INDEX "AgentReferralReportSnapshot_applicationId_createdAt_idx" ON "AgentReferralReportSnapshot"("applicationId", "createdAt");
