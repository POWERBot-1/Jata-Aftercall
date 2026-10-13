-- Sale-price windows for the catalogue (approved pricing policy C).
--
-- A sale price applies only inside [salePriceStartsAt, salePriceEndsAt): start-inclusive, end-exclusive,
-- stored in UTC. Outside the window, or when no window is set, the base price is charged.
--
-- Safety:
--  * Additive only. Two nullable columns are added to "Product". No existing row is updated, no column is
--    dropped or retyped, and no existing data is changed.
--  * Existing sale prices (Product.salePriceKES, set before this migration) have no window, so they do NOT
--    run after this migration. This is deliberate: a sale without dates is never extended indefinitely.
--    Owners must set start and end times to run them again.
--  * A CHECK constraint stops a window from ending before it starts. It allows NULL on either side, so a
--    half-set window is caught by the application (lib/sale-pricing.ts), not by this constraint.
--  * Rerunnable: IF NOT EXISTS on columns, and the constraint is added only if it is missing.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "salePriceStartsAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "salePriceEndsAt" TIMESTAMP(3);

DO $$
BEGIN
    ALTER TABLE "Product"
        ADD CONSTRAINT "Product_sale_window_order"
        CHECK ("salePriceStartsAt" IS NULL OR "salePriceEndsAt" IS NULL OR "salePriceStartsAt" < "salePriceEndsAt");
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
