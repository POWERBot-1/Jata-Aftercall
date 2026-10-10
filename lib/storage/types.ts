/**
 * Object storage contract (Immersive Website Engine — storage decision)
 *
 * Binary assets (photos, image derivatives, GLB models and textures) never go into Neon.
 * Neon keeps metadata only: a reference, a key, dimensions, bytes, a content type and provenance.
 * The binary itself lives behind this interface.
 *
 * Providers declare what they can do (`capabilities`). The engine checks those declarations before
 * it asks for something a provider cannot honour. For example, it never generates derivatives
 * or stores models in a provider that is not durable.
 *
 * This file is types only. Concrete adapters live beside it. No provider here requires a credential,
 * and none is enabled in production by this change.
 */

export const STORAGE_KINDS = ["image-original", "image-derivative", "model-glb", "model-texture"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export type StorageCapabilities = {
  /** Bytes survive independently of the database row that references them. */
  durable: boolean;
  /** Served from a CDN, so the browser can cache by URL. */
  cdn: boolean;
  /** Largest single object the provider accepts, in bytes. */
  maxObjectBytes: number;
  /** Can hold several sizes/formats of one photo (responsive derivatives). */
  derivatives: boolean;
  /** Can hold 3D models and their textures. */
  models: boolean;
};

export type PutObjectInput = {
  /** Tenant that owns the object. Used to build the key; never trusted from the browser alone. */
  businessId: string;
  kind: StorageKind;
  /** File name only, e.g. "hero-1600.webp". Path separators are rejected. */
  name: string;
  contentType: string;
  body: Uint8Array;
};

export type StoredObjectRef = {
  /** Which provider holds the bytes, e.g. "inline-data-url". */
  provider: string;
  key: string;
  url: string;
  bytes: number;
  contentType: string;
};

export interface ObjectStorageProvider {
  readonly id: string;
  readonly capabilities: StorageCapabilities;
  put(input: PutObjectInput): Promise<StoredObjectRef>;
  remove(ref: Pick<StoredObjectRef, "key">): Promise<void>;
}

export class StorageCapabilityError extends Error {
  readonly code = "STORAGE_CAPABILITY";
  constructor(message: string) {
    super(message);
    this.name = "StorageCapabilityError";
  }
}

export class StorageNotConfiguredError extends Error {
  readonly code = "STORAGE_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}
