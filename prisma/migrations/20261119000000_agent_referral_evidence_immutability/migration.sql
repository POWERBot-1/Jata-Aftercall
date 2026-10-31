-- Existing evidence remains in place. Ordinary corrections use new revisions rather than edits.
-- This does not protect against table-wide deletion, disabled triggers or owners/superusers, nor prevent
-- new member INSERTs into an existing revision. Restrict database privileges separately.
CREATE FUNCTION "agent_referral_report_evidence_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Referral report evidence is immutable';
END;
$$;
CREATE TRIGGER "AgentReferralReportSnapshot_immutable" BEFORE UPDATE OR DELETE ON "AgentReferralReportSnapshot"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_evidence_immutable"();
CREATE TRIGGER "AgentReferralReportRevision_immutable" BEFORE UPDATE OR DELETE ON "AgentReferralReportRevision"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_evidence_immutable"();
CREATE TRIGGER "AgentReferralReportMember_immutable" BEFORE UPDATE OR DELETE ON "AgentReferralReportMember"
FOR EACH ROW EXECUTE FUNCTION "agent_referral_report_evidence_immutable"();
