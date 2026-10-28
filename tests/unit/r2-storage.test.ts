/**
 * Cloudflare R2 storage adapter (owner decision 2026-10-26, free-first).
 *
 * These tests drive the real adapter with a fake S3 client — no network, no credentials.
 * They prove the contract the rest of the app relies on: tenant-scoped keys from
 * `objectKeyFor`, durable public URLs, safe deletion, loud-but-leak-free configuration
 * errors, and fail-closed resolution whenever R2 is not fully configured. Real-bucket
 * end-to-end verification is a separate, credential-gated step (R2_SETUP.md) and is NOT
 * claimed here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasDurableStorage,
  IMPLEMENTED_PROVIDERS,
  resolveDurableStorageProvider,
  resolveStorageProvider,
  StorageCapabilityError,
  StorageNotConfiguredError,
} from "@/lib/storage";
import { createR2Storage, missingR2Env, r2ConfigFromEnv, type R2ObjectClient } from "@/lib/storage/r2";
import { creativeCapabilities } from "@/lib/creative/capabilities";

const FULL_ENV = {
  JATA_STORAGE_PROVIDER: "cloudflare-r2",
  R2_ACCOUNT_ID: "acct-123",
  R2_ACCESS_KEY_ID: "key-abc",
  R2_SECRET_ACCESS_KEY: "secret-xyz",
  R2_BUCKET: "jata-media-test",
  R2_PUBLIC_BASE_URL: "https://pub-test.r2.dev/",
} as unknown as NodeJS.ProcessEnv;

function fakeClient(fail = false) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client: R2ObjectClient = {
    async send(command) {
      sent.push({ name: command.constructor.name, input: (command as unknown as { input: Record<string, unknown> }).input });
      if (fail) throw new Error("simulated provider outage at https://acct-123.example with key-abc");
      return {};
    },
  };
  return { client, sent };
}

const PUT = {
  businessId: "business-a",
  kind: "image-original" as const,
  name: "upload-1234.jpg",
  contentType: "image/jpeg",
  body: new Uint8Array([1, 2, 3, 4]),
};

describe("R2 configuration", () => {
  it("names every missing variable without ever echoing a value", () => {
    expect(missingR2Env({} as NodeJS.ProcessEnv)).toEqual([
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "R2_PUBLIC_BASE_URL",
    ]);
    try {
      r2ConfigFromEnv({ R2_ACCOUNT_ID: "acct-123", R2_ACCESS_KEY_ID: "key-abc" } as unknown as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageNotConfiguredError);
      const message = (error as Error).message;
      expect(message).toContain("R2_SECRET_ACCESS_KEY");
      expect(message).not.toContain("key-abc");
    }
  });

  it("derives the canonical R2 endpoint and normalises the public base URL", () => {
    const config = r2ConfigFromEnv(FULL_ENV);
    expect(config.endpoint).toBe("https://acct-123.r2.cloudflarestorage.com");
    expect(config.publicBaseUrl).toBe("https://pub-test.r2.dev");
    expect(config.bucket).toBe("jata-media-test");
  });

  it("is listed as implemented, but resolution stays fail-closed until fully configured", () => {
    expect(IMPLEMENTED_PROVIDERS).toContain("cloudflare-r2");
    expect(() => resolveStorageProvider({ JATA_STORAGE_PROVIDER: "cloudflare-r2" } as unknown as NodeJS.ProcessEnv)).toThrow(
      StorageNotConfiguredError,
    );
    expect(resolveDurableStorageProvider({ JATA_STORAGE_PROVIDER: "cloudflare-r2" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(hasDurableStorage({} as NodeJS.ProcessEnv)).toBe(false);

    const provider = resolveStorageProvider(FULL_ENV);
    expect(provider.id).toBe("cloudflare-r2");
    expect(provider.capabilities.durable).toBe(true);
    expect(resolveDurableStorageProvider(FULL_ENV)?.id).toBe("cloudflare-r2");
    expect(hasDurableStorage(FULL_ENV)).toBe(true);
  });
});

describe("R2 adapter behaviour (fake S3 client)", () => {
  it("stores under the owning tenant's key and returns a durable public URL", async () => {
    const { client, sent } = fakeClient();
    const provider = createR2Storage(FULL_ENV, () => client);

    const ref = await provider.put(PUT);

    expect(ref).toMatchObject({
      provider: "cloudflare-r2",
      key: "tenants/business-a/image-original/upload-1234.jpg",
      url: "https://pub-test.r2.dev/tenants/business-a/image-original/upload-1234.jpg",
      bytes: 4,
      contentType: "image/jpeg",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("PutObjectCommand");
    expect(sent[0].input).toMatchObject({
      Bucket: "jata-media-test",
      Key: "tenants/business-a/image-original/upload-1234.jpg",
      ContentType: "image/jpeg",
      ContentLength: 4,
      CacheControl: "public, max-age=31536000, immutable",
    });
    expect(provider.capabilities).toMatchObject({ durable: true, derivatives: true, models: false });
  });

  it("rejects traversal and mismatched file types before anything is sent", async () => {
    const { client, sent } = fakeClient();
    const provider = createR2Storage(FULL_ENV, () => client);

    await expect(provider.put({ ...PUT, name: "../secret.jpg" })).rejects.toBeInstanceOf(StorageCapabilityError);
    await expect(provider.put({ ...PUT, name: "photo.png" })).rejects.toThrow(/does not match/);
    await expect(provider.put({ ...PUT, businessId: "other-business", name: "x.html", contentType: "text/html" })).rejects.toThrow(
      /cannot be stored/,
    );
    expect(sent).toHaveLength(0);
  });

  it("deletes tenant objects and refuses keys outside the tenant namespace", async () => {
    const { client, sent } = fakeClient();
    const provider = createR2Storage(FULL_ENV, () => client);

    await provider.remove({ key: "tenants/business-a/image-original/upload-1234.jpg" });
    expect(sent[0].name).toBe("DeleteObjectCommand");
    expect(sent[0].input).toMatchObject({ Bucket: "jata-media-test", Key: "tenants/business-a/image-original/upload-1234.jpg" });

    await expect(provider.remove({ key: "backups/everything.zip" })).rejects.toBeInstanceOf(StorageCapabilityError);
    await expect(provider.remove({ key: "tenants/../secret" })).rejects.toBeInstanceOf(StorageCapabilityError);
    expect(sent).toHaveLength(1);
  });

  it("maps provider failures to a generic error that leaks no credentials or endpoints", async () => {
    const { client } = fakeClient(true);
    const provider = createR2Storage(FULL_ENV, () => client);

    await expect(provider.put(PUT)).rejects.toThrow("Durable media storage request failed.");
    try {
      await provider.put(PUT);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("secret-xyz");
      expect(message).not.toContain("key-abc");
      expect(message).not.toContain("acct-123");
    }
  });
});

describe("creative capabilities with R2 configured (env only — no network)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("flips durable storage on only when R2 is selected and fully configured", () => {
    expect(creativeCapabilities().durableStorage).toBe(false);

    for (const [key, value] of Object.entries(FULL_ENV as unknown as Record<string, string>)) {
      vi.stubEnv(key, value);
    }
    const matrix = creativeCapabilities();
    expect(matrix.durableStorage).toBe(true);
    expect(matrix.capabilities.find((c) => c.key === "upload-photo")?.state).toBe("available");
    // Animation/video have no provider regardless of storage — never claimed.
    expect(matrix.capabilities.find((c) => c.key === "video")?.state).toBe("unavailable");
    expect(matrix.capabilities.find((c) => c.key === "animation")?.state).toBe("unavailable");
  });
});
