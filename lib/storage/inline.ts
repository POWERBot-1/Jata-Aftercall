/**
 * The current, inline provider (storage decision)
 *
 * Historical photos may still be read from data URLs already present in business rows. New
 * writes through this provider are disabled: Neon must not receive binary media, and no durable
 * provider has been approved or configured. The provider remains identifiable for compatibility
 * and capability reporting, but `put` fails closed.
 */

import { MAX_STORED_CHARS } from "../media/imageFormat";
import { StorageCapabilityError, type ObjectStorageProvider, type PutObjectInput, type StoredObjectRef } from "./types";

export const INLINE_PROVIDER_ID = "inline-data-url";

export function createInlineStorage(): ObjectStorageProvider {
  return {
    id: INLINE_PROVIDER_ID,
    capabilities: {
      durable: false,
      cdn: false,
      // A data URL is base64 (4/3 expansion), so the largest binary that fits the stored-text cap is ~3/4 of it.
      maxObjectBytes: Math.floor((MAX_STORED_CHARS * 3) / 4),
      derivatives: false,
      models: false,
    },
    async put(_input: PutObjectInput): Promise<StoredObjectRef> {
      throw new StorageCapabilityError(
        "Inline image persistence is disabled. Configure an approved durable media provider before accepting new image bytes.",
      );
    },
    async remove() {
      // Inline objects are removed together with the database row that holds them.
    },
  };
}
