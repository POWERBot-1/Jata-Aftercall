-- JATA AFTERCALL — JATA Payment Wallet + JATA Payment Orchestration (spec §1–§130)
--
-- Purely additive: new tenant-scoped tables and enum types. No existing table, column, index or
-- row is dropped, renamed, rewritten or backfilled, so the AFTERCALL journey, the commerce
-- baseline, the Interactive Business package, the Website Studio and the existing Business POS
-- all keep working exactly as before (spec §120 "do not break existing POS functionality").
--
-- Money is stored in integer MINOR units (spec §77): never a float, never an approximation.
-- The database — not the browser — enforces the financial invariants (spec §76):
--   • positive amounts                     CHECK ("amountMinor" > 0)
--   • a real ISO-4217 currency             CHECK ("currency" ~ '^[A-Z]{3}$')
--   • refunds cannot exceed what was paid  CHECK ("amountRefundedMinor" <= "amountPaidMinor")
--   • one provider event is processed once UNIQUE ("provider", "providerEventId")  (spec §33)
--   • one provider transaction is one payment UNIQUE ("provider", "providerTransactionId")
--   • one payment settles at most one sale UNIQUE ("posSaleId")
--   • at most one primary destination per business (partial unique index, spec §9)
--   • the payment audit trail cannot be rewritten (trigger on UPDATE, spec §60, §114)
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so the migration is safe on a
-- database provisioned outside the migration history and safe to re-run.

-- ── Enumerated states (spec §31, §52, §76: valid states, valid providers) ────

