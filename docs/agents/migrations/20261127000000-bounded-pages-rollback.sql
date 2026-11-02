-- ROLLBACK for prisma/migrations/20261127000000_agent_referral_report_bounded_pages.
-- Not run by Prisma. Run manually, in a transaction, only after review and with a verified backup.
-- It restores the 5,000 ceiling. It REFUSES to run if any revision already holds more than 5,000
-- members, because those rows cannot be removed by this rollback (evidence is immutable).
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "applicationId", "periodKey", "revision", COUNT(*) AS n
      FROM "AgentReferralReportMember" GROUP BY 1, 2, 3
    ) s WHERE s.n > 5000
  ) THEN
    RAISE EXCEPTION 'Rollback refused: a revision holds more than 5,000 members';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION "agent_referral_report_record_baseline"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
COMMIT;
