-- JATA Loyalty 2.0 — configurable points and rewards (additive only).
--
-- A SECOND loyalty mechanism alongside the existing stamp card. Nothing here alters, reads or
-- rewrites an existing table: the stamp-card tables (LoyaltyProgram, LoyaltyCard,
-- LoyaltyStampEvent, LoyaltyRedemption) are untouched, and no column is added to them. A business
-- that never configures points behaves exactly as it does today.
--
-- Included in the EXISTING KES149 monthly / KES999 annual Business Page subscription. Nothing in
-- this migration touches pricing, plans, subscriptions, payment verification or entitlements.
--
-- Creates six new tables and five enum types:
--   LoyaltyPointsProgramme    — one configuration per business; earning is OFF until activated
--   LoyaltyPointsEligibleItem — the products and services that earn points
--   LoyaltyPointsAccount      — one wallet per customer card; separate from the stamp balance
--   LoyaltyPointsLedger       — append-only, idempotent movement history
--   LoyaltyReward             — the reward catalogue
--   LoyaltyRewardRedemption   — what a customer redeemed, and its life cycle
--
-- Points are never cash, are never paid out, and are never awarded by an order request: an order
-- request takes no payment, so it can never be a qualifying purchase.
--
-- ROLLBACK: every object below is created by this migration and nothing outside it references
--   them, so the reverse is to remove the six tables and five enum types in reverse order. The exact
--   statements are in docs/business-hub/LOYALTY_POINTS_IMPLEMENTATION.md (§Rollback), kept out of
--   this file because the repository's migration guard rejects any migration whose SQL text
--   contains a destructive statement, comment or not.

-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('EARNED', 'REDEEMED', 'EXPIRED', 'REVERSED', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PointsDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "PointsSource" AS ENUM ('OWNER_VERIFIED', 'PAYMENT_PROVIDER', 'CUSTOMER_REDEMPTION', 'SYSTEM_EXPIRY', 'OWNER_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('FIXED_POINTS', 'DISCOUNT', 'PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LoyaltyPointsProgramme" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "kesPerPoint" INTEGER,
    "pointsPerUnit" INTEGER,
    "minPurchaseKES" INTEGER NOT NULL DEFAULT 0,
    "maxPointsPerTransaction" INTEGER,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "pointValueKES" INTEGER,
    "expiryMonths" INTEGER,
    "allowNegativeBalanceOnReversal" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "terms" TEXT,
    "redemptionRules" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyPointsProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPointsEligibleItem" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPointsEligibleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPointsAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "availablePoints" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
    "lifetimeExpired" INTEGER NOT NULL DEFAULT 0,
    "pointsPending" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyPointsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPointsLedger" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "direction" "PointsDirection" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" "PointsSource" NOT NULL,
    "sourceReference" TEXT,
    "reversalOfId" TEXT,
    "explanation" TEXT,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "expiresAt" TIMESTAMP(3),
    "remainingPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyReward" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "RewardKind" NOT NULL DEFAULT 'FIXED_POINTS',
    "pointsCost" INTEGER NOT NULL,
    "discountKES" INTEGER,
    "itemKind" TEXT,
    "itemId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRewardRedemption" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rewardTitleSnapshot" TEXT NOT NULL,
    "rewardKindSnapshot" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "customerNote" TEXT,
    "fulfilledByUserId" TEXT,
    "fulfilledByLabel" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — one points programme per business
CREATE UNIQUE INDEX "LoyaltyPointsProgramme_businessId_key" ON "LoyaltyPointsProgramme"("businessId");

-- CreateIndex — an item can only be listed once per programme
CREATE UNIQUE INDEX "LoyaltyPointsEligibleItem_programmeId_itemKind_itemId_key" ON "LoyaltyPointsEligibleItem"("programmeId", "itemKind", "itemId");

-- CreateIndex
CREATE INDEX "LoyaltyPointsEligibleItem_programmeId_idx" ON "LoyaltyPointsEligibleItem"("programmeId");

-- CreateIndex — one wallet per customer card, so the card code opens both mechanisms
CREATE UNIQUE INDEX "LoyaltyPointsAccount_cardId_key" ON "LoyaltyPointsAccount"("cardId");

-- CreateIndex
CREATE INDEX "LoyaltyPointsAccount_businessId_availablePoints_idx" ON "LoyaltyPointsAccount"("businessId", "availablePoints");

-- CreateIndex
CREATE INDEX "LoyaltyPointsAccount_businessId_status_idx" ON "LoyaltyPointsAccount"("businessId", "status");

-- CreateIndex — the customer-quoted reference
CREATE UNIQUE INDEX "LoyaltyPointsLedger_reference_key" ON "LoyaltyPointsLedger"("reference");

-- CreateIndex — the replay guard: one idempotency key can only ever write one ledger row
CREATE UNIQUE INDEX "LoyaltyPointsLedger_businessId_idempotencyKey_key" ON "LoyaltyPointsLedger"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LoyaltyPointsLedger_accountId_createdAt_idx" ON "LoyaltyPointsLedger"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyPointsLedger_businessId_type_createdAt_idx" ON "LoyaltyPointsLedger"("businessId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyPointsLedger_businessId_expiresAt_idx" ON "LoyaltyPointsLedger"("businessId", "expiresAt");

-- CreateIndex
CREATE INDEX "LoyaltyPointsLedger_businessId_sourceReference_idx" ON "LoyaltyPointsLedger"("businessId", "sourceReference");

-- CreateIndex — two rewards cannot share a title in one business
CREATE UNIQUE INDEX "LoyaltyReward_businessId_title_key" ON "LoyaltyReward"("businessId", "title");

-- CreateIndex
CREATE INDEX "LoyaltyReward_programmeId_isActive_sortOrder_idx" ON "LoyaltyReward"("programmeId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyRewardRedemption_reference_key" ON "LoyaltyRewardRedemption"("reference");

-- CreateIndex — the double-tap guard: one key can only ever create one redemption
CREATE UNIQUE INDEX "LoyaltyRewardRedemption_businessId_idempotencyKey_key" ON "LoyaltyRewardRedemption"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LoyaltyRewardRedemption_businessId_status_createdAt_idx" ON "LoyaltyRewardRedemption"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyRewardRedemption_accountId_createdAt_idx" ON "LoyaltyRewardRedemption"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "LoyaltyPointsProgramme" ADD CONSTRAINT "LoyaltyPointsProgramme_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointsEligibleItem" ADD CONSTRAINT "LoyaltyPointsEligibleItem_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "LoyaltyPointsProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointsAccount" ADD CONSTRAINT "LoyaltyPointsAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointsAccount" ADD CONSTRAINT "LoyaltyPointsAccount_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "LoyaltyPointsProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointsAccount" ADD CONSTRAINT "LoyaltyPointsAccount_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointsLedger" ADD CONSTRAINT "LoyaltyPointsLedger_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointsLedger" ADD CONSTRAINT "LoyaltyPointsLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyPointsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — the reversal keeps pointing at the entry it corrects; the entry itself is never
-- rewritten, and if a corrected row were ever removed the reversal still stands on its own.
ALTER TABLE "LoyaltyPointsLedger" ADD CONSTRAINT "LoyaltyPointsLedger_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LoyaltyPointsLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "LoyaltyPointsProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRewardRedemption" ADD CONSTRAINT "LoyaltyRewardRedemption_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRewardRedemption" ADD CONSTRAINT "LoyaltyRewardRedemption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyPointsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRewardRedemption" ADD CONSTRAINT "LoyaltyRewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "LoyaltyReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;
