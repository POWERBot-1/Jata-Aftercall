-- Durable, additive product lifecycle execution evidence. No existing customer rows are touched.
CREATE TABLE "ProductLifecycleExecutionRun" (
  "id" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'OBSERVE',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "cursor" JSONB,
  "summary" JSONB,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductLifecycleExecutionRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductLifecycleExecutionRun_status_check"
    CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED', 'ABANDONED')),
  CONSTRAINT "ProductLifecycleExecutionRun_mode_check"
    CHECK ("mode" IN ('OBSERVE', 'PLAN'))
);
CREATE UNIQUE INDEX "ProductLifecycleExecutionRun_runKey_key"
  ON "ProductLifecycleExecutionRun"("runKey");
CREATE INDEX "ProductLifecycleExecutionRun_status_leaseUntil_idx"
  ON "ProductLifecycleExecutionRun"("status", "leaseUntil");
CREATE INDEX "ProductLifecycleExecutionRun_startedAt_idx"
  ON "ProductLifecycleExecutionRun"("startedAt");

CREATE TABLE "ProductLifecycleExecutionTask" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "transitionKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'READY',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductLifecycleExecutionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductLifecycleExecutionTask_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ProductLifecycleExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductLifecycleExecutionTask_state_check"
    CHECK ("state" IN ('READY', 'CLAIMED', 'RETRY', 'COMPLETED', 'DEAD_LETTER', 'MANUAL_REVIEW')),
  CONSTRAINT "ProductLifecycleExecutionTask_attempts_check"
    CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "ProductLifecycleExecutionTask_idempotencyKey_key"
  ON "ProductLifecycleExecutionTask"("idempotencyKey");
CREATE INDEX "ProductLifecycleExecutionTask_state_availableAt_createdAt_idx"
  ON "ProductLifecycleExecutionTask"("state", "availableAt", "createdAt");
CREATE INDEX "ProductLifecycleExecutionTask_state_leaseUntil_idx"
  ON "ProductLifecycleExecutionTask"("state", "leaseUntil");
CREATE INDEX "ProductLifecycleExecutionTask_product_businessId_subscriptionId_idx"
  ON "ProductLifecycleExecutionTask"("product", "businessId", "subscriptionId");

CREATE TABLE "ProductLifecycleExecutionEvent" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromState" TEXT,
  "toState" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductLifecycleExecutionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductLifecycleExecutionEvent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "ProductLifecycleExecutionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductLifecycleExecutionEvent_taskId_createdAt_idx"
  ON "ProductLifecycleExecutionEvent"("taskId", "createdAt");
CREATE INDEX "ProductLifecycleExecutionEvent_eventType_createdAt_idx"
  ON "ProductLifecycleExecutionEvent"("eventType", "createdAt");

-- Lifecycle event history is append-only at the database boundary.
CREATE OR REPLACE FUNCTION "reject_product_lifecycle_event_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Product lifecycle execution events are append-only';
END;
$$;
CREATE TRIGGER "ProductLifecycleExecutionEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ProductLifecycleExecutionEvent"
  FOR EACH ROW EXECUTE FUNCTION "reject_product_lifecycle_event_mutation"();
