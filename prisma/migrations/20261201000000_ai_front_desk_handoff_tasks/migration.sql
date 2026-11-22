-- AI Front Desk human handoff follow-ups remain internal operational tasks.
ALTER TABLE "AIConfiguration"
  ADD COLUMN "followupEventsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ErpTask"
  ADD COLUMN "aiHandoffActiveKey" TEXT;

CREATE UNIQUE INDEX "ErpTask_businessId_aiHandoffActiveKey_key"
  ON "ErpTask"("businessId", "aiHandoffActiveKey");
