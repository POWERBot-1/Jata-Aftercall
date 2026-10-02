-- JATA Interactive Business — category-aware business experience platform.
-- Additive only: no table, column or enum is dropped or destructively altered, and every
-- new column is nullable or carries a DEFAULT so existing rows need no backfill.
-- Safe to run against production.

-- ── Extend existing tenant data (§38: extend, never duplicate) ──

-- AlterTable: Offer presentation inside experience sections
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "ctaLabel" TEXT,
ADD COLUMN IF NOT EXISTS "badge" TEXT;

-- AlterTable: Product gains the category-shaped catalogue fields (§17)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "salePriceKES" INTEGER,
ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "images" TEXT,
ADD COLUMN IF NOT EXISTS "brand" TEXT,
ADD COLUMN IF NOT EXISTS "portionSize" TEXT,
ADD COLUMN IF NOT EXISTS "ingredients" TEXT,
ADD COLUMN IF NOT EXISTS "prepMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "tags" TEXT,
ADD COLUMN IF NOT EXISTS "addOns" TEXT,
ADD COLUMN IF NOT EXISTS "variantOptions" TEXT,
ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Service gains booking-shaped fields (§9, §18)
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "category" TEXT,
ADD COLUMN IF NOT EXISTS "pricingType" TEXT NOT NULL DEFAULT 'FIXED',
ADD COLUMN IF NOT EXISTS "priceToKES" INTEGER,
ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "depositKES" INTEGER,
ADD COLUMN IF NOT EXISTS "staffName" TEXT,
ADD COLUMN IF NOT EXISTS "availability" TEXT,
ADD COLUMN IF NOT EXISTS "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: Order checkout shape (§25, §27)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fulfilmentType" TEXT,
ADD COLUMN IF NOT EXISTS "notes" TEXT,
ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'STOREFRONT',
ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID';

-- AlterTable: OrderItem captures the exact customer configuration
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "variantId" TEXT,
ADD COLUMN IF NOT EXISTS "addOns" TEXT,
ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- AlterTable: Payment serves subscriptions, orders and deposits through one stack (§25)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'SUBSCRIPTION',
ADD COLUMN IF NOT EXISTS "orderId" TEXT,
ADD COLUMN IF NOT EXISTS "bookingId" TEXT,
ADD COLUMN IF NOT EXISTS "customerEmail" TEXT;

-- AlterTable: Analytics carries the subject and a privacy-safe session key (§32, §57)
ALTER TABLE "AnalyticsEvent" ADD COLUMN IF NOT EXISTS "subjectId" TEXT,
ADD COLUMN IF NOT EXISTS "sessionHash" TEXT;

-- ── New tables ──

-- CreateTable: the versioned website document (§14–§16)
CREATE TABLE IF NOT EXISTS "BusinessExperience" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL DEFAULT 'other',
    "themeKey" TEXT NOT NULL DEFAULT 'core-minimal',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "draftJson" TEXT NOT NULL,
    "publishedJson" TEXT,
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable: publication snapshots for rollback and audit (§15, §46)
CREATE TABLE IF NOT EXISTS "ExperienceVersion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "themeKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "note" TEXT,

    CONSTRAINT "ExperienceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: package entitlement (§59)
CREATE TABLE IF NOT EXISTS "InteractiveBusinessEntitlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL DEFAULT 'INTERACTIVE_BUSINESS',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractiveBusinessEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable: service bookings (§9, §29)
CREATE TABLE IF NOT EXISTS "Booking" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT,
    "serviceName" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "staffName" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "depositKES" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable: product variants (§8, §10, §17)
CREATE TABLE IF NOT EXISTS "ProductVariant" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "options" TEXT,
    "priceKES" INTEGER,
    "sku" TEXT,
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable: tenant media library (§19)
CREATE TABLE IF NOT EXISTS "MediaAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'IMAGE',
    "alt" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    -- ── Constraints ──
    
    ALTER TABLE "BusinessExperience" ADD CONSTRAINT "BusinessExperience_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ExperienceVersion" ADD CONSTRAINT "ExperienceVersion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "InteractiveBusinessEntitlement" ADD CONSTRAINT "InteractiveBusinessEntitlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Unique constraints ──

ALTER TABLE "BusinessExperience" ADD CONSTRAINT "BusinessExperience_businessId_key" UNIQUE ("businessId");

ALTER TABLE "InteractiveBusinessEntitlement" ADD CONSTRAINT "InteractiveBusinessEntitlement_businessId_key" UNIQUE ("businessId");

ALTER TABLE "ExperienceVersion" ADD CONSTRAINT "ExperienceVersion_businessId_version_key" UNIQUE ("businessId","version");

-- ── Indexes ──

CREATE INDEX IF NOT EXISTS "BusinessExperience_businessId_idx" ON "BusinessExperience"("businessId");

CREATE INDEX IF NOT EXISTS "BusinessExperience_businessId_status_idx" ON "BusinessExperience"("businessId", "status");

CREATE INDEX IF NOT EXISTS "ExperienceVersion_businessId_publishedAt_idx" ON "ExperienceVersion"("businessId", "publishedAt");

CREATE INDEX IF NOT EXISTS "InteractiveBusinessEntitlement_businessId_idx" ON "InteractiveBusinessEntitlement"("businessId");

CREATE INDEX IF NOT EXISTS "InteractiveBusinessEntitlement_status_idx" ON "InteractiveBusinessEntitlement"("status");

CREATE INDEX IF NOT EXISTS "Booking_businessId_idx" ON "Booking"("businessId");

CREATE INDEX IF NOT EXISTS "Booking_businessId_startAt_idx" ON "Booking"("businessId", "startAt");

CREATE INDEX IF NOT EXISTS "Booking_businessId_status_idx" ON "Booking"("businessId", "status");

CREATE INDEX IF NOT EXISTS "ProductVariant_businessId_idx" ON "ProductVariant"("businessId");

CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId");

CREATE INDEX IF NOT EXISTS "MediaAsset_businessId_idx" ON "MediaAsset"("businessId");

CREATE INDEX IF NOT EXISTS "MediaAsset_businessId_hash_idx" ON "MediaAsset"("businessId", "hash");

CREATE INDEX IF NOT EXISTS "MediaAsset_businessId_createdAt_idx" ON "MediaAsset"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "Payment_orderId_idx" ON "Payment"("orderId");

CREATE INDEX IF NOT EXISTS "Order_businessId_createdAt_idx" ON "Order"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_businessId_eventType_createdAt_idx" ON "AnalyticsEvent"("businessId", "eventType", "createdAt");
