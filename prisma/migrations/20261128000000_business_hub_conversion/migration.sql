-- JATA Business Hub — customer conversion & retention (additive only).
--
-- Included in the EXISTING KES149 monthly / KES999 annual Business Page subscription.
-- Nothing in this migration touches pricing, plans, subscriptions, payment verification or
-- entitlements: no existing table is altered, no existing row is read or rewritten, and no
-- NOT NULL column is added to an existing table.
--
-- Creates nine new tables and two enum types:
--   OrderRequest / OrderRequestItem  — instant order requests (enquiries, not payments)
--   CustomerEnquiry                  — general customer enquiries
--   Promotion                        — Promotional Spotlight campaigns
--   LoyaltyProgram / LoyaltyCard / LoyaltyStampEvent / LoyaltyRedemption — owner-verified loyalty
--   BusinessHubActivity              — shared append-only activity / audit trail
--
-- ROLLBACK: every object below is created by this migration and nothing else references it, so
--   the reverse is to remove the nine tables and two enum types in the reverse order — the exact
--   statements are in docs/business-hub/BUSINESS_HUB_IMPLEMENTATION.md (§Rollback), kept out of
--   this file because the repository's migration guard rejects any migration whose SQL text
--   contains a destructive statement, comment or not. The five capabilities are additive
--   UI/API surfaces: removing them restores the previous behaviour without touching any other
--   table, and no subscription, payment or entitlement is affected either way.

-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('NEW', 'REVIEWING', 'CONFIRMED', 'DECLINED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerEnquiryStatus" AS ENUM ('NEW', 'REVIEWING', 'CONTACTED', 'CLOSED', 'DECLINED');

-- CreateTable
CREATE TABLE "OrderRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactMethod" TEXT NOT NULL,
    "contactValue" TEXT NOT NULL,
    "message" TEXT,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'NEW',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedTotalKES" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'BUSINESS_PAGE',
    "ownerNotes" TEXT,
    "ipHash" TEXT,
    "sessionHash" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRequestItem" (
    "id" TEXT NOT NULL,
    "orderRequestId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceKES" INTEGER NOT NULL DEFAULT 0,
    "lineTotalKES" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerEnquiry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactMethod" TEXT NOT NULL,
    "contactValue" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" "CustomerEnquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'BUSINESS_PAGE',
    "ownerNotes" TEXT,
    "ipHash" TEXT,
    "sessionHash" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT,
    "badge" TEXT,
    "discountLabel" TEXT,
    "imageUrl" TEXT,
    "ctaLabel" TEXT,
    "ctaKind" TEXT NOT NULL DEFAULT 'NONE',
    "ctaValue" TEXT,
    "productIds" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "stampGoal" INTEGER NOT NULL DEFAULT 8,
    "maxStampsPerVisit" INTEGER NOT NULL DEFAULT 1,
    "rewardDescription" TEXT NOT NULL DEFAULT 'Free reward — ask the business for details',
    "terms" TEXT,
    "cardPrefix" TEXT NOT NULL DEFAULT 'JATA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCard" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactMethod" TEXT,
    "contactValue" TEXT,
    "stampsEarned" INTEGER NOT NULL DEFAULT 0,
    "stampsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerNotes" TEXT,
    "lastStampAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyStampEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "stamps" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "awardedByUserId" TEXT,
    "awardedByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyStampEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRedemption" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "stampsRedeemed" INTEGER NOT NULL,
    "rewardDescription" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "verifiedByUserId" TEXT,
    "verifiedByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHubActivity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "summary" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessHubActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderRequest_reference_key" ON "OrderRequest"("reference");

-- CreateIndex — the double-tap / replay guard for public submissions
CREATE UNIQUE INDEX "OrderRequest_businessId_requestKey_key" ON "OrderRequest"("businessId", "requestKey");

-- CreateIndex
CREATE INDEX "OrderRequest_businessId_status_idx" ON "OrderRequest"("businessId", "status");

-- CreateIndex
CREATE INDEX "OrderRequest_businessId_createdAt_idx" ON "OrderRequest"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderRequest_businessId_contactValue_idx" ON "OrderRequest"("businessId", "contactValue");

-- CreateIndex
CREATE INDEX "OrderRequestItem_orderRequestId_idx" ON "OrderRequestItem"("orderRequestId");

-- CreateIndex
CREATE INDEX "OrderRequestItem_businessId_idx" ON "OrderRequestItem"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerEnquiry_reference_key" ON "CustomerEnquiry"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerEnquiry_businessId_requestKey_key" ON "CustomerEnquiry"("businessId", "requestKey");

-- CreateIndex
CREATE INDEX "CustomerEnquiry_businessId_status_idx" ON "CustomerEnquiry"("businessId", "status");

-- CreateIndex
CREATE INDEX "CustomerEnquiry_businessId_createdAt_idx" ON "CustomerEnquiry"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerEnquiry_businessId_contactValue_idx" ON "CustomerEnquiry"("businessId", "contactValue");

-- CreateIndex
CREATE INDEX "Promotion_businessId_isActive_endsAt_idx" ON "Promotion"("businessId", "isActive", "endsAt");

-- CreateIndex
CREATE INDEX "Promotion_businessId_startsAt_idx" ON "Promotion"("businessId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_businessId_key" ON "LoyaltyProgram"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCard_code_key" ON "LoyaltyCard"("code");

-- CreateIndex
CREATE INDEX "LoyaltyCard_businessId_contactValue_idx" ON "LoyaltyCard"("businessId", "contactValue");

-- CreateIndex
CREATE INDEX "LoyaltyCard_businessId_createdAt_idx" ON "LoyaltyCard"("businessId", "createdAt");

-- CreateIndex — the duplicate-verification guard
CREATE UNIQUE INDEX "LoyaltyStampEvent_businessId_transactionRef_key" ON "LoyaltyStampEvent"("businessId", "transactionRef");

-- CreateIndex
CREATE INDEX "LoyaltyStampEvent_cardId_createdAt_idx" ON "LoyaltyStampEvent"("cardId", "createdAt");

-- CreateIndex — the duplicate-redemption guard
CREATE UNIQUE INDEX "LoyaltyRedemption_cardId_cycleIndex_key" ON "LoyaltyRedemption"("cardId", "cycleIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyRedemption_reference_key" ON "LoyaltyRedemption"("reference");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_businessId_createdAt_idx" ON "LoyaltyRedemption"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessHubActivity_businessId_createdAt_idx" ON "BusinessHubActivity"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessHubActivity_businessId_subjectType_subjectId_idx" ON "BusinessHubActivity"("businessId", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "OrderRequest" ADD CONSTRAINT "OrderRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRequestItem" ADD CONSTRAINT "OrderRequestItem_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "OrderRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRequestItem" ADD CONSTRAINT "OrderRequestItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerEnquiry" ADD CONSTRAINT "CustomerEnquiry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyStampEvent" ADD CONSTRAINT "LoyaltyStampEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyStampEvent" ADD CONSTRAINT "LoyaltyStampEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHubActivity" ADD CONSTRAINT "BusinessHubActivity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
