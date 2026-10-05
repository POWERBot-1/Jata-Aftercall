-- POS till-sale idempotency (§27, §32, §54): one new table, nothing else touched.
--
-- A till sends the same sale twice more often than anyone expects — a second tap on "Charge"
-- while the first request is still running, a retry after the network stalls, a page refreshed
-- after the customer's phone has already shown the prompt. Without a replay guard each duplicate
-- is a real second sale: stock moves twice, the customer is charged twice, and two receipts
-- exist for one basket.
--
-- The key is scoped to (businessId, actorId, scope, key), so one cashier's key can never spend
-- or suppress another's request, and the same key in two different shops is two different
-- requests. The row is written inside the sale's own transaction, so a duplicate insert violates
-- the unique index, the transaction rolls back, and no second sale is ever created.
--
-- Additive and rerunnable: no existing table or column is altered, nothing is dropped, and no
-- historical migration is modified.

CREATE TABLE IF NOT EXISTS "PosIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "PosIdempotencyRecord" ADD CONSTRAINT "PosIdempotencyRecord_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The replay guard itself: one unspent key per (business, actor, action).
DO $$ BEGIN
    ALTER TABLE "PosIdempotencyRecord" ADD CONSTRAINT "PosIdempotencyRecord_businessId_actorId_scope_key_key" UNIQUE ("businessId", "actorId", "scope", "key");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PosIdempotencyRecord_businessId_createdAt_idx"
    ON "PosIdempotencyRecord"("businessId", "createdAt");