DO $$ BEGIN
    CREATE TYPE "PaymentProviderKey" AS ENUM ('MPESA', 'PAYSTACK', 'BANK', 'AIRTEL_MONEY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentDestinationKind" AS ENUM ('MPESA_TILL', 'MPESA_PAYBILL', 'MPESA_POCHI', 'BANK_ACCOUNT', 'PAYSTACK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentDestinationStatus" AS ENUM ('UNVERIFIED', 'FORMAT_VERIFIED', 'PROVIDER_VERIFIED', 'CONNECTED', 'ACTION_REQUIRED', 'UNAVAILABLE', 'DISCONNECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentTransactionStatus" AS ENUM ('CREATED', 'PAYMENT_REQUESTED', 'PENDING', 'PROCESSING', 'CONFIRMED', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentAttemptStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'TIMEOUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentNotificationAudience" AS ENUM ('MERCHANT', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentReconciliationResult" AS ENUM ('MATCHED', 'AMOUNT_MISMATCH', 'UNKNOWN_PAYMENT', 'DUPLICATE', 'UNCONFIRMED', 'MANUAL_MATCHED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING_PROVIDER', 'COMPLETED', 'FAILED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentActorKind" AS ENUM ('MERCHANT_STAFF', 'CUSTOMER', 'JATA_SYSTEM', 'JATA_OPERATOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentDestination (spec §9): where the business gets paid ───────────────

CREATE TABLE IF NOT EXISTS "PaymentDestination" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "PaymentDestinationKind" NOT NULL,
    "provider" "PaymentProviderKey" NOT NULL,
    "label" TEXT,
    "providerDestinationId" TEXT NOT NULL,
    "providerAccountRef" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT,
    "accountName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "PaymentDestinationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationSource" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentDestination_businessId_provider_providerDestinationId_providerAccountRef_key" ON "PaymentDestination"("businessId", "provider", "providerDestinationId", "providerAccountRef");

CREATE INDEX IF NOT EXISTS "PaymentDestination_businessId_isActive_idx" ON "PaymentDestination"("businessId", "isActive");

CREATE INDEX IF NOT EXISTS "PaymentDestination_businessId_isPrimary_idx" ON "PaymentDestination"("businessId", "isPrimary");

-- Money must go somewhere specific and be in a real currency (spec §76).
DO $$ BEGIN
    ALTER TABLE "PaymentDestination" ADD CONSTRAINT "PaymentDestination_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One primary destination per business: a partial unique index makes a second primary impossible,
-- so a routing bug cannot silently send money to two places (spec §9, §21).
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentDestination_one_primary_per_business_key" ON "PaymentDestination"("businessId") WHERE "isPrimary" = true;

DO $$ BEGIN
    ALTER TABLE "PaymentDestination" ADD CONSTRAINT "PaymentDestination_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentProviderConnection (spec §12): JATA's connection to the provider ──

CREATE TABLE IF NOT EXISTS "PaymentProviderConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" "PaymentProviderKey" NOT NULL,
    "status" "PaymentDestinationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "providerConnectionId" TEXT,
    "displayName" TEXT,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "healthy" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentProviderConnection_businessId_provider_key" ON "PaymentProviderConnection"("businessId", "provider");

CREATE INDEX IF NOT EXISTS "PaymentProviderConnection_businessId_status_idx" ON "PaymentProviderConnection"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "PaymentProviderConnection" ADD CONSTRAINT "PaymentProviderConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentTransaction (spec §31, §32, §101): the payment and its whole timeline ──

CREATE TABLE IF NOT EXISTS "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "jataPaymentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "destinationId" TEXT,
    "provider" "PaymentProviderKey" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "providerReference" TEXT,
    "providerTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "method" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
    "amountRefundedMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "customerName" TEXT,
    "customerPhoneMasked" TEXT,
    "posCustomerId" TEXT,
    "posSaleId" TEXT,
    "orderId" TEXT,
    "paymentContext" JSONB,
    "receiptNumber" TEXT,
    "receiptToken" TEXT,
    "receiptGeneratedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3),
    "providerAcceptedAt" TIMESTAMP(3),
    "providerConfirmedAt" TIMESTAMP(3),
    "jataVerifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "merchantNotifiedAt" TIMESTAMP(3),
    "customerNotifiedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_jataPaymentId_key" ON "PaymentTransaction"("jataPaymentId");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_idempotencyKey_key" ON "PaymentTransaction"("idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_receiptToken_key" ON "PaymentTransaction"("receiptToken");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_provider_providerReference_key" ON "PaymentTransaction"("provider", "providerReference");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_provider_providerTransactionId_key" ON "PaymentTransaction"("provider", "providerTransactionId");

-- One payment settles at most one sale (spec §33, §98). NULLs are distinct in PostgreSQL, so
-- payments that are still pending carry no constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_posSaleId_key" ON "PaymentTransaction"("posSaleId");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_businessId_createdAt_idx" ON "PaymentTransaction"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_businessId_status_idx" ON "PaymentTransaction"("businessId", "status");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_status_expiresAt_idx" ON "PaymentTransaction"("status", "expiresAt");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_businessId_posSaleId_idx" ON "PaymentTransaction"("businessId", "posSaleId");

-- Financial sanity at the database level (spec §76). A zero or negative payment, a currency that
-- is not ISO-4217, or a refund larger than what was paid, is refused by PostgreSQL itself.
DO $$ BEGIN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_amountMinor_check" CHECK ("amountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_amounts_check" CHECK ("amountPaidMinor" >= 0 AND "amountRefundedMinor" >= 0 AND "amountRefundedMinor" <= "amountPaidMinor");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "PaymentDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "PosSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentAttempt (spec §101): every call JATA made to a provider ──────────

CREATE TABLE IF NOT EXISTS "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "provider" "PaymentProviderKey" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestReference" TEXT,
    "providerReference" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAttempt_transactionId_attemptNumber_key" ON "PaymentAttempt"("transactionId", "attemptNumber");

CREATE INDEX IF NOT EXISTS "PaymentAttempt_businessId_createdAt_idx" ON "PaymentAttempt"("businessId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentEvent (spec §24, §34, §35): the central provider event log ───────

CREATE TABLE IF NOT EXISTS "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProviderKey" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "businessId" TEXT,
    "transactionId" TEXT,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB,
    "providerReference" TEXT,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- The replay guard (spec §33): a provider may send the same event twice; the second insert fails.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");

CREATE INDEX IF NOT EXISTS "PaymentEvent_provider_status_receivedAt_idx" ON "PaymentEvent"("provider", "status", "receivedAt");

CREATE INDEX IF NOT EXISTS "PaymentEvent_businessId_receivedAt_idx" ON "PaymentEvent"("businessId", "receivedAt");

DO $$ BEGIN
    ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentNotification (spec §26, §27, §100) ──────────────────────────────

CREATE TABLE IF NOT EXISTS "PaymentNotification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transactionId" TEXT,
    "audience" "PaymentNotificationAudience" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'POS',
    "recipientMasked" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "PaymentNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentNotification_idempotencyKey_key" ON "PaymentNotification"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "PaymentNotification_businessId_createdAt_idx" ON "PaymentNotification"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentNotification_status_scheduledAt_idx" ON "PaymentNotification"("status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "PaymentNotification_transactionId_idx" ON "PaymentNotification"("transactionId");

DO $$ BEGIN
    ALTER TABLE "PaymentNotification" ADD CONSTRAINT "PaymentNotification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentNotification" ADD CONSTRAINT "PaymentNotification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentReconciliation (spec §29, §42, §43) ─────────────────────────────

CREATE TABLE IF NOT EXISTS "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transactionId" TEXT,
    "provider" "PaymentProviderKey" NOT NULL,
    "providerReference" TEXT,
    "result" "PaymentReconciliationResult" NOT NULL,
    "expectedAmountMinor" INTEGER,
    "receivedAmountMinor" INTEGER,
    "differenceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "notes" TEXT,
    "matchedByActorId" TEXT,
    "matchedByActorName" TEXT,
    "matchedReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentReconciliation_businessId_result_createdAt_idx" ON "PaymentReconciliation"("businessId", "result", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentReconciliation_businessId_createdAt_idx" ON "PaymentReconciliation"("businessId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Refund (spec §47, §114): an adjustment row, never an overwrite ─────────

CREATE TABLE IF NOT EXISTS "Refund" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "provider" "PaymentProviderKey" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "initiatedById" TEXT,
    "initiatedByName" TEXT,
    "providerReference" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Refund_businessId_createdAt_idx" ON "Refund"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "Refund_transactionId_idx" ON "Refund"("transactionId");

DO $$ BEGIN
    ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amountMinor_check" CHECK ("amountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Refund" ADD CONSTRAINT "Refund_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Refund" ADD CONSTRAINT "Refund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentAuditEvent (spec §60, §98, §114): immutable payment audit trail ──

CREATE TABLE IF NOT EXISTS "PaymentAuditEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transactionId" TEXT,
    "destinationId" TEXT,
    "actorKind" "PaymentActorKind" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentAuditEvent_businessId_createdAt_idx" ON "PaymentAuditEvent"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentAuditEvent_businessId_action_idx" ON "PaymentAuditEvent"("businessId", "action");

CREATE INDEX IF NOT EXISTS "PaymentAuditEvent_transactionId_createdAt_idx" ON "PaymentAuditEvent"("transactionId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "PaymentAuditEvent" ADD CONSTRAINT "PaymentAuditEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentAuditEvent" ADD CONSTRAINT "PaymentAuditEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentAuditEvent" ADD CONSTRAINT "PaymentAuditEvent_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "PaymentDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Financial history must not be rewritable through any interface, including a bug in an API
-- route or a merchant screen (spec §60, §114). Deletes are still permitted so that deleting a
-- tenant (or a test fixture) remains possible; updates are not.
CREATE OR REPLACE FUNCTION "jata_payment_audit_immutable"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PaymentAuditEvent rows are immutable (JATA payment audit trail, spec §114)';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER "PaymentAuditEvent_immutable"
        BEFORE UPDATE ON "PaymentAuditEvent"
        FOR EACH ROW EXECUTE FUNCTION "jata_payment_audit_immutable"();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
