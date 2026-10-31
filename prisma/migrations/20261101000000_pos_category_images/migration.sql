-- Additive metadata only. Existing free-text product categories are unchanged.
CREATE TABLE IF NOT EXISTS "PosCategoryImage" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosCategoryImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosCategoryImage_businessId_category_key" ON "PosCategoryImage"("businessId", "category");
CREATE INDEX IF NOT EXISTS "PosCategoryImage_businessId_idx" ON "PosCategoryImage"("businessId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCategoryImage_businessId_fkey' AND conrelid = '"PosCategoryImage"'::regclass) THEN
    ALTER TABLE "PosCategoryImage" ADD CONSTRAINT "PosCategoryImage_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
