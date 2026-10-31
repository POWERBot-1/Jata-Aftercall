-- Evidence only: no payment or commission entitlement is created.
CREATE TABLE "AgentReferralLink" (
  "id" TEXT PRIMARY KEY,
  "referrerApplicationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReferralLink_referrerApplicationId_fkey" FOREIGN KEY ("referrerApplicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentReferralLink_tokenHash_key" ON "AgentReferralLink"("tokenHash");
CREATE UNIQUE INDEX "AgentReferralLink_id_referrerApplicationId_key" ON "AgentReferralLink"("id", "referrerApplicationId");
CREATE INDEX "AgentReferralLink_referrerApplicationId_idx" ON "AgentReferralLink"("referrerApplicationId");
CREATE TABLE "AgentReferralAttribution" (
  "id" TEXT PRIMARY KEY,
  "referrerApplicationId" TEXT NOT NULL,
  "referredApplicationId" TEXT NOT NULL,
  "linkId" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReferralAttribution_no_self" CHECK ("referrerApplicationId" <> "referredApplicationId"),
  CONSTRAINT "AgentReferralAttribution_referrerApplicationId_fkey" FOREIGN KEY ("referrerApplicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentReferralAttribution_referredApplicationId_fkey" FOREIGN KEY ("referredApplicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentReferralAttribution_linkId_referrerApplicationId_fkey" FOREIGN KEY ("linkId", "referrerApplicationId") REFERENCES "AgentReferralLink"("id", "referrerApplicationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentReferralAttribution_referredApplicationId_key" ON "AgentReferralAttribution"("referredApplicationId");
CREATE INDEX "AgentReferralAttribution_referrerApplicationId_idx" ON "AgentReferralAttribution"("referrerApplicationId");
