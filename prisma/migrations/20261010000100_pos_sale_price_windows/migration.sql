-- Sale-price windows for POS products (approved pricing policy C, same rule as the catalogue).
--
-- Additive only. Three nullable columns are added to "PosProduct": the sale price and its window. No
-- existing row is updated and no existing column is changed. A POS product with no sale price, or with a
-- sale price and no window, keeps charging its list price (priceKES).
--  * Rerunnable: IF NOT EXISTS on columns, and the constraint is added only if it is missing.
--  * CHECK: a window must end after it starts when both ends are set.

ALTER TABLE "PosProduct" ADD COLUMN IF NOT EXISTS "salePriceKES" INTEGER;
ALTER TABLE "PosProduct" ADD COLUMN IF NOT EXISTS "salePriceStartsAt" TIMESTAMP(3);
ALTER TABLE "PosProduct" ADD COLUMN IF NOT EXISTS "salePriceEndsAt" TIMESTAMP(3);

DO $$
BEGIN
    ALTER TABLE "PosProduct"
        ADD CONSTRAINT "PosProduct_sale_window_order"
        CHECK ("salePriceStartsAt" IS NULL OR "salePriceEndsAt" IS NULL OR "salePriceStartsAt" < "salePriceEndsAt");
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
