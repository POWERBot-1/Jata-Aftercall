/**
 * Object keys and per-kind rules (storage decision)
 *
 * Every key is namespaced by tenant: `tenants/<businessId>/<kind>/<name>`. A key that does not
 * start with the caller's own tenant prefix is rejected, so one tenant's code path cannot address
 * another tenant's objects even by accident.
 */

import { StorageCapabilityError, type StorageKind } from "./types";

const BUSINESS_ID = /^[a-zA-Z0-9_-]{6,64}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;

export const MAX_BYTES_BY_KIND: Record<StorageKind, number> = {
  "image-original": 12 * 1024 * 1024,
  "image-derivative": 2 * 1024 * 1024,
  // A product model. Anything larger is rejected rather than shipped to a phone.
  "model-glb": 8 * 1024 * 1024,
  "model-texture": 4 * 1024 * 1024,
};

/** Content types each kind may carry. A file's *name* alone never decides its type. */
export const CONTENT_TYPES_BY_KIND: Record<StorageKind, Record<string, string>> = {
  "image-original": { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" },
  "image-derivative": { "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/png": "png" },
  "model-glb": { "model/gltf-binary": "glb" },
  "model-texture": { "image/ktx2": "ktx2" },
};

export function tenantPrefix(businessId: string): string {
  if (!BUSINESS_ID.test(businessId)) throw new StorageCapabilityError("Invalid business identifier for storage.");
  return `tenants/${businessId}/`;
}

/** Builds the key for one object. Rejects traversal, wrong extensions and oversize requests. */
export function objectKeyFor(input: {
  businessId: string;
  kind: StorageKind;
  name: string;
  contentType: string;
  bytes: number;
}): string {
  const prefix = tenantPrefix(input.businessId);
  const allowed = CONTENT_TYPES_BY_KIND[input.kind];
  const extension = allowed[input.contentType];
  if (!extension) {
    throw new StorageCapabilityError(`That file type cannot be stored as ${input.kind}.`);
  }
  if (!NAME.test(input.name) || input.name.includes("..")) {
    throw new StorageCapabilityError("That file name is not allowed.");
  }
  if (!input.name.toLowerCase().endsWith(`.${extension}`)) {
    throw new StorageCapabilityError("The file name does not match its content type.");
  }
  if (!Number.isFinite(input.bytes) || input.bytes <= 0 || input.bytes > MAX_BYTES_BY_KIND[input.kind]) {
    throw new StorageCapabilityError("That file is too large for this kind of asset.");
  }
  return `${prefix}${input.kind}/${input.name}`;
}

/** True only when `key` lives under the given tenant. Use before any read, delete or signed URL. */
export function keyBelongsToTenant(key: string, businessId: string): boolean {
  try {
    return key.startsWith(tenantPrefix(businessId)) && !key.includes("..") && !key.includes("\\");
  } catch {
    return false;
  }
}
