-- Financial evidence contract. Additive only; legacy payments stay UNKNOWN and recurring
-- subscription snapshots stay NULL until a verified settlement writes an authoritative snapshot.
CREATE TYPE "PaymentEnvironment" AS ENUM ('UNKNOWN', 'TEST', 'LIVE');

ALTER TABLE "Payment"
  ADD COLUMN "environment" "PaymentEnvironment" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "providerSettledAt" TIMESTAMP(3),
  ADD COLUMN "providerSettlementReference" TEXT,
  ADD COLUMN "providerFeeMinor" BIGINT,
  ADD COLUMN "providerTaxMinor" BIGINT,
  ADD COLUMN "settledRefundMinor" BIGINT,
  ADD COLUMN "settledChargebackMinor" BIGINT,
  ADD COLUMN "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNRECONCILED',
  ADD COLUMN "reconciledAt" TIMESTAMP(3);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_provider_amounts_nonnegative_check"
    CHECK (
      ("providerFeeMinor" IS NULL OR "providerFeeMinor" >= 0) AND
      ("providerTaxMinor" IS NULL OR "providerTaxMinor" >= 0) AND
      ("settledRefundMinor" IS NULL OR "settledRefundMinor" >= 0) AND
      ("settledChargebackMinor" IS NULL OR "settledChargebackMinor" >= 0)
    ),
  ADD CONSTRAINT "Payment_reconciliation_status_check"
    CHECK ("reconciliationStatus" IN ('UNRECONCILED', 'MATCHED', 'EXCEPTION', 'NOT_APPLICABLE')),
  ADD CONSTRAINT "Payment_settlement_reference_nonempty_check"
    CHECK ("providerSettlementReference" IS NULL OR length("providerSettlementReference") BETWEEN 1 AND 255);

CREATE INDEX "Payment_environment_status_providerSettledAt_idx"
  ON "Payment"("environment", "status", "providerSettledAt");

ALTER TABLE "Subscription"
  ADD COLUMN "recurringAmountKES" INTEGER,
  ADD COLUMN "recurringDiscountKES" INTEGER,
  ADD COLUMN "recurringCurrency" TEXT,
  ADD COLUMN "recurringIntervalDays" INTEGER,
  ADD COLUMN "recurringPriceEffectiveAt" TIMESTAMP(3);

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_recurring_value_nonnegative_check"
    CHECK (
      ("recurringAmountKES" IS NULL OR "recurringAmountKES" >= 0) AND
      ("recurringDiscountKES" IS NULL OR "recurringDiscountKES" >= 0) AND
      ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" > 0) AND
      ("recurringAmountKES" IS NULL OR "recurringDiscountKES" IS NULL OR "recurringDiscountKES" <= "recurringAmountKES") AND
      ("recurringCurrency" IS NULL OR "recurringCurrency" ~ '^[A-Z]{3}$')
    );

CREATE INDEX "Subscription_status_expiresAt_idx" ON "Subscription"("status", "expiresAt");

-- Dedicated product subscription snapshots. Legacy rows intentionally remain NULL.
-- Do not count these products in MRR until verified settlement writes all snapshot fields.
-- Explicit per-table DDL keeps the schema contract statically auditable in CI.
-- Nullable legacy values remain NULL until a verified settlement writes evidence.
ALTER TABLE "PosSubscription"
  ADD COLUMN "recurringAmountKES" INTEGER,
  ADD COLUMN "recurringDiscountKES" INTEGER,
  ADD COLUMN "recurringCurrency" TEXT,
  ADD COLUMN "recurringIntervalDays" INTEGER,
  ADD COLUMN "recurringPriceEffectiveAt" TIMESTAMP(3);

ALTER TABLE "PosSubscription"
  ADD CONSTRAINT "PosSubscription_recurring_value_nonnegative_check"
    CHECK (
      ("recurringAmountKES" IS NULL OR "recurringAmountKES" >= 0) AND
      ("recurringDiscountKES" IS NULL OR "recurringDiscountKES" >= 0) AND
      ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" > 0) AND
      ("recurringAmountKES" IS NULL OR "recurringDiscountKES" IS NULL OR "recurringDiscountKES" <= "recurringAmountKES") AND
      ("recurringCurrency" IS NULL OR "recurringCurrency" ~ '^[A-Z]{3}$')
    );

