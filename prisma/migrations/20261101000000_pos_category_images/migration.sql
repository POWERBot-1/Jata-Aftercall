-- Additive metadata only. Existing free-text product categories are unchanged.
CREATE TABLE "PosCategoryImage" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosCategoryImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosCategoryImage_businessId_category_key" ON "PosCategoryImage"("businessId", "category");
CREATE INDEX "PosCategoryImage_businessId_idx" ON "PosCategoryImage"("businessId");
ALTER TABLE "PosCategoryImage" ADD CONSTRAINT "PosCategoryImage_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
