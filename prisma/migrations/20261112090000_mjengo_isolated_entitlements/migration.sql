-- Isolate live ERP PRO and MJENGO OS subscription/entitlement records.
-- Legacy shared ErpSubscription/ErpEntitlement rows are preserved unchanged as historical records.
-- All new active product state is stored in its own tenant-scoped tables.
CREATE TABLE "ErpProSubscription" (
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
CREATE UNIQUE INDEX "ErpProSubscription_businessId_key" ON "ErpProSubscription"("businessId");
CREATE INDEX "ErpProSubscription_businessId_status_idx" ON "ErpProSubscription"("businessId", "status");
CREATE INDEX "ErpProSubscription_paymentId_idx" ON "ErpProSubscription"("paymentId");
ALTER TABLE "ErpProSubscription" ADD CONSTRAINT "ErpProSubscription_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ErpProEntitlement" (
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
CREATE UNIQUE INDEX "ErpProEntitlement_businessId_key" ON "ErpProEntitlement"("businessId");
CREATE INDEX "ErpProEntitlement_businessId_status_idx" ON "ErpProEntitlement"("businessId", "status");
ALTER TABLE "ErpProEntitlement" ADD CONSTRAINT "ErpProEntitlement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MjengoSubscription" (
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
CREATE UNIQUE INDEX "MjengoSubscription_businessId_key" ON "MjengoSubscription"("businessId");
CREATE INDEX "MjengoSubscription_businessId_status_idx" ON "MjengoSubscription"("businessId", "status");
CREATE INDEX "MjengoSubscription_paymentId_idx" ON "MjengoSubscription"("paymentId");
ALTER TABLE "MjengoSubscription" ADD CONSTRAINT "MjengoSubscription_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MjengoEntitlement" (
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
CREATE UNIQUE INDEX "MjengoEntitlement_businessId_key" ON "MjengoEntitlement"("businessId");
CREATE INDEX "MjengoEntitlement_businessId_status_idx" ON "MjengoEntitlement"("businessId", "status");
ALTER TABLE "MjengoEntitlement" ADD CONSTRAINT "MjengoEntitlement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
