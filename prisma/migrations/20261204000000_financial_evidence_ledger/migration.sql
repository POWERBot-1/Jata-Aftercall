-- Append-only provider settlement and normalized bank-credit evidence.
-- Additive only. No existing payment, subscription, bank or ledger rows are rewritten.
-- Provider settlement snapshots are not proof of a bank deposit. No journal postings or payouts
-- are created or enabled by this migration.

CREATE TABLE "ProviderSettlementSnapshot" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProviderKey" NOT NULL DEFAULT 'PAYSTACK',
  "providerSettlementId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currency" TEXT,
  "grossProcessedMinor" BIGINT,
  "providerFeeMinor" BIGINT,
  "effectiveNetMinor" BIGINT,
  "deductionsMinor" BIGINT,
  "settlementDate" TIMESTAMP(3),
  "sourceEndpoint" TEXT NOT NULL,
  "sourcePage" INTEGER NOT NULL,
  "sourcePerPage" INTEGER NOT NULL,
  "sourceFilter" JSONB,
  "sourceSnapshotHash" TEXT NOT NULL,
  "fetchedByActorId" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettlementSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderSettlementSnapshot_status_check"
    CHECK ("status" IN ('success', 'processing', 'pending', 'failed', 'UNKNOWN')),
  CONSTRAINT "ProviderSettlementSnapshot_currency_check"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ProviderSettlementSnapshot_amounts_check"
    CHECK (
      ("grossProcessedMinor" IS NULL OR "grossProcessedMinor" >= 0) AND
      ("providerFeeMinor" IS NULL OR "providerFeeMinor" >= 0) AND
      ("effectiveNetMinor" IS NULL OR "effectiveNetMinor" >= 0) AND
      ("deductionsMinor" IS NULL OR "deductionsMinor" >= 0)
    ),
  CONSTRAINT "ProviderSettlementSnapshot_source_check"
    CHECK (
      "sourceEndpoint" = '/settlement' AND
      "sourcePage" BETWEEN 1 AND 10000 AND
      "sourcePerPage" BETWEEN 1 AND 100
    ),
  CONSTRAINT "ProviderSettlementSnapshot_hash_check"
    CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "ProviderSettlementSnapshot_sourceSnapshotHash_key"
  ON "ProviderSettlementSnapshot"("sourceSnapshotHash");
CREATE INDEX "ProviderSettlementSnapshot_provider_providerSettlementId_fetchedAt_idx"
  ON "ProviderSettlementSnapshot"("provider", "providerSettlementId", "fetchedAt");
CREATE INDEX "ProviderSettlementSnapshot_fetchedAt_idx"
  ON "ProviderSettlementSnapshot"("fetchedAt");

