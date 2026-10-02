-- Commerce baseline (2026-10-02)
--
-- The checked-in migrations stopped at Phase 1: no migration ever created the commerce,
-- notification or AI tables the schema declares (Product, Order, Cart, PreOrder,
-- Notification, KnowledgeDocument, AIConfiguration and friends), so a fresh database
-- provisioned with `prisma migrate deploy` could not run the business platform — including
-- the Interactive Business package, whose own migration alters "Product".
--
-- This migration creates exactly what was missing, in front of
-- 20261002000000_interactive_business, and adds the new columns on the tables the init
-- migration did create.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so it is safe to apply to a
-- database that was provisioned outside the migration history. Databases that already carry
-- this schema should be baselined instead of re-applied:
--   npx prisma migrate resolve --applied 20260930000000_commerce_baseline
-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'PRE_ORDER', 'DISCONTINUED', 'AVAILABLE_ON_REQUEST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_CUSTOMER_CONFIRMATION', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_VERIFIED', 'CONFIRMED', 'PROCESSING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "PreOrderStatus" AS ENUM ('PENDING', 'DEPOSIT_PAID', 'FULL_PAYMENT_PAID', 'READY_TO_FULFILL', 'COMPLETED', 'CANCELLED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'QUEUED', 'DELIVERED', 'FAILED', 'RETRY_QUEUED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN IF NOT EXISTS "sessionHash" TEXT,
ADD COLUMN IF NOT EXISTS "subjectId" TEXT;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "badge" TEXT,
ADD COLUMN IF NOT EXISTS "ctaLabel" TEXT,
ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "bookingId" TEXT,
ADD COLUMN IF NOT EXISTS "customerEmail" TEXT,
ADD COLUMN IF NOT EXISTS "orderId" TEXT,
ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'SUBSCRIPTION';

-- AlterTable
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "availability" TEXT,
ADD COLUMN IF NOT EXISTS "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "category" TEXT,
ADD COLUMN IF NOT EXISTS "depositKES" INTEGER,
ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "priceToKES" INTEGER,
ADD COLUMN IF NOT EXISTS "pricingType" TEXT NOT NULL DEFAULT 'FIXED',
ADD COLUMN IF NOT EXISTS "staffName" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AIConfiguration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "language" TEXT NOT NULL DEFAULT 'en',
    "salesBehavior" TEXT NOT NULL DEFAULT 'informational',
    "orderingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "preordersAllowed" BOOLEAN NOT NULL DEFAULT false,
    "humanEscalation" TEXT NOT NULL DEFAULT 'uncertain',
    "welcomeMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "category" TEXT,
    "basePriceKES" INTEGER,
    "variantPriceKES" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "quantity" INTEGER,
    "minOrder" INTEGER NOT NULL DEFAULT 1,
    "maxOrder" INTEGER,
    "preOrderAllowed" BOOLEAN NOT NULL DEFAULT false,
    "deliveryEligible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "salePriceKES" INTEGER,
    "imageUrl" TEXT,
    "images" TEXT,
    "brand" TEXT,
    "portionSize" TEXT,
    "ingredients" TEXT,
    "prepMinutes" INTEGER,
    "tags" TEXT,
    "addOns" TEXT,
    "variantOptions" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FAQ" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "approvedAnswer" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AIPackageEntitlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL DEFAULT 'AI_BUSINESS_FRONT_DESK',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPackageEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Cart" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT,
    "serviceId" TEXT,
    "variantDesc" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceKES" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "orderReference" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "deliveryLocation" TEXT,
    "deliveryInstructions" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalKES" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeKES" INTEGER NOT NULL DEFAULT 0,
    "discountKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "preOrder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "fulfilmentType" TEXT,
    "notes" TEXT,
    "source" TEXT DEFAULT 'STOREFRONT',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "variantDesc" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceKES" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "variantId" TEXT,
    "addOns" TEXT,
    "imageUrl" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PreOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantDesc" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "depositRequiredKES" INTEGER,
    "fullPriceKES" INTEGER,
    "status" "PreOrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MerchantPaymentConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "publicInfo" TEXT NOT NULL,
    "encryptedCredentials" TEXT,
    "credentialRotationNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "recipientNumber" TEXT,
    "recipientEmail" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryAttempted" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFailed" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NotificationRecipient" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UnansweredQuestion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "askedCount" INTEGER NOT NULL DEFAULT 1,
    "firstAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAskedAt" TIMESTAMP(3) NOT NULL,
    "approvedAnswer" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnansweredQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DemandInsight" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstRecorded" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRecorded" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AIQualityEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceUsed" TEXT NOT NULL,
    "confidence" TEXT,
    "escalatedToHuman" BOOLEAN NOT NULL DEFAULT false,
    "customerCorrectedAI" BOOLEAN NOT NULL DEFAULT false,
    "missingBusinessInfo" BOOLEAN NOT NULL DEFAULT false,
    "eventType" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,

    CONSTRAINT "AIQualityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_OrderToPreOrder" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AIConfiguration_businessId_key" ON "AIConfiguration"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_businessId_idx" ON "Product"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_businessId_category_idx" ON "Product"("businessId", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_businessId_idx" ON "KnowledgeDocument"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FAQ_businessId_idx" ON "FAQ"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AIPackageEntitlement_businessId_key" ON "AIPackageEntitlement"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AIPackageEntitlement_businessId_idx" ON "AIPackageEntitlement"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Cart_businessId_idx" ON "Cart"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Cart_customerId_idx" ON "Cart"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderReference_key" ON "Order"("orderReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_businessId_idx" ON "Order"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_businessId_createdAt_idx" ON "Order"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PreOrder_businessId_idx" ON "PreOrder"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PreOrder_status_idx" ON "PreOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MerchantPaymentConfig_businessId_key" ON "MerchantPaymentConfig"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MerchantPaymentConfig_businessId_idx" ON "MerchantPaymentConfig"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_businessId_idx" ON "Notification"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_businessId_eventType_idx" ON "Notification"("businessId", "eventType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationRecipient_businessId_idx" ON "NotificationRecipient"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRecipient_businessId_label_key" ON "NotificationRecipient"("businessId", "label");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UnansweredQuestion_businessId_idx" ON "UnansweredQuestion"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UnansweredQuestion_isResolved_idx" ON "UnansweredQuestion"("isResolved");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UnansweredQuestion_question_idx" ON "UnansweredQuestion"("question");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandInsight_businessId_idx" ON "DemandInsight"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandInsight_insightType_idx" ON "DemandInsight"("insightType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AIQualityEvent_businessId_idx" ON "AIQualityEvent"("businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AIQualityEvent_eventType_idx" ON "AIQualityEvent"("eventType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AIQualityEvent_sourceUsed_idx" ON "AIQualityEvent"("sourceUsed");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "_OrderToPreOrder_AB_unique" ON "_OrderToPreOrder"("A", "B");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_OrderToPreOrder_B_index" ON "_OrderToPreOrder"("B");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_businessId_eventType_createdAt_idx" ON "AnalyticsEvent"("businessId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payment_orderId_idx" ON "Payment"("orderId");

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "AIConfiguration" ADD CONSTRAINT "AIConfiguration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "AIPackageEntitlement" ADD CONSTRAINT "AIPackageEntitlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "Cart" ADD CONSTRAINT "Cart_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "PreOrder" ADD CONSTRAINT "PreOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "MerchantPaymentConfig" ADD CONSTRAINT "MerchantPaymentConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "UnansweredQuestion" ADD CONSTRAINT "UnansweredQuestion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "DemandInsight" ADD CONSTRAINT "DemandInsight_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "AIQualityEvent" ADD CONSTRAINT "AIQualityEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "_OrderToPreOrder" ADD CONSTRAINT "_OrderToPreOrder_A_fkey" FOREIGN KEY ("A") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- AddForeignKey
    ALTER TABLE "_OrderToPreOrder" ADD CONSTRAINT "_OrderToPreOrder_B_fkey" FOREIGN KEY ("B") REFERENCES "PreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
