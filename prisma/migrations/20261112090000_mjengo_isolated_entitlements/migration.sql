-- Dedicated MJENGO OS subscription and entitlement storage.
-- Additive only: existing ERP PRO, POS, payment, and customer records are not modified.
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
