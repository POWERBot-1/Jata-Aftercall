/**
 * Inline-image write guards for catalogue routes. These route tests use isolated Prisma mocks;
 * no database, provider, or image bytes are written.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "OWNER" } as any,
  productExisting: null as any,
  serviceExisting: null as any,
  offerExisting: null as any,
  productCreate: vi.fn(),
  productUpdate: vi.fn(),
  productFindFirst: vi.fn(async () => mocks.productExisting),
  serviceCreate: vi.fn(),
  serviceUpdate: vi.fn(),
  serviceFindUnique: vi.fn(async () => mocks.serviceExisting),
  offerFindUnique: vi.fn(async () => mocks.offerExisting),
  offerUpsert: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error { status = 403; },
  assertBusinessOwnership: vi.fn(async () => undefined),
  guardTenantMutation: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/db", () => {
  const tx = {
    productVariant: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    product: { update: mocks.productUpdate },
  };
  return {
    default: {
      product: { create: mocks.productCreate, findFirst: mocks.productFindFirst },
      service: { create: mocks.serviceCreate, findUnique: mocks.serviceFindUnique, update: mocks.serviceUpdate },
      offer: { findUnique: mocks.offerFindUnique, upsert: mocks.offerUpsert },
      $transaction: mocks.transaction.mockImplementation(async (work: any) => work(tx)),
    },
  };
});

import { POST as productPost, PATCH as productPatch } from "@/app/api/products/route";
import { POST as servicePost, PATCH as servicePatch } from "@/app/api/services/route";
import { POST as offerPost } from "@/app/api/offer/route";
import { PATCH as businessPatch, POST as businessPost } from "@/app/api/business/route";

const INLINE = "data:image/png;base64,iVBORw0KGgo=";
const BUSINESS_ID = "business-a";

function request(path: string, body: unknown, method = "POST") {
  return new Request(`https://jata.test${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "owner-a", role: "OWNER" };
  mocks.productExisting = null;
  mocks.serviceExisting = null;
  mocks.offerExisting = null;
  mocks.productCreate.mockImplementation(async ({ data }: any) => ({ id: "p-new", ...data }));
  mocks.productUpdate.mockImplementation(async ({ data }: any) => ({ id: "p-existing", ...data }));
  mocks.serviceCreate.mockImplementation(async ({ data }: any) => ({ id: "s-new", ...data }));
  mocks.serviceUpdate.mockImplementation(async ({ data }: any) => ({ id: "s-existing", ...data }));
  mocks.offerUpsert.mockImplementation(async ({ update, create }: any) => ({ id: "offer-a", ...(mocks.offerExisting ? update : create) }));
  mocks.audit.mockResolvedValue(undefined);
});

describe("catalogue route inline-image writes", () => {
  it("blocks a new Product imageUrl or gallery before create", async () => {
    const mainImage = await productPost(request("/api/products", { businessId: BUSINESS_ID, name: "New item", imageUrl: INLINE }));
    expect(mainImage.status).toBe(503);
    expect((await mainImage.json()).code).toBe("inline_media_persistence_disabled");

    const gallery = await productPost(request("/api/products", { businessId: BUSINESS_ID, name: "New item", images: [{ url: "data:image/svg+xml,%3Csvg%3E" }] }));
    expect(gallery.status).toBe(503);
    expect((await gallery.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("rejects inline image data in the persisted Product name", async () => {
    const response = await productPost(request("/api/products", {
      businessId: BUSINESS_ID, name: `New item ${INLINE}`,
    }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("rejects inline data hidden in Product descriptions and nested variant JSON", async () => {
    const description = await productPost(request("/api/products", {
      businessId: BUSINESS_ID, name: "New item", description: `Photo: ${INLINE}`,
    }));
    expect(description.status).toBe(503);
    expect((await description.json()).code).toBe("inline_media_persistence_disabled");

    const variant = await productPost(request("/api/products", {
      businessId: BUSINESS_ID, name: "New item", variants: [{ label: "Small", options: { thumbnail: INLINE } }],
    }));
    expect(variant.status).toBe(503);
    expect((await variant.json()).code).toBe("inline_media_persistence_disabled");

    const serializedAddOns = await productPost(request("/api/products", {
      businessId: BUSINESS_ID, name: "New item", addOns: String.raw`{"thumbnail":"data:image\\/png;base64,AA=="}`,
    }));
    expect(serializedAddOns.status).toBe(503);
    expect((await serializedAddOns.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("blocks a new Service image before create or update", async () => {
    const response = await servicePost(request("/api/services", { businessId: BUSINESS_ID, title: "Haircut", imageUrl: "data:image/svg+xml,%3Csvg%3E" }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.serviceCreate).not.toHaveBeenCalled();

    mocks.serviceExisting = { id: "s-existing", businessId: BUSINESS_ID, imageUrl: null };
    const patch = await servicePatch(request("/api/services", {
      id: "s-existing", title: "Haircut", imageUrl: "data:image/svg+xml,%3Csvg%3E",
    }, "PATCH"));
    expect(patch.status).toBe(503);
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it("rejects inline data hidden in Service descriptions and Offer copy", async () => {
    const service = await servicePost(request("/api/services", {
      businessId: BUSINESS_ID, title: "Haircut", description: `Sample: ${INLINE}`,
    }));
    expect(service.status).toBe(503);
    expect((await service.json()).code).toBe("inline_media_persistence_disabled");

    const serializedAvailability = await servicePost(request("/api/services", {
      businessId: BUSINESS_ID, title: "Haircut", availability: String.raw`{"thumbnail":"data:image\u002fpng;base64,AA=="}`,
    }));
    expect(serializedAvailability.status).toBe(503);
    expect((await serializedAvailability.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.serviceCreate).not.toHaveBeenCalled();

    const offer = await offerPost(request("/api/offer", {
      businessId: BUSINESS_ID, title: "Weekend offer", subtitle: `Preview ${INLINE}`,
    }));
    expect(offer.status).toBe(503);
    expect((await offer.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
  });

  it("blocks a new Offer image before upsert", async () => {
    const response = await offerPost(request("/api/offer", { businessId: BUSINESS_ID, title: "Weekend offer", imageUrl: "data:image/svg+xml,%3Csvg%3E" }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
  });

  it("refuses a new SVG image on an existing Product instead of silently clearing or saving it", async () => {
    mocks.productExisting = {
      id: "p-existing", businessId: BUSINESS_ID, basePriceKES: 100, variantPriceKES: null,
      salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null, imageUrl: null, images: null,
    };
    const response = await productPatch(request("/api/products", {
      businessId: BUSINESS_ID, id: "p-existing", name: "Updated name", imageUrl: "data:image/svg+xml,%3Csvg%3E",
    }, "PATCH"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });

  it("does not rewrite an unchanged legacy Product image while updating other fields", async () => {
    mocks.productExisting = {
      id: "p-existing", businessId: BUSINESS_ID, basePriceKES: 100, variantPriceKES: null,
      salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null, imageUrl: INLINE, images: null,
    };
    const response = await productPatch(request("/api/products", {
      businessId: BUSINESS_ID, id: "p-existing", name: "Updated name", imageUrl: INLINE,
    }, "PATCH"));
    expect(response.status).toBe(200);
    const update = mocks.productUpdate.mock.calls[0][0];
    expect(update.data).not.toHaveProperty("imageUrl");
    expect(update.data.name).toBe("Updated name");
  });

  it("does not rewrite an unchanged legacy Product gallery while updating other fields", async () => {
    const legacyGallery = JSON.stringify([{ url: INLINE }]);
    mocks.productExisting = {
      id: "p-existing", businessId: BUSINESS_ID, basePriceKES: 100, variantPriceKES: null,
      salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null, imageUrl: null, images: legacyGallery,
    };
    const response = await productPatch(request("/api/products", {
      businessId: BUSINESS_ID, id: "p-existing", name: "Updated name", images: [{ url: INLINE }],
    }, "PATCH"));
    expect(response.status).toBe(200);
    expect(mocks.productUpdate.mock.calls[0][0].data).not.toHaveProperty("images");
  });

  it("does not rewrite an unchanged legacy Service image while updating other fields", async () => {
    mocks.serviceExisting = { id: "s-existing", businessId: BUSINESS_ID, imageUrl: INLINE };
    const response = await servicePatch(request("/api/services", { id: "s-existing", title: "New title", imageUrl: INLINE }, "PATCH"));
    expect(response.status).toBe(200);
    expect(mocks.serviceUpdate.mock.calls[0][0].data).not.toHaveProperty("imageUrl");
  });

  it("does not rewrite an unchanged legacy Offer image in an upsert", async () => {
    const legacySvg = "data:image/svg+xml,%3Csvg%3E";
    mocks.offerExisting = { imageUrl: legacySvg };
    const response = await offerPost(request("/api/offer", { businessId: BUSINESS_ID, title: "Updated offer", imageUrl: legacySvg }));
    expect(response.status).toBe(200);
    const upsert = mocks.offerUpsert.mock.calls[0][0];
    expect(upsert.update).not.toHaveProperty("imageUrl");
    expect(upsert.create.imageUrl).toBeNull();
  });

  it("blocks inline image data in business profile creation and edits before writes", async () => {
    const created = await businessPost(request("/api/business", { name: "Photo Cafe", description: `Menu ${INLINE}` }));
    expect(created.status).toBe(503);
    expect((await created.json()).code).toBe("inline_media_persistence_disabled");

    const updated = await businessPatch(request("/api/business", { businessId: BUSINESS_ID, socialLinks: { instagram: INLINE } }, "PATCH"));
    expect(updated.status).toBe(503);
    expect((await updated.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
