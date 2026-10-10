import { describe, expect, it } from "vitest";
import { assertCanStore, resolveStorageProvider, INLINE_PROVIDER_ID } from "@/lib/storage";
import { createInlineStorage } from "@/lib/storage/inline";
import { keyBelongsToTenant, objectKeyFor, tenantPrefix } from "@/lib/storage/keys";
import { StorageCapabilityError, StorageNotConfiguredError } from "@/lib/storage/types";

const BIZ = "biz_abc123";
const OTHER = "biz_zzz999";

describe("tenant-scoped object keys", () => {
  it("namespaces every key under the owning tenant", () => {
    const key = objectKeyFor({ businessId: BIZ, kind: "image-original", name: "product-1.jpg", contentType: "image/jpeg", bytes: 1000 });
    expect(key).toBe(`tenants/${BIZ}/image-original/product-1.jpg`);
    expect(keyBelongsToTenant(key, BIZ)).toBe(true);
    expect(keyBelongsToTenant(key, OTHER)).toBe(false);
  });

  it("rejects path traversal and separators in names", () => {
    for (const name of ["../secret.jpg", "a/b.jpg", "a\\b.jpg", "..jpg", ""]) {
      expect(() => objectKeyFor({ businessId: BIZ, kind: "image-original", name, contentType: "image/jpeg", bytes: 10 })).toThrow(StorageCapabilityError);
    }
  });

  it("rejects a name whose extension does not match the declared content type", () => {
    expect(() => objectKeyFor({ businessId: BIZ, kind: "image-original", name: "photo.png", contentType: "image/jpeg", bytes: 10 })).toThrow(/does not match/);
  });

  it("rejects a content type that the kind does not allow (for example a script as a photo)", () => {
    expect(() => objectKeyFor({ businessId: BIZ, kind: "image-original", name: "x.html", contentType: "text/html", bytes: 10 })).toThrow(/cannot be stored/);
    expect(() => objectKeyFor({ businessId: BIZ, kind: "model-glb", name: "x.jpg", contentType: "image/jpeg", bytes: 10 })).toThrow(/cannot be stored/);
  });

  it("enforces per-kind size ceilings", () => {
    expect(() => objectKeyFor({ businessId: BIZ, kind: "model-glb", name: "room.glb", contentType: "model/gltf-binary", bytes: 9 * 1024 * 1024 })).toThrow(/too large/);
    expect(() => objectKeyFor({ businessId: BIZ, kind: "image-derivative", name: "t.webp", contentType: "image/webp", bytes: 0 })).toThrow(/too large/);
  });

  it("refuses a malformed business identifier instead of building a prefix from it", () => {
    expect(() => tenantPrefix("../../etc")).toThrow(StorageCapabilityError);
    expect(keyBelongsToTenant("tenants/x/../../y", BIZ)).toBe(false);
  });
});

describe("inline provider (today's behaviour, declared honestly)", () => {
  it("declares itself non-durable with no derivatives and no models", () => {
    const provider = createInlineStorage();
    expect(provider.id).toBe(INLINE_PROVIDER_ID);
    expect(provider.capabilities).toMatchObject({ durable: false, derivatives: false, models: false });
  });

  it("stores a small photo as a data URL and returns a tenant-scoped key", async () => {
    const provider = createInlineStorage();
    const ref = await provider.put({ businessId: BIZ, kind: "image-original", name: "p.png", contentType: "image/png", body: new Uint8Array([137, 80, 78, 71]) });
    expect(ref.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(ref.key).toBe(`tenants/${BIZ}/image-original/p.png`);
    expect(ref.bytes).toBe(4);
  });

  it("refuses 3D models and derivatives: a data URL must never become the long-term model store", async () => {
    const provider = createInlineStorage();
    await expect(
      provider.put({ businessId: BIZ, kind: "model-glb", name: "m.glb", contentType: "model/gltf-binary", body: new Uint8Array(10) }),
    ).rejects.toBeInstanceOf(StorageCapabilityError);
    await expect(
      provider.put({ businessId: BIZ, kind: "image-derivative", name: "t.webp", contentType: "image/webp", body: new Uint8Array(10) }),
    ).rejects.toBeInstanceOf(StorageCapabilityError);
  });
});

describe("provider selection and capability gate", () => {
  it("defaults to the inline provider so existing sites are unaffected", () => {
    expect(resolveStorageProvider({} as NodeJS.ProcessEnv).id).toBe(INLINE_PROVIDER_ID);
  });

  it("fails loudly for Vercel Blob in this build, instead of silently losing uploads", () => {
    expect(() => resolveStorageProvider({ JATA_STORAGE_PROVIDER: "vercel-blob" } as unknown as NodeJS.ProcessEnv)).toThrow(StorageNotConfiguredError);
  });

  it("rejects an unknown provider name without echoing a long input", () => {
    try {
      resolveStorageProvider({ JATA_STORAGE_PROVIDER: "x".repeat(200) } as unknown as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageNotConfiguredError);
      expect((error as Error).message.length).toBeLessThan(120);
    }
  });

  it("blocks models and derivatives on the inline provider before any bytes move", () => {
    const provider = createInlineStorage();
    expect(() => assertCanStore(provider, "model-glb", 1000)).toThrow(/durable storage/);
    expect(() => assertCanStore(provider, "image-derivative", 1000)).toThrow(/durable storage/);
    expect(() => assertCanStore(provider, "image-original", 1000)).not.toThrow();
    expect(() => assertCanStore(provider, "image-original", 10 * 1024 * 1024 * 1024)).toThrow(/larger/);
  });
});
