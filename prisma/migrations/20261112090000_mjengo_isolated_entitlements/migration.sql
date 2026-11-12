-- Dedicated MJENGO OS subscription and entitlement storage.
-- Additive schema plus a scoped data move: ERP_PRO, POS, payment and customer records are preserved.
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

-- Preserve MJENGO-only paid state previously stored in the shared ERP rows.
-- ERP_PRO rows are excluded and remain untouched.
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

-- After the MJENGO copies exist, free the legacy one-row ERP slots for ERP_PRO.
-- These predicates delete only the exact MJENGO discriminator; no ERP_PRO row can match.
DELETE FROM "ErpSubscription" WHERE "planKey" = 'MJENGO_OS';
DELETE FROM "ErpEntitlement" WHERE "packageKey" = 'MJENGO_OS';
