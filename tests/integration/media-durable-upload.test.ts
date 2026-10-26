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
  wrongTenant: false,
  providerDown: false,
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
      create: vi.fn(async ({ data }: any) => {
        const asset = { id: `asset-${mocks.created.length + 1}`, createdAt: new Date(), version: 0, ...data };
        mocks.created.push(asset);
        return asset;
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
      return { provider: "fake-durable", key, url: `https://cdn.example.test/${key}`, bytes: input.body.length, contentType: input.contentType };
    },
    async remove(ref: { key: string }) {
      mocks.removed.push(ref.key);
    },
  };
  return { ...actual, resolveDurableStorageProvider: () => provider };
});

import { POST } from "@/app/api/media/route";
import { dataUrlFor, jpegBytes, textBytes } from "../helpers/imageFixtures";

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/media", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  mocks.guard = { ok: true };
  mocks.created = [];
  mocks.puts = [];
  mocks.removed = [];
  mocks.wrongTenant = false;
  mocks.providerDown = false;
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
    expect(body.asset.businessId).toBe("business-a");
    expect(body.asset.mime).toBe("image/jpeg");
    expect(body.asset.bytes).toBeGreaterThan(0);
    expect(body.asset.width).toBe(1600);
    expect(body.asset.height).toBe(1200);
    expect(JSON.stringify(body.asset)).not.toContain("data:image");
    expect(mocks.puts).toHaveLength(1);
    expect(mocks.puts[0].businessId).toBe("business-a");
    expect(mocks.created).toHaveLength(1);
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
    expect(mocks.removed).toHaveLength(1);
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