CREATE TABLE "ProviderSettlementTransactionEvidence" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "providerTransactionId" TEXT,
  "paymentReference" TEXT,
  "status" TEXT,
  "amountMinor" BIGINT,
  "currency" TEXT,
  "providerFeeMinor" BIGINT,
  "paidAt" TIMESTAMP(3),
  "sourceRowHash" TEXT NOT NULL,
  "sourcePage" INTEGER NOT NULL,
  "sourcePerPage" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettlementTransactionEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderSettlementTransactionEvidence_snapshot_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "ProviderSettlementSnapshot"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderSettlementTransactionEvidence_amounts_check"
    CHECK (
      ("amountMinor" IS NULL OR "amountMinor" >= 0) AND
      ("providerFeeMinor" IS NULL OR "providerFeeMinor" >= 0)
    ),
  CONSTRAINT "ProviderSettlementTransactionEvidence_currency_check"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ProviderSettlementTransactionEvidence_sourceRowHash_check"
    CHECK ("sourceRowHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ProviderSettlementTransactionEvidence_source_check"
    CHECK ("sourcePage" BETWEEN 1 AND 10000 AND "sourcePerPage" BETWEEN 1 AND 100),
  CONSTRAINT "ProviderSettlementTransactionEvidence_reference_check"
    CHECK ("paymentReference" IS NULL OR length("paymentReference") BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX "ProviderSettlementTransactionEvidence_snapshotId_sourceRowHash_key"
  ON "ProviderSettlementTransactionEvidence"("snapshotId", "sourceRowHash");
CREATE INDEX "ProviderSettlementTransactionEvidence_paymentReference_idx"
  ON "ProviderSettlementTransactionEvidence"("paymentReference");
CREATE INDEX "ProviderSettlementTransactionEvidence_providerTransactionId_idx"
  ON "ProviderSettlementTransactionEvidence"("providerTransactionId");

CREATE TABLE "BankStatementImportBatch" (
  "id" TEXT NOT NULL,
  "sourceFileSha256" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'canonical-v1',
  "importedByActorId" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatementImportBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankStatementImportBatch_hash_check"
    CHECK ("sourceFileSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "BankStatementImportBatch_schema_check"
    CHECK ("schemaVersion" = 'canonical-v1'),
  CONSTRAINT "BankStatementImportBatch_actor_check"
    CHECK (length("importedByActorId") BETWEEN 1 AND 128),
  CONSTRAINT "BankStatementImportBatch_rowCount_check"
    CHECK ("rowCount" BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX "BankStatementImportBatch_sourceFileSha256_key"
  ON "BankStatementImportBatch"("sourceFileSha256");
CREATE INDEX "BankStatementImportBatch_importedAt_idx"
  ON "BankStatementImportBatch"("importedAt");

CREATE TABLE "BankStatementCreditEvidence" (
  "id" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "statementLineId" TEXT NOT NULL,
  "bookingDate" TIMESTAMP(3) NOT NULL,
  "reference" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "creditMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatementCreditEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankStatementCreditEvidence_batch_fkey"
    FOREIGN KEY ("importBatchId") REFERENCES "BankStatementImportBatch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BankStatementCreditEvidence_line_check"
    CHECK (length("statementLineId") BETWEEN 1 AND 128),
  CONSTRAINT "BankStatementCreditEvidence_reference_check"
    CHECK (length("reference") BETWEEN 1 AND 128),
  CONSTRAINT "BankStatementCreditEvidence_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "BankStatementCreditEvidence_credit_check"
    CHECK ("creditMinor" > 0)
);

CREATE UNIQUE INDEX "BankStatementCreditEvidence_importBatchId_statementLineId_key"
  ON "BankStatementCreditEvidence"("importBatchId", "statementLineId");
CREATE INDEX "BankStatementCreditEvidence_reference_currency_creditMinor_idx"
  ON "BankStatementCreditEvidence"("reference", "currency", "creditMinor");
CREATE INDEX "BankStatementCreditEvidence_bookingDate_idx"
  ON "BankStatementCreditEvidence"("bookingDate");

-- Database-level append-only protection for all four evidence tables.
CREATE FUNCTION financial_evidence_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: UPDATE and DELETE are prohibited', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ProviderSettlementSnapshot_append_only"
  BEFORE UPDATE OR DELETE ON "ProviderSettlementSnapshot"
  FOR EACH ROW EXECUTE FUNCTION financial_evidence_append_only_guard();
CREATE TRIGGER "ProviderSettlementTransactionEvidence_append_only"
  BEFORE UPDATE OR DELETE ON "ProviderSettlementTransactionEvidence"
  FOR EACH ROW EXECUTE FUNCTION financial_evidence_append_only_guard();
CREATE TRIGGER "BankStatementImportBatch_append_only"
  BEFORE UPDATE OR DELETE ON "BankStatementImportBatch"
  FOR EACH ROW EXECUTE FUNCTION financial_evidence_append_only_guard();
CREATE TRIGGER "BankStatementCreditEvidence_append_only"
  BEFORE UPDATE OR DELETE ON "BankStatementCreditEvidence"
  FOR EACH ROW EXECUTE FUNCTION financial_evidence_append_only_guard();

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

-- No automated rollback: these tables establish financial history. Any rollback requires
-- owner approval and a verified export/backup of every evidence row.
