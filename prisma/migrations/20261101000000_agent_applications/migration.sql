-- Applications are deliberately not agent entitlements. No unverified phone gets a unique
-- constraint: otherwise someone could reserve a phone belonging to another person.
CREATE TABLE "AgentApplication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "privacyAcknowledgedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentApplication_userId_key" ON "AgentApplication"("userId");
CREATE INDEX "AgentApplication_createdAt_idx" ON "AgentApplication"("createdAt");
