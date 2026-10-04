-- JATA AFTERCALL — Website Studio draft history (Undo / Redo / recovery)
--
-- Purely additive and backwards compatible (spec §50):
--   • BusinessExperience gains one defaulted integer column, so existing drafts are untouched and
--     read exactly as before. 0 means "not tracked yet" and resolves to the newest revision, so a
--     site that was last edited before this migration simply has nothing older to undo to.
--   • ExperienceDraftRevision is a new table; nothing is dropped, renamed or rewritten.
--   • Every statement is guarded (IF NOT EXISTS / duplicate_object), so the migration is safe on a
--     database provisioned outside the migration history and safe to re-run.
--
-- Money and limits are unchanged: subscription, payment, entitlement and publishing tables are
-- not touched in any way, and publication is never automatic.

-- AlterTable: where the draft currently sits in its own history (§45)
ALTER TABLE "BusinessExperience" ADD COLUMN IF NOT EXISTS "historyCursor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: bounded snapshots of the draft, one per owner-visible change (§45)
CREATE TABLE IF NOT EXISTS "ExperienceDraftRevision" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL DEFAULT 'EDIT',
    "snapshotJson" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperienceDraftRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExperienceDraftRevision_businessId_draftVersion_key" ON "ExperienceDraftRevision"("businessId", "draftVersion");

CREATE INDEX IF NOT EXISTS "ExperienceDraftRevision_businessId_createdAt_idx" ON "ExperienceDraftRevision"("businessId", "createdAt");

-- Foreign key: tenant-scoped and cascade on business deletion, matching the other Studio tables.
DO $$ BEGIN
    ALTER TABLE "ExperienceDraftRevision" ADD CONSTRAINT "ExperienceDraftRevision_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
