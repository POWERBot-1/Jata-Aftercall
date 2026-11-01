/**
 * Media API with a durable storage provider configured (creative engine continuation).
 *
 * No storage vendor is approved yet, so production still runs the fail-closed path proven in
 * `media-route-upload.test.ts`. This suite mocks only the *provider resolution* (`lib/storage`)
 * to prove the route's other branch end-to-end: validated upload bytes go to the durable
 * provider under the caller's tenant prefix, the database records a durable URL with real
 * byte/mime metadata, and a provider that misbehaves (wrong tenant) fails the upload without
 * writing metadata. Auth, tenant guard, validation and audit run for real against a fake DB.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  guard: { ok: true } as { ok: boolean; status?: number; error?: string },
  created: [] as any[],
  puts: [] as any[],
  removed: [] as string[],
  deleted: [] as string[],
  deletedMany: [] as any[],
  removeFails: false,
  deleteFails: false,
  wrongTenant: false,
  wrongProviderId: false,
  providerDown: false,
  businessBytes: 0,
  globalBytes: 0,
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));

vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  assertBusinessOwnership: vi.fn(async () => undefined),
  guardTenantMutation: vi.fn(async () => mocks.guard),
}));

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

vi.mock("@/lib/db", () => ({
  default: {
    mediaAsset: {
      create: vi.fn(async ({ data, select }: any) => {
        const asset = { id: `asset-${mocks.created.length + 1}`, createdAt: new Date(), version: 0, ...data };
        mocks.created.push(asset);
        if (!select) return asset;
        return Object.fromEntries(Object.entries(select).filter(([, include]) => include === true).map(([key]) => [key, asset[key]]));
      }),
      aggregate: vi.fn(async ({ where }: any) => ({
        _sum: { bytes: where?.businessId ? mocks.businessBytes : mocks.globalBytes },
      })),
      findUnique: vi.fn(async ({ where }: any) => mocks.created.find((asset) => asset.id === where?.id) ?? null),
      findMany: vi.fn(async ({ where }: any) => mocks.created.filter((asset) =>
        asset.businessId === where?.businessId && asset.aiGenerationId === where?.aiGenerationId,
      )),
      delete: vi.fn(async ({ where }: any) => {
        if (mocks.deleteFails) throw new Error("simulated database outage");
        mocks.deleted.push(where.id);
        return mocks.created.find((asset) => asset.id === where.id) ?? null;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        mocks.deletedMany.push(where);
        const removed = mocks.created.filter((asset) => asset.businessId === where.businessId && asset.aiGenerationId === where.aiGenerationId);
        mocks.created = mocks.created.filter((asset) => !removed.includes(asset));
        return { count: removed.length };
      }),
    },
  },
}));

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  const provider = {
    id: "fake-durable",
    capabilities: { durable: true, cdn: true, maxObjectBytes: 12 * 1024 * 1024, derivatives: true, models: false },
    async put(input: any) {
      if (mocks.providerDown) throw new Error("provider unavailable");
      mocks.puts.push(input);
      const owner = mocks.wrongTenant ? "business-b" : input.businessId;
      const key = `tenants/${owner}/${input.kind}/${input.name}`;
      return { provider: mocks.wrongProviderId ? "unexpected-provider" : "fake-durable", key, url: `https://cdn.example.test/${key}`, bytes: input.body.length, contentType: input.contentType };
    },
    async remove(ref: { key: string }) {
      mocks.removed.push(ref.key);
      if (mocks.removeFails) throw new Error("simulated storage outage");
    },
  };
  return { ...actual, resolveDurableStorageProvider: () => provider };
});

import { DELETE, POST } from "@/app/api/media/route";
import { dataUrlFor, jpegBytes, textBytes } from "../helpers/imageFixtures";

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/media", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  mocks.guard = { ok: true };
  mocks.created = [];
  mocks.puts = [];
  mocks.removed = [];
  mocks.deleted = [];
  mocks.deletedMany = [];
  mocks.removeFails = false;
  mocks.deleteFails = false;
  mocks.wrongTenant = false;
  mocks.wrongProviderId = false;
  mocks.providerDown = false;
  mocks.businessBytes = 0;
  mocks.globalBytes = 0;
  mocks.session = { userId: "user-a", role: "OWNER" };
});

describe("media upload with durable storage configured", () => {
  it("stores validated bytes with the provider and records a durable URL, never inline data", async () => {
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes({ width: 1600, height: 1200 }), "image/jpeg"),
      alt: "Shop front",
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.asset.url).toMatch(/^https:\/\/cdn\.example\.test\/tenants\/business-a\/image-original\/upload-[0-9a-f-]+\.jpg$/);
    expect(body.asset.mime).toBe("image/jpeg");
    expect(body.asset.bytes).toBeGreaterThan(0);
    expect(body.asset.width).toBe(1600);
    expect(body.asset.height).toBe(1200);
    expect(JSON.stringify(body.asset)).not.toContain("data:image");
    expect(body.asset.storageKey).toBeUndefined();
    expect(mocks.created[0].storageProvider).toBe("fake-durable");
    expect(mocks.created[0].storageKey).toMatch(/^tenants\/business-a\/image-original\/upload-[0-9a-f-]+\.jpg$/);
    expect(mocks.puts).toHaveLength(1);
    expect(mocks.puts[0].businessId).toBe("business-a");
    expect(mocks.created).toHaveLength(1);
  });

  it("removes the tenant-owned durable object before deleting its metadata", async () => {
    mocks.created.push({
      id: "asset-delete", businessId: "business-a", url: "https://cdn.example.test/tenants/business-a/image-original/photo.jpg",
      storageProvider: "fake-durable", storageKey: "tenants/business-a/image-original/photo.jpg", aiGenerationId: null,
    });

    const response = await DELETE(new Request("http://localhost/api/media?id=asset-delete", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mocks.removed).toEqual(["tenants/business-a/image-original/photo.jpg"]);
    expect(mocks.deleted).toEqual(["asset-delete"]);
  });

  it("retains metadata when storage cleanup fails and makes retry safe", async () => {
    mocks.created.push({
      id: "asset-retry", businessId: "business-a", url: "https://cdn.example.test/tenants/business-a/image-original/photo.jpg",
      storageProvider: "fake-durable", storageKey: "tenants/business-a/image-original/photo.jpg", aiGenerationId: null,
    });
    mocks.removeFails = true;

    const failed = await DELETE(new Request("http://localhost/api/media?id=asset-retry", { method: "DELETE" }));
    expect(failed.status).toBe(503);
    expect(mocks.deleted).toHaveLength(0);

    mocks.removeFails = false;
    const retried = await DELETE(new Request("http://localhost/api/media?id=asset-retry", { method: "DELETE" }));
    expect(retried.status).toBe(200);
    expect(mocks.removed).toHaveLength(2);
    expect(mocks.deleted).toEqual(["asset-retry"]);
  });

  it("allows retry when the object was removed but the database deletion failed", async () => {
    mocks.created.push({
      id: "asset-db-retry", businessId: "business-a", url: "https://cdn.example.test/tenants/business-a/image-original/photo.jpg",
      storageProvider: "fake-durable", storageKey: "tenants/business-a/image-original/photo.jpg", aiGenerationId: null,
    });
    mocks.deleteFails = true;

    const failed = await DELETE(new Request("http://localhost/api/media?id=asset-db-retry", { method: "DELETE" }));
    expect(failed.status).toBe(500);
    expect(mocks.removed).toHaveLength(1);
    expect(mocks.deleted).toHaveLength(0);

    mocks.deleteFails = false;
    const retried = await DELETE(new Request("http://localhost/api/media?id=asset-db-retry", { method: "DELETE" }));
    expect(retried.status).toBe(200);
    expect(mocks.removed).toHaveLength(2); // provider DELETE is safe to retry for a missing key
    expect(mocks.deleted).toEqual(["asset-db-retry"]);
  });

  it("refuses cleanup for a stored key outside the authorized tenant", async () => {
    mocks.created.push({
      id: "asset-cross-tenant", businessId: "business-a", url: "https://cdn.example.test/tenants/business-b/image-original/photo.jpg",
      storageProvider: "fake-durable", storageKey: "tenants/business-b/image-original/photo.jpg", aiGenerationId: null,
    });

    const response = await DELETE(new Request("http://localhost/api/media?id=asset-cross-tenant", { method: "DELETE" }));

    expect(response.status).toBe(503);
    expect(mocks.removed).toHaveLength(0);
    expect(mocks.deleted).toHaveLength(0);
  });

  it("removes all generated durable objects before deleting the tenant-scoped generation rows", async () => {
    mocks.created.push(
      { id: "asset-generation-1", businessId: "business-a", aiGenerationId: "generation-a", storageProvider: "fake-durable", storageKey: "tenants/business-a/image-original/one.jpg" },
      { id: "asset-generation-2", businessId: "business-a", aiGenerationId: "generation-a", storageProvider: "fake-durable", storageKey: "tenants/business-a/image-original/two.jpg" },
    );

    const response = await DELETE(new Request("http://localhost/api/media?businessId=business-a&generationId=generation-a", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mocks.removed).toEqual([
      "tenants/business-a/image-original/one.jpg",
      "tenants/business-a/image-original/two.jpg",
    ]);
    expect(mocks.deletedMany).toEqual([{ businessId: "business-a", aiGenerationId: "generation-a" }]);
  });

  it("fails without writing metadata when the provider answers with another tenant's key", async () => {
    mocks.wrongTenant = true;
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "Shop front",
    });

    expect(response.status).toBe(500);
    expect(mocks.created).toHaveLength(0);
    expect(mocks.removed).toHaveLength(0);
  });

  it("rejects an object reference whose provider identity does not match the selected provider", async () => {
    mocks.wrongProviderId = true;
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "Shop front",
    });

    expect(response.status).toBe(500);
    expect(mocks.created).toHaveLength(0);
    expect(mocks.removed).toHaveLength(1);
    expect(mocks.removed[0]).toMatch(/^tenants\/business-a\//);
  });

  it("fails without writing metadata when the provider is down", async () => {
    mocks.providerDown = true;
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "Shop front",
    });

    expect(response.status).toBe(500);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses with 507 when the business storage ceiling is reached, before storing anything", async () => {
    mocks.businessBytes = 250 * 1024 * 1024;
    mocks.globalBytes = 250 * 1024 * 1024;
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "One photo too many",
    });

    expect(response.status).toBe(507);
    const body = await response.json();
    expect(body.code).toBe("storage_quota_exceeded");
    expect(body.scope).toBe("business");
    expect(mocks.puts).toHaveLength(0);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses with 507 (global scope) when the 5 GB global ceiling is reached", async () => {
    mocks.globalBytes = 5 * 1024 * 1024 * 1024;
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "Shop front",
    });

    expect(response.status).toBe(507);
    expect((await response.json()).scope).toBe("global");
    expect(mocks.puts).toHaveLength(0);
    expect(mocks.created).toHaveLength(0);
  });

  it("still rejects non-image bytes before the provider is touched", async () => {
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(textBytes(), "image/jpeg"),
      alt: "Not a photo",
    });

    expect(response.status).toBe(400);
    expect(mocks.puts).toHaveLength(0);
    expect(mocks.created).toHaveLength(0);
  });

  it("still requires the tenant guard before any storage happens", async () => {
    mocks.guard = { ok: false, status: 403, error: "No access" };
    const response = await post({
      businessId: "business-b",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "Someone else's shop",
    });

    expect(response.status).toBe(403);
    expect(mocks.puts).toHaveLength(0);
    expect(mocks.created).toHaveLength(0);
  });
});
