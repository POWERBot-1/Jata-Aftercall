-- Preserve every existing product/category-image association while introducing independently
-- managed categories. Backfill only the new table; no existing business rows are rewritten.
CREATE TABLE IF NOT EXISTS "PosCategory" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PosCategory_businessId_name_key" ON "PosCategory"("businessId", "name");
CREATE INDEX IF NOT EXISTS "PosCategory_businessId_isActive_idx" ON "PosCategory"("businessId", "isActive");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCategory_businessId_fkey' AND conrelid = '"PosCategory"'::regclass) THEN
    ALTER TABLE "PosCategory" ADD CONSTRAINT "PosCategory_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
INSERT INTO "PosCategory" ("id", "businessId", "name", "updatedAt")
SELECT 'legacy_' || md5("businessId" || chr(31) || "name"), "businessId", "name", CURRENT_TIMESTAMP
FROM (SELECT "businessId", category AS "name" FROM "PosProduct" WHERE category IS NOT NULL
      UNION SELECT "businessId", category AS "name" FROM "PosCategoryImage") AS existing
ON CONFLICT ("businessId", "name") DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosProduct_businessId_category_fkey' AND conrelid = '"PosProduct"'::regclass) THEN
    ALTER TABLE "PosProduct" ADD CONSTRAINT "PosProduct_businessId_category_fkey"
      FOREIGN KEY ("businessId", category) REFERENCES "PosCategory"("businessId", "name") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosCategoryImage_businessId_category_fkey' AND conrelid = '"PosCategoryImage"'::regclass) THEN
    ALTER TABLE "PosCategoryImage" ADD CONSTRAINT "PosCategoryImage_businessId_category_fkey"
      FOREIGN KEY ("businessId", category) REFERENCES "PosCategory"("businessId", "name") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;
END $$;
-- Legacy free-text product creation continues to create a category, atomically. A deactivated
-- category may remain on an existing item, but cannot be newly assigned. The row lock makes
-- concurrent deactivation and assignment serialize; the FK protects deletion and rename.
CREATE OR REPLACE FUNCTION pos_product_ensure_category() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category_active BOOLEAN;
BEGIN
  IF NEW.category IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.category IS NOT DISTINCT FROM OLD.category AND NEW."businessId" IS NOT DISTINCT FROM OLD."businessId" THEN RETURN NEW; END IF;
  INSERT INTO "PosCategory" ("id", "businessId", "name", "updatedAt")
  VALUES ('auto_' || md5(random()::text || clock_timestamp()::text || NEW."businessId" || NEW.category), NEW."businessId", NEW.category, CURRENT_TIMESTAMP)
  ON CONFLICT ("businessId", "name") DO NOTHING;
  SELECT "isActive" INTO category_active FROM "PosCategory" WHERE "businessId" = NEW."businessId" AND "name" = NEW.category FOR SHARE;
  IF NOT category_active THEN RAISE EXCEPTION 'POS_CATEGORY_INACTIVE'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_product_ensure_category_guard' AND tgrelid = '"PosProduct"'::regclass) THEN
    CREATE TRIGGER pos_product_ensure_category_guard BEFORE INSERT OR UPDATE ON "PosProduct"
      FOR EACH ROW EXECUTE FUNCTION pos_product_ensure_category();
  END IF;
END $$;
