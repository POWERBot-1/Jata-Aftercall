-- ADMIN-023 §028: raise the per-revision membership ceiling from 5,000 to 50,000 so that revision
-- reads can exercise a real keyset next-page marker. Requests still read at most READ_PAGE_SIZE (500)
-- members at a time (lib/agents/referral-report-bounds.ts). The cap is an explicit refusal, never a
-- truncation. Only the cap constant changes; the trigger wiring, write fence, and immutability guards
-- from earlier migrations are untouched. Rollback: docs/agents/migrations/20261127000000-bounded-pages-rollback.sql.
CREATE OR REPLACE FUNCTION "agent_referral_report_record_baseline"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE registration_total BIGINT; existing_total BIGINT;
BEGIN
  IF NEW."registrationCount"::numeric + NEW."existingApplicationCount"::numeric > 50000 THEN
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
