-- Fractional quantities (§13, §14): the POS business logic has always accepted three-decimal
-- quantities for measurable units (kilogram, gram, litre, millilitre, metre, centimetre) —
-- `roundQuantity` keeps three decimals and countable units are already stored whole. The Int
-- columns silently dropped the fraction on write (and again on read via Math.trunc), so
-- stock could disagree with the movement ledger by the fraction.
--
-- Widening INTEGER to DOUBLE PRECISION is a lossless type promotion: every existing integer
-- value is exactly representable, no data is deleted or rewritten, and the migration is
-- deterministic and rerunnable on an empty database.
ALTER TABLE "PosSaleItem"
    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

ALTER TABLE "PosInventoryItem"
    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

ALTER TABLE "PosInventoryMovement"
    ALTER COLUMN "delta" SET DATA TYPE DOUBLE PRECISION,
    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

ALTER TABLE "PosOrderItem"
    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

ALTER TABLE "PosPurchaseItem"
    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION,
    ALTER COLUMN "receivedQty" SET DATA TYPE DOUBLE PRECISION;
