-- Ledger immutability — database-level protections for posted journals.
-- Additive, reversible via DROP TRIGGER/FUNCTION.
-- Requirements: DRAFT→POSTED→REVERSED lifecycle must not break:
--   1. Current lib/erp/accounting.ts creates POSTED directly then inserts lines.
--      This migration therefore ALLOWS inserting lines for a POSTED journal within the
--      same transaction window is NOT safe in general; proper lifecycle is DRAFT->POSTED.
--      We implement permissive POSTED line-insert allowance for backward-compat but
--      block UPDATE/DELETE of lines once parent is POSTED/REVERSED, and block journal
--      field mutations except reversedById.
--   2. Reverse flow updates original.reversedById — allowed.
-- Rollback: docs/POS_ERP_PRO_MIGRATION_PLAN.md
-- Test on disposable DB: ensure posted line UPDATE/DELETE denied, draft line mutation allowed,
-- journal status transition DRAFT->POSTED allowed, POSTED->DRAFT denied, reversedById allowed.

-- Prevent updating/deleting posted journal lines (but allow inserting into POSTED for compat)
CREATE OR REPLACE FUNCTION prevent_posted_journal_line_mutation() RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status INTO parent_status FROM "ErpJournal" WHERE id = COALESCE(NEW."journalId", OLD."journalId");
  IF parent_status IN ('POSTED', 'REVERSED') THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'posted journal lines are immutable (journal % is %)', COALESCE(NEW."journalId", OLD."journalId"), parent_status;
    ELSIF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'posted journal lines cannot be deleted (journal % is %)', OLD."journalId", parent_status;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND parent_status IN ('POSTED', 'REVERSED') THEN
    RAISE NOTICE 'Inserting line into already POSTED journal % — consider DRAFT lifecycle', NEW."journalId";
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS erp_journal_line_immutable_update ON "ErpJournalLine";
CREATE TRIGGER erp_journal_line_immutable_update BEFORE UPDATE ON "ErpJournalLine" FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_line_mutation();
DROP TRIGGER IF EXISTS erp_journal_line_immutable_delete ON "ErpJournalLine";
CREATE TRIGGER erp_journal_line_immutable_delete BEFORE DELETE ON "ErpJournalLine" FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_line_mutation();

-- Prevent mutating posted journals except reversedById and updatedAt
CREATE OR REPLACE FUNCTION prevent_posted_journal_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NEW."journalNumber" IS DISTINCT FROM OLD."journalNumber"
       OR NEW."entryDate" IS DISTINCT FROM OLD."entryDate"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
       OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
       OR NEW."exchangeRate" IS DISTINCT FROM OLD."exchangeRate"
       OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
       OR NEW."postedById" IS DISTINCT FROM OLD."postedById"
       OR NEW."reversalOfId" IS DISTINCT FROM OLD."reversalOfId"
       OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
       OR NEW."businessId" IS DISTINCT FROM OLD."businessId"
       OR NEW."branchId" IS DISTINCT FROM OLD."branchId"
    THEN
      RAISE EXCEPTION 'posted journal % is immutable except reversedById', OLD.id;
    END IF;
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'cannot revert POSTED journal % to DRAFT', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS erp_journal_immutable_update ON "ErpJournal";
CREATE TRIGGER erp_journal_immutable_update BEFORE UPDATE ON "ErpJournal" FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_mutation();

DROP TRIGGER IF EXISTS erp_journal_immutable_delete ON "ErpJournal";
CREATE OR REPLACE FUNCTION prevent_posted_journal_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted journal % cannot be deleted', OLD.id;
  END IF;
  IF EXISTS (SELECT 1 FROM "ErpJournalLine" WHERE "journalId" = OLD.id) THEN
    RAISE EXCEPTION 'journal % has lines and cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER erp_journal_immutable_delete BEFORE DELETE ON "ErpJournal" FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_delete();
CREATE OR REPLACE VIEW "ErpJournalIntegrity" AS SELECT j.id AS "journalId", j."businessId", j."journalNumber", j.status, COALESCE(SUM(l."debitCents"), 0) AS "totalDebit", COALESCE(SUM(l."creditCents"), 0) AS "totalCredit", COUNT(l.id) AS "lineCount", (COALESCE(SUM(l."debitCents"),0) = COALESCE(SUM(l."creditCents"),0)) AS balanced, (COUNT(l.id) = 0) AS empty FROM "ErpJournal" j LEFT JOIN "ErpJournalLine" l ON l."journalId" = j.id WHERE j.status IN ('POSTED','REVERSED') GROUP BY j.id;
