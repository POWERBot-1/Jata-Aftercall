-- JATA AFTERCALL — Website Studio AI (photo generation, enhancement, provenance)
--
-- Purely additive and backwards compatible (spec §50):
--   • MediaAsset gains nullable/defaulted columns, so existing rows are untouched and existing
--     uploads keep working with source = 'UPLOAD'.
--   • AiGeneration is a new table; nothing is dropped, renamed or rewritten.
--   • Every statement is guarded (IF NOT EXISTS / duplicate_object), so the migration is safe on
--     a database provisioned outside the migration history and safe to re-run.
--
-- Money and limits are unchanged: this migration does not touch subscription, payment,
-- entitlement or publishing tables in any way.

-- AlterTable: media provenance and normalisation metadata (§18, §20, §43)
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "mime" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'UPLOAD';
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "aiGenerationId" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "parentAssetId" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "MediaAsset_businessId_source_idx" ON "MediaAsset"("businessId", "source");

CREATE INDEX IF NOT EXISTS "MediaAsset_businessId_kind_idx" ON "MediaAsset"("businessId", "kind");

-- CreateTable: AI generation history + usage meter (§17, §43, §51)
CREATE TABLE IF NOT EXISTS "AiGeneration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "capability" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "prompt" TEXT,
    "promptHash" TEXT,
    "providerKey" TEXT NOT NULL DEFAULT 'jata-local',
    "modelKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "assetIds" TEXT,
    "selectedAssetId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiGeneration_businessId_createdAt_idx" ON "AiGeneration"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "AiGeneration_businessId_status_idx" ON "AiGeneration"("businessId", "status");

CREATE INDEX IF NOT EXISTS "AiGeneration_businessId_promptHash_idx" ON "AiGeneration"("businessId", "promptHash");

CREATE INDEX IF NOT EXISTS "AiGeneration_businessId_kind_status_idx" ON "AiGeneration"("businessId", "kind", "status");

-- Foreign keys: tenant-scoped and cascade on business deletion, matching MediaAsset.
DO $$ BEGIN
    ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
