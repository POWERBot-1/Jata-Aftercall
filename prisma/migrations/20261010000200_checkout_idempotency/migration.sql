-- Durable checkout idempotency (storefront checkout and AI ordering): one new table, nothing else touched.
--
-- Replaces the in-memory idempotency maps, which do not survive a restart and are not shared between
-- instances. The row is written inside the order's own transaction, so a duplicate insert violates the unique
-- index, the transaction rolls back, and no second order, stock decrement or payment row is created.
--
-- Additive and rerunnable: no existing table or column is altered, nothing is dropped, no data is rewritten,
-- and no historical migration is modified.

CREATE TABLE IF NOT EXISTS "CheckoutIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "responseJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "CheckoutIdempotencyRecord" ADD CONSTRAINT "CheckoutIdempotencyRecord_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A unique index, not a constraint, so it is re-runnable (see 20261005040000_pos_sale_idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutIdempotencyRecord_businessId_scope_key_key"
    ON "CheckoutIdempotencyRecord"("businessId", "scope", "key");

CREATE INDEX IF NOT EXISTS "CheckoutIdempotencyRecord_businessId_createdAt_idx"
    ON "CheckoutIdempotencyRecord"("businessId", "createdAt");
