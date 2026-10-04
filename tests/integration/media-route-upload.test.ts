/**
 * Media API integration — the mobile upload path end to end (§18, §19, §20, §41)
 *
 * The bug this suite exists to prevent: a phone sent a photo, the picker said "uploading", and
 * nothing was ever stored, because the client and the API disagreed about the field name and the
 * client refused formats the owner's camera actually produces. These tests drive the real route
 * handler with the real validation code and a fake database, so both the happy path and every
 * failure the owner can meet are asserted at the API boundary.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  guard: { ok: true } as { ok: boolean; status?: number; error?: string },
  created: [] as any[],
  existing: null as any,
  assets: [] as any[],
  deleted: [] as string[],
  updated: [] as any[],
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
      findFirst: vi.fn(async () => mocks.existing),
      findMany: vi.fn(async () => mocks.assets),
      findUnique: vi.fn(async ({ where }: any) => mocks.assets.find((asset) => asset.id === where.id) || mocks.existing || null),
      groupBy: vi.fn(async () => [
        { source: "UPLOAD", _count: { _all: 2 } },
        { source: "AI_GENERATED", _count: { _all: 1 } },
      ]),
      create: vi.fn(async ({ data }: any) => {
        const asset = { id: `asset-${mocks.created.length + 1}`, createdAt: new Date(), ...data };
        mocks.created.push(asset);
        return asset;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        mocks.updated.push({ where, data });
        return { id: where.id, ...data };
      }),
      delete: vi.fn(async ({ where }: any) => {
        mocks.deleted.push(where.id);
        return { id: where.id };
      }),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
  },
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/media/route";
import { MEDIA_RULES } from "@/lib/media/imageFormat";
import { dataUrlFor, gifBytes, heicBytes, jpegBytes, pngBytes, webpBytes } from "../helpers/imageFixtures";

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/media", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  mocks.guard = { ok: true };
  mocks.created = [];
  mocks.existing = null;
  mocks.assets = [];
  mocks.deleted = [];
  mocks.updated = [];
  mocks.session = { userId: "user-a", role: "OWNER" };
});

describe("uploading from a phone actually stores the photo", () => {
  it("stores a normalized JPEG with its real dimensions and the details the library needs", async () => {
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(jpegBytes({ width: 1600, height: 1200 }), "image/jpeg"),
      alt: "Chicken stew served with chapati",
      kind: "IMAGE",
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.asset.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(body.asset.width).toBe(1600);
    expect(body.asset.height).toBe(1200);
    expect(body.asset.mime).toBe("image/jpeg");
    expect(body.asset.source).toBe("UPLOAD");
    expect(body.asset.alt).toContain("Chicken stew");
    expect(mocks.created).toHaveLength(1);
  });

  it("accepts every format the Studio promises: JPEG, PNG, WebP and GIF", async () => {
    const cases: Array<[string, string]> = [
      ["image/jpeg", dataUrlFor(jpegBytes({ width: 900, height: 600 }), "image/jpeg")],
      ["image/png", dataUrlFor(pngBytes({ width: 512, height: 512 }), "image/png")],
      ["image/webp", dataUrlFor(webpBytes({ width: 1024, height: 768 }), "image/webp")],
      ["image/gif", dataUrlFor(gifBytes({ width: 300, height: 200 }), "image/gif")],
    ];
    for (const [mime, dataUrl] of cases) {
      mocks.created = [];
      const response = await post({ businessId: "business-a", dataUrl, alt: "photo" });
      expect(response.status, mime).toBe(201);
      const body = await response.json();
      expect(body.asset.mime, mime).toBe(mime);
      expect(body.asset.width, mime).toBeGreaterThan(0);
    }
  });

  it("keeps the legacy { url } contract working for existing callers and library reuse", async () => {
    const response = await post({ businessId: "business-a", kind: "IMAGE", url: "/uploads/hero.jpg", alt: "Front of shop" });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.asset.url).toBe("/uploads/hero.jpg");
  });

  it("does not store the same photo twice — an identical upload is reused", async () => {
    const dataUrl = dataUrlFor(jpegBytes({ width: 800, height: 600, padding: 256 }), "image/jpeg");
    mocks.existing = { id: "asset-existing", url: dataUrl, alt: "Old alt", width: 800, height: 600, source: "UPLOAD", label: null };
    const response = await post({ businessId: "business-a", dataUrl, alt: "Chicken stew" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reused).toBe(true);
    expect(body.asset.id).toBe("asset-existing");
    expect(mocks.created).toHaveLength(0);
    expect(mocks.updated).toHaveLength(1);
  });

  it("scopes uploads to the owner's own business", async () => {
    mocks.guard = { ok: false, status: 403, error: "You don't have access to that business." };
    const response = await post({
      businessId: "business-b",
      dataUrl: dataUrlFor(jpegBytes(), "image/jpeg"),
      alt: "Someone else's product",
    });
    expect(response.status).toBe(403);
    expect(mocks.created).toHaveLength(0);
  });

  it("requires a signed-in owner", async () => {
    mocks.session = null;
    const response = await post({ businessId: "business-a", dataUrl: dataUrlFor(jpegBytes(), "image/jpeg") });
    expect(response.status).toBe(401);
  });
});

describe("the failures owners actually hit, with sentences they can act on", () => {
  it("explains an iPhone HEIC photo instead of failing silently", async () => {
    const response = await post({
      businessId: "business-a",
      dataUrl: dataUrlFor(heicBytes(), "image/heic"),
      alt: "IMG_4021.HEIC",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("heic_unsupported");
    expect(body.error).toContain("Most Compatible");
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses an SVG with a clear reason", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const response = await post({ businessId: "business-a", dataUrl: `data:image/svg+xml;base64,${svg}` });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/JPG, PNG, WebP or GIF/);
  });

  it("refuses a file whose declared type contradicts its bytes", async () => {
    const response = await post({
      businessId: "business-a",
      dataUrl: `data:image/png;base64,${Buffer.from(jpegBytes()).toString("base64")}`,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/JPG|PNG|WebP|GIF/);
  });

  it("reports an oversized payload as a 413 with the size in the message", async () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(9 * 1024 * 1024)}`;
    const response = await post({ businessId: "business-a", dataUrl: huge });
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toMatch(/MB/);
    expect(body.error).toContain("shrink");
  });

  it("rejects a corrupt payload without an internal error", async () => {
    const response = await post({ businessId: "business-a", dataUrl: "data:image/jpeg;base64,###" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).not.toContain("undefined");
  });

  it("publishes the rules the Studio and the tests both rely on", () => {
    expect(MEDIA_RULES.formats).toEqual(["jpeg", "png", "webp", "gif"]);
    expect(MEDIA_RULES.sniffedByContent).toBe(true);
    expect(MEDIA_RULES.svgAllowed).toBe(false);
  });
});

describe("the library itself: search, re-tag and delete", () => {
  it("lists only the tenant's images with counts for the filters", async () => {
    mocks.assets = [
      { id: "a1", url: "/a.jpg", kind: "IMAGE", alt: "Chicken", source: "UPLOAD", width: 800, height: 600 },
      { id: "a2", url: "/b.jpg", kind: "IMAGE", alt: "Chapati", source: "AI_GENERATED", width: 1024, height: 1024 },
    ];
    const response = await GET(new Request("http://localhost/api/media?businessId=business-a&q=chicken&limit=60"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assets).toHaveLength(2);
    expect(body.bySource.UPLOAD).toBe(2);
    expect(body.bySource.AI_GENERATED).toBe(1);
    expect(body.query).toBe("chicken");
  });

  it("updates the description of one of the owner's images", async () => {
    mocks.assets = [{ id: "a1", businessId: "business-a" }];
    const response = await PATCH(
      new Request("http://localhost/api/media", {
        method: "PATCH",
        body: JSON.stringify({ id: "a1", alt: "Grilled chicken on a plate" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.updated[0].data.alt).toContain("Grilled chicken");
  });

  it("deletes exactly the asset that was asked for, after checking its owner", async () => {
    mocks.assets = [{ id: "a1", businessId: "business-a" }];
    const response = await DELETE(new Request("http://localhost/api/media?id=a1", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(mocks.deleted).toEqual(["a1"]);
  });

  it("removes a whole AI generation in one call (\"delete these images\")", async () => {
    mocks.assets = [{ id: "a1", businessId: "business-a" }];
    const response = await DELETE(new Request("http://localhost/api/media?businessId=business-a&generationId=gen-1", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect((await response.json()).removed).toBe(2);
  });
});
