/**
 * The current, inline provider (storage decision)
 *
 * Today's photo uploads are stored as optimised data URLs in the business's own row. That keeps
 * the existing behaviour working, but it is NOT a durable binary store: the bytes live in the
 * database text column, so this provider declares `durable: false`, no derivatives and no models.
 * The engine uses it for single optimised photos only. It is the fallback, not the destination.
 */

import { MAX_STORED_CHARS } from "../media/imageFormat";
import { objectKeyFor } from "./keys";
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
    async put(input: PutObjectInput): Promise<StoredObjectRef> {
      if (input.kind === "model-glb" || input.kind === "model-texture" || input.kind === "image-derivative") {
        throw new StorageCapabilityError(`The inline store cannot hold ${input.kind}. Configure durable storage first.`);
      }
      const key = objectKeyFor({
        businessId: input.businessId,
        kind: input.kind,
        name: input.name,
        contentType: input.contentType,
        bytes: input.body.byteLength,
      });
      const url = `data:${input.contentType};base64,${Buffer.from(input.body).toString("base64")}`;
      if (url.length > MAX_STORED_CHARS) {
        throw new StorageCapabilityError("That image is too large to store inline. Upload a smaller photo.");
      }
      return { provider: INLINE_PROVIDER_ID, key, url, bytes: input.body.byteLength, contentType: input.contentType };
    },
    async remove() {
      // Inline objects are removed together with the database row that holds them.
    },
  };
}
