-- Media metadata compare-and-swap token: one additive, defaulted integer column only.
-- Existing rows read as version 0; no historical data is rewritten or backfilled.
-- Apply this migration before deploying application code that selects/writes MediaAsset.version.
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
