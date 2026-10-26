/**
 * Storage provider selection and capability checks (storage decision)
 *
 * Selection is server-side configuration only (JATA_STORAGE_PROVIDER). When unset, the legacy
 * inline identifier is retained for read/capability compatibility, but its `put` operation fails
 * closed. No durable write provider is configured. Selecting an unimplemented provider fails
 * loudly rather than silently falling back and putting image bytes in Neon.
 */

import { createInlineStorage, INLINE_PROVIDER_ID } from "./inline";
import { StorageCapabilityError, StorageNotConfiguredError, type ObjectStorageProvider, type StorageKind } from "./types";

export { INLINE_PROVIDER_ID } from "./inline";
export * from "./types";
export { objectKeyFor, keyBelongsToTenant, MAX_BYTES_BY_KIND, CONTENT_TYPES_BY_KIND, tenantPrefix } from "./keys";

/** Durable providers this build can currently write to. No provider is configured or approved. */
export const IMPLEMENTED_PROVIDERS: readonly string[] = [];

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

/**
 * The configured provider when — and only when — it can durably hold image bytes, else null.
 *
 * Never throws: callers that must fail closed (media uploads, the AI image lab, the creative
 * capability matrix) ask this instead of `resolveStorageProvider`, so an unapproved or
 * unimplemented `JATA_STORAGE_PROVIDER` value reads as "no durable storage" rather than
 * crashing a request. This does not approve any provider: with no adapter implemented it
 * always returns null today, and it starts returning a provider only after the owner selects
 * one and its adapter ships behind this same interface (see STORAGE_DECISION.md §7.5).
 */
export function resolveDurableStorageProvider(env: NodeJS.ProcessEnv = process.env): ObjectStorageProvider | null {
  try {
    const provider = resolveStorageProvider(env);
    return provider.capabilities.durable ? provider : null;
  } catch {
    return null;
  }
}

/** True only when generated/uploaded media can be durably saved in this deployment. */
export function hasDurableStorage(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDurableStorageProvider(env) !== null;
}

/** Refuses an operation the provider cannot honour, before any bytes move. */
export function assertCanStore(provider: ObjectStorageProvider, kind: StorageKind, bytes: number): void {
  const caps = provider.capabilities;
  if (bytes > caps.maxObjectBytes) {
    throw new StorageCapabilityError("That file is larger than this storage can hold.");
  }
  if (kind === "image-original" && !caps.durable) {
    throw new StorageCapabilityError("Image bytes require an approved durable media provider; inline persistence is disabled.");
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
