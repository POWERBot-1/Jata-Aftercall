-- Prospective replay protection only: no historical repayments are assigned keys or allocations.
-- The composite foreign keys prohibit a key from linking a customer or payment from another tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "PosCustomer_businessId_id_key" ON "PosCustomer"("businessId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "PosPayment_businessId_customerId_id_key" ON "PosPayment"("businessId", "customerId", "id");
CREATE TABLE IF NOT EXISTS "PosRepaymentRequest" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountKES" INTEGER NOT NULL,
  "balanceAfterKES" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosRepaymentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosRepaymentRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PosRepaymentRequest_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "PosCustomer"("businessId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "PosRepaymentRequest_businessId_customerId_paymentId_fkey" FOREIGN KEY ("businessId", "customerId", "paymentId") REFERENCES "PosPayment"("businessId", "customerId", "id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosRepaymentRequest_businessId_key_key" ON "PosRepaymentRequest"("businessId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "PosRepaymentRequest_paymentId_key" ON "PosRepaymentRequest"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PosRepaymentRequest_businessId_customerId_paymentId_key" ON "PosRepaymentRequest"("businessId", "customerId", "paymentId");
CREATE INDEX IF NOT EXISTS "PosRepaymentRequest_businessId_createdAt_idx" ON "PosRepaymentRequest"("businessId", "createdAt");

-- A successful key is part of the financial history, not an expiring cache entry. Ordinary
-- application writes cannot rewrite or delete it; business cascades retain existing repository
-- deletion semantics. Individual customer and payment deletes are refused while linked.
CREATE OR REPLACE FUNCTION pos_repayment_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Repayment request history is immutable';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_repayment_request_immutable_guard' AND tgrelid = '"PosRepaymentRequest"'::regclass) THEN
    CREATE TRIGGER pos_repayment_request_immutable_guard BEFORE UPDATE OR DELETE ON "PosRepaymentRequest"
    FOR EACH ROW EXECUTE FUNCTION pos_repayment_request_immutable();
  END IF;
END $$;
