-- JATA Website Studio 2.0 — P1 workspace and website tenancy foundation.
-- Additive only. Does not alter subscription, payment, POS, BusinessExperience,
-- published documents, media, customer records, or public Business Page routes.
-- Backfills one default workspace/site for each existing BusinessExperience row.

CREATE TABLE IF NOT EXISTS "StudioWorkspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudioWorkspaceMember" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioWorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudioWorkspaceBusiness" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioWorkspaceBusiness_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudioWebsite" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioWebsite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudioWebsiteMember" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioWebsiteMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudioWorkspaceMember_workspaceId_userId_key"
  ON "StudioWorkspaceMember"("workspaceId", "userId");
CREATE INDEX IF NOT EXISTS "StudioWorkspaceMember_userId_status_idx"
  ON "StudioWorkspaceMember"("userId", "status");
CREATE INDEX IF NOT EXISTS "StudioWorkspaceMember_workspaceId_status_idx"
  ON "StudioWorkspaceMember"("workspaceId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StudioWorkspaceBusiness_businessId_key"
  ON "StudioWorkspaceBusiness"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "StudioWorkspaceBusiness_workspaceId_businessId_key"
  ON "StudioWorkspaceBusiness"("workspaceId", "businessId");
CREATE INDEX IF NOT EXISTS "StudioWorkspaceBusiness_workspaceId_idx"
  ON "StudioWorkspaceBusiness"("workspaceId");
CREATE INDEX IF NOT EXISTS "StudioWorkspace_ownerUserId_status_idx"
  ON "StudioWorkspace"("ownerUserId", "status");
CREATE INDEX IF NOT EXISTS "StudioWorkspace_updatedAt_idx"
  ON "StudioWorkspace"("updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "StudioWebsite_businessId_slug_key"
  ON "StudioWebsite"("businessId", "slug");
CREATE INDEX IF NOT EXISTS "StudioWebsite_workspaceId_updatedAt_idx"
  ON "StudioWebsite"("workspaceId", "updatedAt");
CREATE INDEX IF NOT EXISTS "StudioWebsite_businessId_isDefault_idx"
  ON "StudioWebsite"("businessId", "isDefault");
CREATE INDEX IF NOT EXISTS "StudioWebsite_businessId_status_idx"
  ON "StudioWebsite"("businessId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StudioWebsiteMember_websiteId_userId_key"
  ON "StudioWebsiteMember"("websiteId", "userId");
CREATE INDEX IF NOT EXISTS "StudioWebsiteMember_userId_status_idx"
  ON "StudioWebsiteMember"("userId", "status");
CREATE INDEX IF NOT EXISTS "StudioWebsiteMember_websiteId_status_idx"
  ON "StudioWebsiteMember"("websiteId", "status");

DO $$ BEGIN
  ALTER TABLE "StudioWorkspace" ADD CONSTRAINT "StudioWorkspace_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWorkspaceMember" ADD CONSTRAINT "StudioWorkspaceMember_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "StudioWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWorkspaceMember" ADD CONSTRAINT "StudioWorkspaceMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWorkspaceBusiness" ADD CONSTRAINT "StudioWorkspaceBusiness_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "StudioWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWorkspaceBusiness" ADD CONSTRAINT "StudioWorkspaceBusiness_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWebsite" ADD CONSTRAINT "StudioWebsite_workspaceId_businessId_fkey"
    FOREIGN KEY ("workspaceId", "businessId")
    REFERENCES "StudioWorkspaceBusiness"("workspaceId", "businessId")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWebsiteMember" ADD CONSTRAINT "StudioWebsiteMember_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "StudioWebsite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioWebsiteMember" ADD CONSTRAINT "StudioWebsiteMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill is limited to businesses that already have a Website Studio experience.
-- Deterministic IDs make this migration safely re-runnable and auditable.
INSERT INTO "StudioWorkspace" ("id", "name", "ownerUserId", "status", "createdAt", "updatedAt")
SELECT 'ws_' || md5(b."id"), b."name" || ' Workspace', b."ownerId", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business" b
JOIN "BusinessExperience" e ON e."businessId" = b."id"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "StudioWorkspaceBusiness" ("id", "workspaceId", "businessId", "createdAt")
SELECT 'wsb_' || md5(b."id"), 'ws_' || md5(b."id"), b."id", CURRENT_TIMESTAMP
FROM "Business" b
JOIN "BusinessExperience" e ON e."businessId" = b."id"
ON CONFLICT ("businessId") DO NOTHING;

INSERT INTO "StudioWorkspaceMember" ("id", "workspaceId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT 'wsm_' || md5(b."id" || ':' || u."id"), 'ws_' || md5(b."id"), u."id",
       CASE WHEN u."id" = b."ownerId" THEN 'OWNER'
            WHEN upper(COALESCE(bm."role", 'VIEWER')) = 'ADMIN' THEN 'ADMIN'
            WHEN upper(COALESCE(bm."role", 'VIEWER')) IN ('MANAGER', 'STAFF') THEN 'EDITOR'
            WHEN upper(COALESCE(bm."role", 'VIEWER')) = 'OWNER' THEN 'ADMIN'
            ELSE 'VIEWER' END,
       'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business" b
JOIN "BusinessExperience" e ON e."businessId" = b."id"
CROSS JOIN LATERAL (
  SELECT b."ownerId" AS "id"
  UNION
  SELECT bm."userId" AS "id" FROM "BusinessMember" bm WHERE bm."businessId" = b."id"
) u
LEFT JOIN "BusinessMember" bm ON bm."businessId" = b."id" AND bm."userId" = u."id"
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

INSERT INTO "StudioWebsite" ("id", "workspaceId", "businessId", "slug", "name", "status", "isDefault", "createdAt", "updatedAt")
SELECT 'site_' || md5(b."id"), 'ws_' || md5(b."id"), b."id", 'default',
       b."name" || ' Website',
       CASE WHEN e."status" = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END,
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business" b
JOIN "BusinessExperience" e ON e."businessId" = b."id"
ON CONFLICT ("businessId", "slug") DO NOTHING;

INSERT INTO "StudioWebsiteMember" ("id", "websiteId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT 'wsite_' || md5(b."id" || ':' || u."id"), 'site_' || md5(b."id"), u."id",
       CASE WHEN u."id" = b."ownerId" THEN 'OWNER'
            WHEN upper(COALESCE(bm."role", 'VIEWER')) = 'ADMIN' THEN 'ADMIN'
            WHEN upper(COALESCE(bm."role", 'VIEWER')) IN ('MANAGER', 'STAFF') THEN 'EDITOR'
            WHEN upper(COALESCE(bm."role", 'VIEWER')) = 'OWNER' THEN 'ADMIN'
            ELSE 'VIEWER' END,
       'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business" b
JOIN "BusinessExperience" e ON e."businessId" = b."id"
CROSS JOIN LATERAL (
  SELECT b."ownerId" AS "id"
  UNION
  SELECT bm."userId" AS "id" FROM "BusinessMember" bm WHERE bm."businessId" = b."id"
) u
LEFT JOIN "BusinessMember" bm ON bm."businessId" = b."id" AND bm."userId" = u."id"
ON CONFLICT ("websiteId", "userId") DO NOTHING;
