-- Storage only: no migration, application endpoint, or policy enables accrual or payouts.
CREATE TABLE "AgentCommissionLedgerEntry" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "agentApplicationId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "originalEntryId" TEXT,
  "policyVersion" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentCommissionLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentCommissionLedgerEntry_valid_kind_amount" CHECK (
    ("entryType" = 'ACCRUAL' AND "amountMinor" > 0 AND "originalEntryId" IS NULL) OR
    ("entryType" = 'REVERSAL' AND "amountMinor" < 0 AND "originalEntryId" IS NOT NULL)
  ),
  CONSTRAINT "AgentCommissionLedgerEntry_currency_check" CHECK ("currency" = 'KES'),
  CONSTRAINT "AgentCommissionLedgerEntry_nonempty_check" CHECK (length("sourceEventId") BETWEEN 1 AND 255 AND length("policyVersion") BETWEEN 1 AND 255),
  CONSTRAINT "AgentCommissionLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentCommissionLedgerEntry_agentApplicationId_fkey" FOREIGN KEY ("agentApplicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentCommissionLedgerEntry_sourceEventId_key" ON "AgentCommissionLedgerEntry"("sourceEventId");
CREATE UNIQUE INDEX "AgentCommissionLedgerEntry_identity_key" ON "AgentCommissionLedgerEntry"("id", "paymentId", "agentApplicationId", "currency");
CREATE INDEX "AgentCommissionLedgerEntry_paymentId_idx" ON "AgentCommissionLedgerEntry"("paymentId");
CREATE INDEX "AgentCommissionLedgerEntry_agentApplicationId_createdAt_idx" ON "AgentCommissionLedgerEntry"("agentApplicationId", "createdAt");
ALTER TABLE "AgentCommissionLedgerEntry" ADD CONSTRAINT "AgentCommissionLedgerEntry_original_fkey" FOREIGN KEY ("originalEntryId", "paymentId", "agentApplicationId", "currency") REFERENCES "AgentCommissionLedgerEntry"("id", "paymentId", "agentApplicationId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ordinary row mutation is forbidden; corrections must be appended as separate entries.
CREATE FUNCTION "agent_commission_ledger_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission ledger entries are immutable';
END;
$$;
CREATE TRIGGER "AgentCommissionLedgerEntry_immutable" BEFORE UPDATE OR DELETE ON "AgentCommissionLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "agent_commission_ledger_immutable"();

-- One direct accrual per agent/payment. Distinct source IDs alone do not establish verification.
CREATE UNIQUE INDEX "AgentCommissionLedgerEntry_one_accrual" ON "AgentCommissionLedgerEntry"("paymentId", "agentApplicationId") WHERE "entryType" = 'ACCRUAL';
CREATE FUNCTION "agent_commission_ledger_check_reversal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "AgentCommissionLedgerEntry"%ROWTYPE;
  reversed NUMERIC;
BEGIN
  IF NEW."entryType" <> 'REVERSAL' THEN RETURN NEW; END IF;
  -- A fixed transaction snapshot can remain stale after waiting for the lock.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Commission reversal requires READ COMMITTED isolation';
  END IF;
  -- Same original is serialized across workers before the total is read. No entry is modified.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."originalEntryId", 0));
  SELECT * INTO original FROM "AgentCommissionLedgerEntry" WHERE "id" = NEW."originalEntryId";
  IF NOT FOUND OR original."entryType" <> 'ACCRUAL' OR original."paymentId" <> NEW."paymentId" OR
     original."agentApplicationId" <> NEW."agentApplicationId" OR original."currency" <> NEW."currency" OR
     original."policyVersion" <> NEW."policyVersion" OR original."policySnapshot" <> NEW."policySnapshot" THEN
    RAISE EXCEPTION 'Commission reversal does not match its original accrual';
  END IF;
  SELECT COALESCE(SUM(-"amountMinor"::numeric), 0) INTO reversed FROM "AgentCommissionLedgerEntry"
    WHERE "entryType" = 'REVERSAL' AND "originalEntryId" = NEW."originalEntryId";
  IF reversed - NEW."amountMinor"::numeric > original."amountMinor"::numeric THEN
    RAISE EXCEPTION 'Commission reversal exceeds its original accrual';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AgentCommissionLedgerEntry_check_reversal" BEFORE INSERT ON "AgentCommissionLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "agent_commission_ledger_check_reversal"();
