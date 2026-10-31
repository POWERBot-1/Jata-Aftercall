-- Phone claims are globally unique only after trusted proof of ownership.
ALTER TABLE "AgentApplication" ADD COLUMN "verifiedPhoneE164" TEXT;
ALTER TABLE "AgentApplication" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_verified_phone_check" CHECK (
  ("verifiedPhoneE164" IS NULL AND "phoneVerifiedAt" IS NULL) OR
  ("verifiedPhoneE164" IS NOT NULL AND "verifiedPhoneE164" = "phoneE164" AND "phoneVerifiedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "AgentApplication_verifiedPhoneE164_key" ON "AgentApplication"("verifiedPhoneE164");

-- One current challenge per application. Only a keyed digest is persisted, never the code.
CREATE TABLE "AgentPhoneChallenge" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "codeDigest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPhoneChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentPhoneChallenge_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  CONSTRAINT "AgentPhoneChallenge_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentPhoneChallenge_applicationId_key" ON "AgentPhoneChallenge"("applicationId");
CREATE INDEX "AgentPhoneChallenge_expiresAt_idx" ON "AgentPhoneChallenge"("expiresAt");
