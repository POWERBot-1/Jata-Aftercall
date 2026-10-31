-- Versioned referral-evidence membership; existing count-only snapshots are not backfilled.
CREATE TABLE "AgentReferralReportRevision" (
  "applicationId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "actorId" TEXT,
  "registrationCount" BIGINT NOT NULL,
  "existingApplicationCount" BIGINT NOT NULL,
  "addedCount" INTEGER NOT NULL DEFAULT 0,
  "removedCount" INTEGER NOT NULL DEFAULT 0,
  "changedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReferralReportRevision_pkey" PRIMARY KEY ("applicationId", "periodKey", "revision"),
  CONSTRAINT "AgentReferralReportRevision_snapshot_fkey" FOREIGN KEY ("applicationId", "periodKey") REFERENCES "AgentReferralReportSnapshot"("applicationId", "periodKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentReferralReportRevision_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentReferralReportRevision_kind_check" CHECK (("revision" = 1 AND "kind" = 'BASELINE' AND "actorId" IS NULL) OR ("revision" > 1 AND "kind" = 'RECONCILED' AND "actorId" IS NOT NULL)),
  CONSTRAINT "AgentReferralReportRevision_counts_check" CHECK ("registrationCount" >= 0 AND "existingApplicationCount" >= 0 AND "addedCount" >= 0 AND "removedCount" >= 0 AND "changedCount" >= 0)
);
CREATE TABLE "AgentReferralReportMember" (
  "applicationId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "eventId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "eventCreatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentReferralReportMember_pkey" PRIMARY KEY ("applicationId", "periodKey", "revision", "eventId"),
  CONSTRAINT "AgentReferralReportMember_revision_fkey" FOREIGN KEY ("applicationId", "periodKey", "revision") REFERENCES "AgentReferralReportRevision"("applicationId", "periodKey", "revision") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentReferralReportMember_source_check" CHECK ("source" IN ('REGISTRATION', 'EXISTING_ACCOUNT'))
);
-- The snapshot's INSERT and trigger share a PostgreSQL statement snapshot, so count and members
-- describe the same visible input even when another transaction inserts evidence concurrently.
CREATE FUNCTION "agent_referral_report_record_baseline"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE registration_total BIGINT; existing_total BIGINT;
BEGIN
  IF NEW."registrationCount"::numeric + NEW."existingApplicationCount"::numeric > 5000 THEN
    RAISE EXCEPTION 'referral report baseline exceeds membership limit';
  END IF;
  INSERT INTO "AgentReferralReportRevision" ("applicationId", "periodKey", "revision", "kind", "registrationCount", "existingApplicationCount")
  VALUES (NEW."applicationId", NEW."periodKey", 1, 'BASELINE', NEW."registrationCount", NEW."existingApplicationCount");
  INSERT INTO "AgentReferralReportMember" ("applicationId", "periodKey", "revision", "eventId", "source", "eventCreatedAt")
  SELECT NEW."applicationId", NEW."periodKey", 1, a."id", a."source", a."createdAt"
  FROM "AgentReferralAttribution" a
  WHERE a."referrerApplicationId" = NEW."applicationId" AND a."createdAt" >= NEW."startInclusive"
    AND a."createdAt" < NEW."endExclusive" AND a."source" IN ('REGISTRATION', 'EXISTING_ACCOUNT');
  SELECT COUNT(*) FILTER (WHERE "source" = 'REGISTRATION'), COUNT(*) FILTER (WHERE "source" = 'EXISTING_ACCOUNT')
  INTO registration_total, existing_total FROM "AgentReferralReportMember"
  WHERE "applicationId" = NEW."applicationId" AND "periodKey" = NEW."periodKey" AND "revision" = 1;
  IF registration_total <> NEW."registrationCount" OR existing_total <> NEW."existingApplicationCount" THEN
    RAISE EXCEPTION 'referral report baseline membership mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AgentReferralReportSnapshot_baseline" AFTER INSERT ON "AgentReferralReportSnapshot"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_record_baseline"();
