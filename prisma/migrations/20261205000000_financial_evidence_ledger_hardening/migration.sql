-- Forward-only completion of the financial evidence ledger.
--
-- 20261204000000_financial_evidence_ledger was applied to the isolated PR #130
-- preview branch before its candidate file was extended. That original migration
-- is preserved byte-for-byte so its recorded Prisma checksum remains valid.
-- This migration adds the later schema hardening without rewriting applied history.
--
-- Existing rows are never assigned invented provenance. If any rows exist in a
-- table that needs new mandatory provenance, this migration fails and requires a
-- reviewed, evidence-backed backfill before it can continue.

ALTER TABLE "ProviderSettlementSnapshot"
  ADD COLUMN "fetchedByActorId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProviderSettlementSnapshot"
    WHERE "sourceEndpoint" <> '/settlement'
  ) THEN
    RAISE EXCEPTION
      'financial evidence migration requires review: existing snapshot sourceEndpoint is not /settlement';
  END IF;
END;
$$;

-- Retain the original endpoint check and add a stricter summary-source check.
-- A second CHECK avoids dropping/replacing an existing database constraint.
ALTER TABLE "ProviderSettlementSnapshot"
  ADD CONSTRAINT "ProviderSettlementSnapshot_source_summary_check"
    CHECK ("sourceEndpoint" = '/settlement');

ALTER TABLE "ProviderSettlementTransactionEvidence"
  ADD COLUMN "sourcePage" INTEGER,
  ADD COLUMN "sourcePerPage" INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ProviderSettlementTransactionEvidence") THEN
    RAISE EXCEPTION
      'financial evidence migration requires review: transaction evidence rows need source page provenance before NOT NULL can be enforced';
  END IF;
END;
$$;

ALTER TABLE "ProviderSettlementTransactionEvidence"
  ALTER COLUMN "sourcePage" SET NOT NULL,
  ALTER COLUMN "sourcePerPage" SET NOT NULL;

ALTER TABLE "ProviderSettlementTransactionEvidence"
  ADD CONSTRAINT "ProviderSettlementTransactionEvidence_source_check"
    CHECK (
      "sourcePage" BETWEEN 1 AND 10000 AND
      "sourcePerPage" BETWEEN 1 AND 100
    );

ALTER TABLE "BankStatementImportBatch"
  ADD COLUMN "importedByActorId" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BankStatementImportBatch") THEN
    RAISE EXCEPTION
      'financial evidence migration requires review: existing bank import batches need an authoritative importer identity';
  END IF;
END;
$$;

ALTER TABLE "BankStatementImportBatch"
  ALTER COLUMN "importedByActorId" SET NOT NULL;

ALTER TABLE "BankStatementImportBatch"
  ADD CONSTRAINT "BankStatementImportBatch_actor_check"
    CHECK (length("importedByActorId") BETWEEN 1 AND 128);

-- The original migration already protects UPDATE and DELETE. These statement-level
-- triggers close the remaining TRUNCATE bypass for all four append-only evidence tables.
CREATE TRIGGER "ProviderSettlementSnapshot_no_truncate"
  BEFORE TRUNCATE ON "ProviderSettlementSnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION financial_evidence_append_only_guard();

CREATE TRIGGER "ProviderSettlementTransactionEvidence_no_truncate"
  BEFORE TRUNCATE ON "ProviderSettlementTransactionEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION financial_evidence_append_only_guard();

CREATE TRIGGER "BankStatementImportBatch_no_truncate"
  BEFORE TRUNCATE ON "BankStatementImportBatch"
  FOR EACH STATEMENT EXECUTE FUNCTION financial_evidence_append_only_guard();

CREATE TRIGGER "BankStatementCreditEvidence_no_truncate"
  BEFORE TRUNCATE ON "BankStatementCreditEvidence"
  FOR EACH STATEMENT EXECUTE FUNCTION financial_evidence_append_only_guard();

-- No automated rollback: this migration adds provenance and append-only guarantees
-- to financial history. Any rollback requires owner approval and a verified export.
