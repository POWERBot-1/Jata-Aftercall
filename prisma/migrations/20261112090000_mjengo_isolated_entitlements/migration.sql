-- Isolate live ERP PRO and MJENGO OS subscription/entitlement records.
-- Legacy shared ErpSubscription/ErpEntitlement rows are preserved unchanged as historical records.
-- All new active product state is stored in its own tenant-scoped tables.
CREATE TABLE IF NOT EXISTS "ErpProSubscription" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "planKey" TEXT NOT NULL DEFAULT 'ERP_PRO',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "startAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "graceUntil" TIMESTAMP(3),
  "paymentId" TEXT,
  "paymentReference" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpProSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpProSubscription_businessId_key" ON "ErpProSubscription"("businessId");
CREATE INDEX IF NOT EXISTS "ErpProSubscription_businessId_status_idx" ON "ErpProSubscription"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpProSubscription_paymentId_idx" ON "ErpProSubscription"("paymentId");
DO $ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErpProSubscription_businessId_fkey'
  ) THEN
    ALTER TABLE "ErpProSubscription" ADD CONSTRAINT "ErpProSubscription_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $;

CREATE TABLE IF NOT EXISTS "ErpProEntitlement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "packageKey" TEXT NOT NULL DEFAULT 'ERP_PRO',
  "status" TEXT NOT NULL DEFAULT 'NONE',
  "activatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpProEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpProEntitlement_businessId_key" ON "ErpProEntitlement"("businessId");
CREATE INDEX IF NOT EXISTS "ErpProEntitlement_businessId_status_idx" ON "ErpProEntitlement"("businessId", "status");
DO $ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErpProEntitlement_businessId_fkey'
  ) THEN
    ALTER TABLE "ErpProEntitlement" ADD CONSTRAINT "ErpProEntitlement_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $;

CREATE TABLE IF NOT EXISTS "MjengoSubscription" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "planKey" TEXT NOT NULL DEFAULT 'MJENGO_OS',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "startAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "graceUntil" TIMESTAMP(3),
  "paymentId" TEXT,
  "paymentReference" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MjengoSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MjengoSubscription_businessId_key" ON "MjengoSubscription"("businessId");
CREATE INDEX IF NOT EXISTS "MjengoSubscription_businessId_status_idx" ON "MjengoSubscription"("businessId", "status");
CREATE INDEX IF NOT EXISTS "MjengoSubscription_paymentId_idx" ON "MjengoSubscription"("paymentId");
DO $ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MjengoSubscription_businessId_fkey'
  ) THEN
    ALTER TABLE "MjengoSubscription" ADD CONSTRAINT "MjengoSubscription_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $;

CREATE TABLE IF NOT EXISTS "MjengoEntitlement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "packageKey" TEXT NOT NULL DEFAULT 'MJENGO_OS',
  "status" TEXT NOT NULL DEFAULT 'NONE',
  "activatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MjengoEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MjengoEntitlement_businessId_key" ON "MjengoEntitlement"("businessId");
CREATE INDEX IF NOT EXISTS "MjengoEntitlement_businessId_status_idx" ON "MjengoEntitlement"("businessId", "status");
DO $ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MjengoEntitlement_businessId_fkey'
  ) THEN
    ALTER TABLE "MjengoEntitlement" ADD CONSTRAINT "MjengoEntitlement_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $;

-- Preserve legacy ERP PRO state in the new active ERP PRO tables.
INSERT INTO "ErpProSubscription" (
  "id", "businessId", "userId", "planId", "planKey", "status", "startAt", "expiresAt",
  "graceUntil", "paymentId", "paymentReference", "cancelledAt", "createdAt", "updatedAt"
)
SELECT
  'erp_pro_' || s."id", s."businessId", s."userId", s."planId", 'ERP_PRO', s."status",
  s."startAt", s."expiresAt", s."graceUntil", s."paymentId", s."paymentReference",
  s."cancelledAt", s."createdAt", CURRENT_TIMESTAMP
FROM "ErpSubscription" s
WHERE s."planKey" = 'ERP_PRO'
ON CONFLICT ("businessId") DO NOTHING;

INSERT INTO "ErpProEntitlement" (
  "id", "businessId", "packageKey", "status", "activatedAt", "expiresAt", "createdAt", "updatedAt"
)
SELECT
  'erp_pro_' || e."id", e."businessId", 'ERP_PRO', e."status", e."activatedAt",
  e."expiresAt", e."createdAt", CURRENT_TIMESTAMP
FROM "ErpEntitlement" e
WHERE e."packageKey" = 'ERP_PRO'
ON CONFLICT ("businessId") DO NOTHING;

-- Preserve legacy MJENGO-only paid state in dedicated MJENGO tables.
INSERT INTO "MjengoSubscription" (
  "id", "businessId", "userId", "planId", "planKey", "status", "startAt", "expiresAt",
  "graceUntil", "paymentId", "paymentReference", "cancelledAt", "createdAt", "updatedAt"
)
SELECT
  'mjengo_' || s."id", s."businessId", s."userId", s."planId", 'MJENGO_OS', s."status",
  s."startAt", s."expiresAt", s."graceUntil", s."paymentId", s."paymentReference",
  s."cancelledAt", s."createdAt", CURRENT_TIMESTAMP
FROM "ErpSubscription" s
WHERE s."planKey" = 'MJENGO_OS'
ON CONFLICT ("businessId") DO NOTHING;

INSERT INTO "MjengoEntitlement" (
  "id", "businessId", "packageKey", "status", "activatedAt", "expiresAt", "createdAt", "updatedAt"
)
SELECT
  'mjengo_' || e."id", e."businessId", 'MJENGO_OS', e."status", e."activatedAt",
  e."expiresAt", e."createdAt", CURRENT_TIMESTAMP
FROM "ErpEntitlement" e
WHERE e."packageKey" = 'MJENGO_OS'
ON CONFLICT ("businessId") DO NOTHING;