-- Nullable legacy values remain NULL until a verified settlement writes evidence.
ALTER TABLE "AutopilotSubscription"
  ADD COLUMN "recurringAmountKES" INTEGER,
  ADD COLUMN "recurringDiscountKES" INTEGER,
  ADD COLUMN "recurringCurrency" TEXT,
  ADD COLUMN "recurringIntervalDays" INTEGER,
  ADD COLUMN "recurringPriceEffectiveAt" TIMESTAMP(3);

ALTER TABLE "AutopilotSubscription"
  ADD CONSTRAINT "AutopilotSubscription_recurring_value_nonnegative_check"
    CHECK (
      ("recurringAmountKES" IS NULL OR "recurringAmountKES" >= 0) AND
      ("recurringDiscountKES" IS NULL OR "recurringDiscountKES" >= 0) AND
      ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" > 0) AND
      ("recurringAmountKES" IS NULL OR "recurringDiscountKES" IS NULL OR "recurringDiscountKES" <= "recurringAmountKES") AND
      ("recurringCurrency" IS NULL OR "recurringCurrency" ~ '^[A-Z]{3}$')
    );

-- Nullable legacy values remain NULL until a verified settlement writes evidence.
ALTER TABLE "ErpSubscription"
  ADD COLUMN "recurringAmountKES" INTEGER,
  ADD COLUMN "recurringDiscountKES" INTEGER,
  ADD COLUMN "recurringCurrency" TEXT,
  ADD COLUMN "recurringIntervalDays" INTEGER,
  ADD COLUMN "recurringPriceEffectiveAt" TIMESTAMP(3);

ALTER TABLE "ErpSubscription"
  ADD CONSTRAINT "ErpSubscription_recurring_value_nonnegative_check"
    CHECK (
      ("recurringAmountKES" IS NULL OR "recurringAmountKES" >= 0) AND
      ("recurringDiscountKES" IS NULL OR "recurringDiscountKES" >= 0) AND
      ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" > 0) AND
      ("recurringAmountKES" IS NULL OR "recurringDiscountKES" IS NULL OR "recurringDiscountKES" <= "recurringAmountKES") AND
      ("recurringCurrency" IS NULL OR "recurringCurrency" ~ '^[A-Z]{3}$')
    );

-- Nullable legacy values remain NULL until a verified settlement writes evidence.
ALTER TABLE "MjengoSubscription"
  ADD COLUMN "recurringAmountKES" INTEGER,
  ADD COLUMN "recurringDiscountKES" INTEGER,
  ADD COLUMN "recurringCurrency" TEXT,
  ADD COLUMN "recurringIntervalDays" INTEGER,
  ADD COLUMN "recurringPriceEffectiveAt" TIMESTAMP(3);

ALTER TABLE "MjengoSubscription"
  ADD CONSTRAINT "MjengoSubscription_recurring_value_nonnegative_check"
    CHECK (
      ("recurringAmountKES" IS NULL OR "recurringAmountKES" >= 0) AND
      ("recurringDiscountKES" IS NULL OR "recurringDiscountKES" >= 0) AND
      ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" > 0) AND
      ("recurringAmountKES" IS NULL OR "recurringDiscountKES" IS NULL OR "recurringDiscountKES" <= "recurringAmountKES") AND
      ("recurringCurrency" IS NULL OR "recurringCurrency" ~ '^[A-Z]{3}$')
    );

-- Nullable legacy values remain NULL until a verified settlement writes evidence.
ALTER TABLE "ErpProSubscription"
  ADD COLUMN "recurringAmountKES" INTEGER,
  ADD COLUMN "recurringDiscountKES" INTEGER,
  ADD COLUMN "recurringCurrency" TEXT,
  ADD COLUMN "recurringIntervalDays" INTEGER,
  ADD COLUMN "recurringPriceEffectiveAt" TIMESTAMP(3);

ALTER TABLE "ErpProSubscription"
  ADD CONSTRAINT "ErpProSubscription_recurring_value_nonnegative_check"
    CHECK (
      ("recurringAmountKES" IS NULL OR "recurringAmountKES" >= 0) AND
      ("recurringDiscountKES" IS NULL OR "recurringDiscountKES" >= 0) AND
      ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" > 0) AND
      ("recurringAmountKES" IS NULL OR "recurringDiscountKES" IS NULL OR "recurringDiscountKES" <= "recurringAmountKES") AND
      ("recurringCurrency" IS NULL OR "recurringCurrency" ~ '^[A-Z]{3}$')
    );
