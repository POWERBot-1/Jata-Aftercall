-- Link each ordinary subscription to the exact verified payment that activated it.
-- Existing rows remain NULL: no historical payment is inferred or backfilled.
ALTER TABLE "Subscription"
  ADD COLUMN "paymentId" TEXT,
  ADD COLUMN "paymentReference" TEXT;

CREATE UNIQUE INDEX "Subscription_paymentId_key"
  ON "Subscription"("paymentId");

CREATE INDEX "Subscription_paymentReference_idx"
  ON "Subscription"("paymentReference");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
