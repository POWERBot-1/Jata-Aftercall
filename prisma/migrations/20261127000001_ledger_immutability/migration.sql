-- Ledger immutability — database-level protections for posted journals.
--
-- Additive only: triggers, trigger functions and one read-only view. No table, column or existing
-- row is created, rewritten or dropped, and no statement here is a `DROP` or an `UPDATE "Table"`.
--
-- Lifecycle the triggers must NOT break (lib/erp/accounting.ts):
--   1. postJournalTx creates the journal as DRAFT, inserts its lines, then seals it POSTED in the
--      same transaction. Line INSERT therefore happens while the parent is DRAFT.
--   2. reverseJournal posts a mirrored journal (sourceType REVERSAL, reversalOfId set) and then
--      sets `reversedById` on the original. That is the only permitted mutation of a POSTED row.
--   3. Nothing in the application ever updates or deletes a line of a POSTED journal.
--
-- What is blocked (fails the statement, so the caller's transaction rolls back):
--   • INSERT/UPDATE/DELETE of a journal line whose parent is POSTED or REVERSED.
--   • UPDATE of any identity, date, money, status or attribution field on a POSTED/REVERSED
--     journal; only `reversedById`, `status`, `reversedAt` and `updatedAt` may move.
--   • POSTED → DRAFT, which would silently unseal a ledger entry.
--   • DELETE of a POSTED/REVERSED journal, or of any journal that still has lines.
--
-- Rollback (documented, not executed here): `DROP TRIGGER "ErpJournalLine_immutable" ON
-- "ErpJournalLine"; DROP TRIGGER "ErpJournal_immutable" ON "ErpJournal"; DROP TRIGGER
-- "ErpJournal_delete_guard" ON "ErpJournal"; DROP VIEW "ErpJournalIntegrity"; DROP FUNCTION
-- erp_journal_line_guard(); DROP FUNCTION erp_journal_guard(); DROP FUNCTION
-- erp_journal_delete_guard();`
--
-- Verification of this file itself requires a migrated PostgreSQL database (see
-- docs/MJENGO_OS_VERIFICATION_2026-11-02.md): the trigger bodies below have not been executed in
-- this environment, and are reported as NOT TESTED rather than PASS.

-- ── Lines: immutable once the parent journal is sealed ───────────────────────────────────────────
CREATE FUNCTION erp_journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status TEXT;
  parent_id     TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."journalId" ELSE NEW."journalId" END;
  SELECT status INTO parent_status FROM "ErpJournal" WHERE id = parent_id;

  -- No parent row (should be impossible under the FK): nothing to protect.
  IF parent_status IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF parent_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'journal line % is immutable: parent journal % is %', COALESCE(NEW.id, OLD.id), parent_id, parent_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ErpJournalLine_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "ErpJournalLine"
  FOR EACH ROW EXECUTE FUNCTION erp_journal_line_guard();

-- ── Journal header: sealed rows accept only the reversal markers ─────────────────────────────────
CREATE FUNCTION erp_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NEW."journalNumber" IS DISTINCT FROM OLD."journalNumber"
       OR NEW."entryDate"   IS DISTINCT FROM OLD."entryDate"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."sourceType"  IS DISTINCT FROM OLD."sourceType"
       OR NEW."sourceId"    IS DISTINCT FROM OLD."sourceId"
       OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
       OR NEW."exchangeRate" IS DISTINCT FROM OLD."exchangeRate"
       OR NEW."postedAt"    IS DISTINCT FROM OLD."postedAt"
       OR NEW."postedById"  IS DISTINCT FROM OLD."postedById"
       OR NEW."reversalOfId" IS DISTINCT FROM OLD."reversalOfId"
       OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
       OR NEW."businessId"  IS DISTINCT FROM OLD."businessId"
       OR NEW."branchId"    IS DISTINCT FROM OLD."branchId"
    THEN
      RAISE EXCEPTION 'journal % is immutable once %: only reversal markers may change', OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'journal % cannot return from % to DRAFT; reverse it instead', OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ErpJournal_immutable"
  BEFORE UPDATE ON "ErpJournal"
  FOR EACH ROW EXECUTE FUNCTION erp_journal_guard();

-- ── Journal header: sealed or non-empty journals cannot be deleted ───────────────────────────────
CREATE FUNCTION erp_journal_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted journal % cannot be deleted; reverse it instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "ErpJournalLine" WHERE "journalId" = OLD.id) THEN
    RAISE EXCEPTION 'journal % still has lines and cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "ErpJournal_delete_guard"
  BEFORE DELETE ON "ErpJournal"
  FOR EACH ROW EXECUTE FUNCTION erp_journal_delete_guard();

-- ── Read-only integrity view: empty and unbalanced sealed journals ───────────────────────────────
-- Returns one row per POSTED/REVERSED journal. `balanced` is true when debits equal credits (or the
-- journal has no lines at all), so `empty` must be read as well: an empty journal is `balanced` but
-- still an anomaly.
CREATE VIEW "ErpJournalIntegrity" AS
SELECT
  j."id"                                       AS "journalId",
  j."businessId"                               AS "businessId",
  j."journalNumber"                            AS "journalNumber",
  j."status"                                   AS "status",
  COALESCE(SUM(l."debitCents"), 0)             AS "totalDebitCents",
  COALESCE(SUM(l."creditCents"), 0)            AS "totalCreditCents",
  COUNT(l."id")                                AS "lineCount",
  (COUNT(l."id") > 0 AND COALESCE(SUM(l."debitCents"), 0) = COALESCE(SUM(l."creditCents"), 0)) AS "balanced",
  (COUNT(l."id") = 0)                          AS "empty"
FROM "ErpJournal" j
LEFT JOIN "ErpJournalLine" l ON l."journalId" = j."id"
WHERE j."status" IN ('POSTED', 'REVERSED')
GROUP BY j."id";
