-- JATA Website Studio 2.0 — P2 independent multi-site content data plane.
-- Draft/published content and publication history are scoped to a StudioWebsite.
-- Existing BusinessExperience rows remain untouched and are copied only as initial
-- content for the corresponding default site. No payment, subscription, POS or order writes.

CREATE TABLE IF NOT EXISTS "StudioWebsiteContent" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "draftJson" TEXT,
  "publishedJson" TEXT,
  "draftVersion" INTEGER NOT NULL DEFAULT 0,
  "historyCursor" INTEGER NOT NULL DEFAULT 0,
  "publishedVersion" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "publishedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioWebsiteContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudioWebsiteVersion" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "themeKey" TEXT,
  "categoryKey" TEXT,
  "note" TEXT,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioWebsiteVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudioWebsiteContent_websiteId_key"
  ON "StudioWebsiteContent"("websiteId");
CREATE INDEX IF NOT EXISTS "StudioWebsiteContent_websiteId_updatedAt_idx"
  ON "StudioWebsiteContent"("websiteId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "StudioWebsiteVersion_websiteId_version_key"
  ON "StudioWebsiteVersion"("websiteId", "version");
CREATE INDEX IF NOT EXISTS "StudioWebsiteVersion_websiteId_publishedAt_idx"
  ON "StudioWebsiteVersion"("websiteId", "publishedAt");

DO $$ BEGIN
  ALTER TABLE "StudioWebsiteContent" ADD CONSTRAINT "StudioWebsiteContent_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "StudioWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWebsiteVersion" ADD CONSTRAINT "StudioWebsiteVersion_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "StudioWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS "StudioWebsiteDraftRevision" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'EDIT',
  "label" TEXT,
  "snapshotJson" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioWebsiteDraftRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudioWebsiteDraftRevision_websiteId_draftVersion_key"
  ON "StudioWebsiteDraftRevision"("websiteId", "draftVersion");
CREATE INDEX IF NOT EXISTS "StudioWebsiteDraftRevision_websiteId_createdAt_idx"
  ON "StudioWebsiteDraftRevision"("websiteId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "StudioWebsiteDraftRevision" ADD CONSTRAINT "StudioWebsiteDraftRevision_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "StudioWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Preserve the old single-site experience as the initial draft/published content for
-- each existing default website. The old records are deliberately not deleted or rewritten.
INSERT INTO "StudioWebsiteContent"
  ("id", "websiteId", "draftJson", "publishedJson", "draftVersion", "publishedVersion", "publishedAt", "publishedById", "updatedAt")
SELECT
  'swc_' || md5(w."id"),
  w."id",
  e."draftJson",
  e."publishedJson",
  e."draftVersion",
  e."publishedVersion",
  e."publishedAt",
  e."publishedById",
  CURRENT_TIMESTAMP
FROM "StudioWebsite" w
JOIN "BusinessExperience" e ON e."businessId" = w."businessId"
WHERE w."isDefault" = true
ON CONFLICT ("websiteId") DO NOTHING;

-- Preserve a recoverable initial draft snapshot for each migrated default site.
INSERT INTO "StudioWebsiteDraftRevision"
  ("id", "websiteId", "draftVersion", "source", "label", "snapshotJson", "createdById", "createdAt")
SELECT
  'swdr_' || md5(w."id" || ':' || e."draftVersion"),
  w."id",
  e."draftVersion",
  'MIGRATION',
  'Initial draft copied from the existing Website Studio',
  e."draftJson",
  NULL,
  CURRENT_TIMESTAMP
FROM "StudioWebsite" w
JOIN "BusinessExperience" e ON e."businessId" = w."businessId"
WHERE w."isDefault" = true
  AND e."draftVersion" > 0
  AND e."draftJson" IS NOT NULL
ON CONFLICT ("websiteId", "draftVersion") DO NOTHING;

-- Seed the immutable history with the last known published snapshot only.
INSERT INTO "StudioWebsiteVersion"
  ("id", "websiteId", "version", "snapshotJson", "themeKey", "categoryKey", "note", "publishedById", "publishedAt")
SELECT
  'swv_' || md5(w."id" || ':' || e."publishedVersion"),
  w."id",
  e."publishedVersion",
  e."publishedJson",
  e."themeKey",
  e."categoryKey",
  'Migrated from the existing default Website Studio publication',
  e."publishedById",
  COALESCE(e."publishedAt", CURRENT_TIMESTAMP)
FROM "StudioWebsite" w
JOIN "BusinessExperience" e ON e."businessId" = w."businessId"
WHERE w."isDefault" = true
  AND e."publishedVersion" > 0
  AND e."publishedJson" IS NOT NULL
ON CONFLICT ("websiteId", "version") DO NOTHING;
