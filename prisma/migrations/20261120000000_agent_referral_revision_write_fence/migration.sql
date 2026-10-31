-- Only the transaction that creates a revision may populate its members. Existing revisions
-- have no fence row and are therefore sealed without backfilling or reconstructing membership.
CREATE TABLE "AgentReferralReportRevisionWriteFence" (
  "applicationId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "transactionId" TEXT NOT NULL,
  CONSTRAINT "AgentReferralReportRevisionWriteFence_pkey" PRIMARY KEY ("applicationId", "periodKey", "revision"),
  CONSTRAINT "AgentReferralReportRevisionWriteFence_revision_fkey" FOREIGN KEY ("applicationId", "periodKey", "revision") REFERENCES "AgentReferralReportRevision"("applicationId", "periodKey", "revision") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE FUNCTION "agent_referral_report_fence_insert_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Referral revision fence cannot be inserted directly'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AgentReferralReportRevisionWriteFence_insert_guard" BEFORE INSERT ON "AgentReferralReportRevisionWriteFence"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_fence_insert_guard"();
CREATE TRIGGER "AgentReferralReportRevisionWriteFence_immutable" BEFORE UPDATE ON "AgentReferralReportRevisionWriteFence"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_evidence_immutable"();
CREATE FUNCTION "agent_referral_report_create_write_fence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "AgentReferralReportRevisionWriteFence" ("applicationId", "periodKey", "revision", "transactionId")
  VALUES (NEW."applicationId", NEW."periodKey", NEW."revision", pg_current_xact_id()::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AgentReferralReportRevision_write_fence" AFTER INSERT ON "AgentReferralReportRevision"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_create_write_fence"();
CREATE FUNCTION "agent_referral_report_member_insert_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE creation_transaction TEXT;
BEGIN
  -- Lock the parent before checking the fence so a concurrent creator cannot commit between
  -- those operations. An invisible or absent parent fails closed.
  PERFORM 1 FROM "AgentReferralReportRevision" WHERE "applicationId" = NEW."applicationId"
    AND "periodKey" = NEW."periodKey" AND "revision" = NEW."revision" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral revision is unavailable'; END IF;
  SELECT "transactionId" INTO creation_transaction FROM "AgentReferralReportRevisionWriteFence"
    WHERE "applicationId" = NEW."applicationId" AND "periodKey" = NEW."periodKey" AND "revision" = NEW."revision";
  IF creation_transaction IS NULL OR creation_transaction <> pg_current_xact_id()::text THEN
    RAISE EXCEPTION 'Referral revision membership is sealed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AgentReferralReportMember_insert_guard" BEFORE INSERT ON "AgentReferralReportMember"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_member_insert_guard"();
