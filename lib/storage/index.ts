/**
 * Storage provider selection and capability checks (storage decision)
 *
 * Selection is server-side configuration only (JATA_STORAGE_PROVIDER). The default is the inline
 * provider, so nothing changes for existing sites. Selecting a provider that is not implemented in
 * this build fails loudly with an explanation, rather than silently falling back and losing uploads.
 */

import { createInlineStorage, INLINE_PROVIDER_ID } from "./inline";
import { StorageCapabilityError, StorageNotConfiguredError, type ObjectStorageProvider, type StorageKind } from "./types";

export { INLINE_PROVIDER_ID } from "./inline";
export * from "./types";
export { objectKeyFor, keyBelongsToTenant, MAX_BYTES_BY_KIND, CONTENT_TYPES_BY_KIND, tenantPrefix } from "./keys";

/** Providers this build knows how to run. Others are reported as not configured. */
export const IMPLEMENTED_PROVIDERS = [INLINE_PROVIDER_ID] as const;

export function resolveStorageProvider(env: NodeJS.ProcessEnv = process.env): ObjectStorageProvider {
  const requested = (env.JATA_STORAGE_PROVIDER || INLINE_PROVIDER_ID).trim();
  if (requested === INLINE_PROVIDER_ID) return createInlineStorage();
  if (requested === "vercel-blob") {
    throw new StorageNotConfiguredError(
      "Vercel Blob is evaluated but not enabled in this build. See STORAGE_DECISION.md before configuring it.",
    );
  }
  throw new StorageNotConfiguredError(`Unknown storage provider "${requested.slice(0, 40)}".`);
}

/** Refuses an operation the provider cannot honour, before any bytes move. */
export function assertCanStore(provider: ObjectStorageProvider, kind: StorageKind, bytes: number): void {
  const caps = provider.capabilities;
  if (bytes > caps.maxObjectBytes) {
    throw new StorageCapabilityError("That file is larger than this storage can hold.");
  }
  if ((kind === "model-glb" || kind === "model-texture") && !caps.models) {
    throw new StorageCapabilityError("3D models need a durable storage provider, which is not configured yet.");
  }
  if (kind === "model-glb" || kind === "model-texture") {
    if (!caps.durable) throw new StorageCapabilityError("3D models must not depend on non-durable storage.");
  }
  if (kind === "image-derivative" && !caps.derivatives) {
    throw new StorageCapabilityError("Responsive image sizes need durable storage, which is not configured yet.");
  }
}
