-- Only HMAC fingerprints, never raw addresses, are stored. See agent-registration.ts for expiry.
CREATE TABLE "AgentRegistrationThrottle" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRegistrationThrottle_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AgentRegistrationThrottle_expiresAt_idx" ON "AgentRegistrationThrottle"("expiresAt");
