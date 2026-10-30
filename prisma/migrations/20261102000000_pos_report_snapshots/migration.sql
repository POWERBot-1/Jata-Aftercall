-- Immutable historical captures. A business deletion still cascades, consistent with other POS
-- records; ordinary writes cannot revise or delete a finalized record.
CREATE TABLE IF NOT EXISTS "PosReportSnapshot" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL DEFAULT '',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL,
  "supersedesId" TEXT,
  "reason" TEXT,
  "finalizedById" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB NOT NULL,
  CONSTRAINT "PosReportSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosReportSnapshot_businessId_scopeKey_periodStart_periodEnd_revision_key"
  ON "PosReportSnapshot"("businessId", "scopeKey", "periodStart", "periodEnd", "revision");
CREATE INDEX IF NOT EXISTS "PosReportSnapshot_businessId_scopeKey_periodStart_periodEnd_idx"
  ON "PosReportSnapshot"("businessId", "scopeKey", "periodStart", "periodEnd");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosReportSnapshot_businessId_fkey' AND conrelid = '"PosReportSnapshot"'::regclass) THEN
    ALTER TABLE "PosReportSnapshot" ADD CONSTRAINT "PosReportSnapshot_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pos_report_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Finalized POS report snapshots are immutable';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_report_snapshot_immutable_guard' AND tgrelid = '"PosReportSnapshot"'::regclass) THEN
    CREATE TRIGGER pos_report_snapshot_immutable_guard BEFORE UPDATE OR DELETE ON "PosReportSnapshot"
    FOR EACH ROW EXECUTE FUNCTION pos_report_snapshot_immutable();
  END IF;
END $$;
