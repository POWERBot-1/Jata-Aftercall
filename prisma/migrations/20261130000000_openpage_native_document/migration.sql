CREATE TABLE "OpenPageSiteDocument" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "draftJson" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL DEFAULT 1,
  "publishedJson" TEXT,
  "publishedVersion" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "publishedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenPageSiteDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenPageSiteDocument_websiteId_key" ON "OpenPageSiteDocument"("websiteId");
CREATE INDEX "OpenPageSiteDocument_websiteId_updatedAt_idx" ON "OpenPageSiteDocument"("websiteId", "updatedAt");

ALTER TABLE "OpenPageSiteDocument"
ADD CONSTRAINT "OpenPageSiteDocument_websiteId_fkey"
FOREIGN KEY ("websiteId") REFERENCES "StudioWebsite"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OpenPageSiteRevision" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'EDIT',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenPageSiteRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenPageSiteRevision_websiteId_draftVersion_key"
ON "OpenPageSiteRevision"("websiteId", "draftVersion");
CREATE INDEX "OpenPageSiteRevision_websiteId_createdAt_idx"
ON "OpenPageSiteRevision"("websiteId", "createdAt");

ALTER TABLE "OpenPageSiteRevision"
ADD CONSTRAINT "OpenPageSiteRevision_websiteId_fkey"
FOREIGN KEY ("websiteId") REFERENCES "OpenPageSiteDocument"("websiteId")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OpenPageSitePublication" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "note" TEXT,
  "publishedById" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenPageSitePublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenPageSitePublication_websiteId_version_key"
ON "OpenPageSitePublication"("websiteId", "version");
CREATE INDEX "OpenPageSitePublication_websiteId_publishedAt_idx"
ON "OpenPageSitePublication"("websiteId", "publishedAt");

ALTER TABLE "OpenPageSitePublication"
ADD CONSTRAINT "OpenPageSitePublication_websiteId_fkey"
FOREIGN KEY ("websiteId") REFERENCES "OpenPageSiteDocument"("websiteId")
ON DELETE CASCADE ON UPDATE CASCADE;
