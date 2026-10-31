-- Acknowledgement only. Does not assert delivery or authorize any resend.
CREATE TABLE "AgentAdminNotificationReview" (
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "reviewedState" TEXT NOT NULL,
  "reviewedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationReview_pkey" PRIMARY KEY ("applicationId", "recipientKey"),
  CONSTRAINT "AgentAdminNotificationReview_claim_fkey" FOREIGN KEY ("applicationId", "recipientKey") REFERENCES "AgentAdminNotificationClaimState"("applicationId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationReview_user_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationReview_state_check" CHECK ("reviewedState" IN ('UNKNOWN', 'DEAD'))
);
