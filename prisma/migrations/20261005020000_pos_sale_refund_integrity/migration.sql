-- POS refund integrity (§30, §32, §54): additive columns and one new table.
--
-- Additive and rerunnable: existing sales, items and receipt numbers are untouched.
--
-- 1. creditRefundedKES — of a sale's refunded total, the part already applied against the
--    customer's receivable. A credit refund never produces cash, so the till's refund split
--    (cash part vs credit part) is auditable from the sale row alone.
ALTER TABLE "PosSale"
    ADD COLUMN IF NOT EXISTS "creditRefundedKES" INTEGER NOT NULL DEFAULT 0;

-- 2. returnedQty — how much of a sale line has already been returned. A line may only ever be
--    returned up to its quantity; the refund engine enforces this atomically against the row.
ALTER TABLE "PosSaleItem"
    ADD COLUMN IF NOT EXISTS "returnedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 3. PosReceiptSequence — the single allocation point for sale receipt numbers, so concurrent
--    sales cannot pick the same sequence (§32). One row per business; allocated by an atomic
--    upsert inside the sale transaction.
CREATE TABLE IF NOT EXISTS "PosReceiptSequence" (
    "businessId" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "PosReceiptSequence_pkey" PRIMARY KEY ("businessId")
);

CREATE INDEX IF NOT EXISTS "PosReceiptSequence_businessId_idx"
    ON "PosReceiptSequence"("businessId");

-- Backfill from existing sales: receipt numbers keep increasing per business, and a business
-- that has not sold yet starts from 1 on first use (the upsert creates the row).
INSERT INTO "PosReceiptSequence" ("businessId", "nextValue")
SELECT "businessId", COALESCE(MAX("sequence"), 0) + 1
FROM "PosSale"
GROUP BY "businessId"
ON CONFLICT ("businessId") DO NOTHING;
