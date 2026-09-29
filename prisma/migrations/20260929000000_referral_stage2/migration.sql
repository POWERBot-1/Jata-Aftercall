-- Stage 2 — self-service referral attribution.
-- Additive only: nothing is dropped, altered destructively, or backfilled.
-- Safe to run against production: no locks on existing rows beyond an instant
-- "ADD COLUMN ... DEFAULT NULL", and the new indexes are created on new data only
-- (referralCode is NULL for every existing Business row).

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "referralCode" TEXT;

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'CONVERTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "referrerBusinessId" TEXT,
    "referredUserId" TEXT,
    "referredBusinessId" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_referralCode_key" ON "Business"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_tokenHash_key" ON "Referral"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredUserId_key" ON "Referral"("referredUserId");

-- CreateIndex
CREATE INDEX "Referral_code_status_idx" ON "Referral"("code", "status");

-- CreateIndex
CREATE INDEX "Referral_referrerUserId_status_idx" ON "Referral"("referrerUserId", "status");

-- CreateIndex
CREATE INDEX "Referral_status_createdAt_idx" ON "Referral"("status", "createdAt");
