-- Preserve durable object identity so tenant-authorized media deletion can remove bytes
-- before deleting metadata. Nullable columns keep external references and legacy assets intact.
ALTER TABLE "MediaAsset"
  ADD COLUMN IF NOT EXISTS "storageProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
