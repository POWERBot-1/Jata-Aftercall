/**
 * Tenant isolation for the Interactive Business APIs (§37)
 *
 * The client supplies a businessId; the server decides whether that id belongs to the
 * signed-in owner. A route must never read, edit or publish another tenant's data, and where
 * a row id is supplied directly the stored row is re-checked rather than trusted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  ownershipError: null as Error | null,
  experience: { id: "exp-a", businessId: "business-a", draftJson: JSON.stringify({ categoryKey: "food", brand: {}, settings: {}, sections: [] }), categoryKey: "food", themeKey: "food-grill", draftVersion: 3, publishedVersion: 2, status: "PUBLISHED" },
  experienceUpdate: vi.fn(),
  productFind: vi.fn(),
  productUpdate: vi.fn(),
  productFindFirst: vi.fn(),
  orderFind: vi.fn(),
  orderUpdate: vi.fn(),
  bookingFind: vi.fn(),
  bookingUpdate: vi.fn(),
  mediaFindMany: vi.fn(),
  audit: vi.fn(),
}));

const OWNED = "business-a";
const FOREIGN = "business-b";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session), type: {} }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error { status = 403; },
  getOwnedBusinessIds: vi.fn(async () => [OWNED]),
  assertBusinessOwnership: vi.fn(async (businessId: string) => {
    if (mocks.ownershipError) throw mocks.ownershipError;
    if (businessId !== OWNED) {
      // The real helper throws a TenantError carrying status 403 (§37).
      throw Object.assign(new Error("Tenant isolation: business does not belong to authenticated user"), { status: 403 });
    }
  }),
  guardTenantMutation: vi.fn(async (_session: unknown, businessId: string) => {
    if (!businessId) return { ok: false as const, error: "Choose a business first.", status: 400 as const };
    if (businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
  assertSlugOwnershipByBusinessId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: { findUnique: vi.fn(async () => mocks.experience), update: mocks.experienceUpdate, upsert: vi.fn(), create: vi.fn() },
    product: { findFirst: mocks.productFindFirst, update: mocks.productUpdate, findMany: mocks.productFind },
    order: { findUnique: mocks.orderFind, update: mocks.orderUpdate },
    booking: { findUnique: mocks.bookingFind, update: mocks.bookingUpdate },
    mediaAsset: { findMany: mocks.mediaFindMany },
    auditEvent: { create: mocks.audit },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { PATCH as experiencePatch, GET as experienceGet } from "@/app/api/experience/route";
import { PATCH as productPatch } from "@/app/api/products/route";
import { PATCH as orderPatch } from "@/app/api/orders/route";
import { PATCH as bookingPatch } from "@/app/api/bookings/route";
import { GET as summaryGet } from "@/app/api/analytics/summary/route";

function post(url: string, body: unknown) {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
function patch(url: string, body: unknown) {
  return new Request(url, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.ownershipError = null;
  mocks.experienceUpdate.mockResolvedValue({ id: "exp-a", draftVersion: 4 });
  mocks.productFindFirst.mockResolvedValue(null);
  mocks.orderFind.mockResolvedValue(null);
  mocks.bookingFind.mockResolvedValue(null);
  mocks.mediaFindMany.mockResolvedValue([]);
  mocks.audit.mockResolvedValue({});
});

describe("experience editing is tenant-scoped", () => {
  it("rejects a draft edit for another tenant's business", async () => {
    const response = await experiencePatch(patch("https://jata.test/api/experience", {
      businessId: FOREIGN,
      op: "update",
      sectionId: "s1",
      patch: { title: "Hacked" },
    }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("rejects reading another tenant's experience", async () => {
    const response = await experienceGet(new Request(`https://jata.test/api/experience?businessId=${FOREIGN}`));
    expect(response.status).toBe(403);
  });

  it("allows the owner to edit their own draft", async () => {
    const response = await experiencePatch(patch("https://jata.test/api/experience", {
      businessId: OWNED,
      op: "toggle",
      sectionId: "s1",
    }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate).toHaveBeenCalled();
  });
});

describe("resource ids are re-checked against the stored row", () => {
  it("refuses to update a product that belongs to another tenant", async () => {
    mocks.productFindFirst.mockResolvedValue(null); // not found *within this tenant*
    const response = await productPatch(patch("https://jata.test/api/products", {
      businessId: OWNED,
      id: "product-of-b",
      name: "Taken over",
    }));
    expect(response.status).toBe(404);
    expect(mocks.productUpdate).not.toHaveBeenCalled();
    expect(mocks.productFindFirst).toHaveBeenCalledWith({ where: { id: "product-of-b", businessId: OWNED }, select: { id: true } });
  });

  it("refuses to move an order from another tenant", async () => {
    mocks.orderFind.mockResolvedValue({ id: "order-b", businessId: FOREIGN, status: "CONFIRMED" });
    const response = await orderPatch(patch("https://jata.test/api/orders", { orderId: "order-b", stage: "COMPLETED" }));
    expect(response.status).toBe(403);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });

  it("refuses to change a booking from another tenant", async () => {
    mocks.bookingFind.mockResolvedValue({ id: "booking-b", businessId: FOREIGN, status: "PENDING", serviceName: "Massage" });
    const response = await bookingPatch(patch("https://jata.test/api/bookings", { bookingId: "booking-b", status: "CONFIRMED" }));
    expect(response.status).toBe(403);
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });
});

describe("analytics stay inside the tenant", () => {
  it("refuses a summary for another tenant's business", async () => {
    const response = await summaryGet(new Request(`https://jata.test/api/analytics/summary?businessId=${FOREIGN}`));
    expect(response.status).toBe(403);
  });

  it("refuses without a session", async () => {
    mocks.session = null;
    const response = await summaryGet(new Request(`https://jata.test/api/analytics/summary?businessId=${OWNED}`));
    expect(response.status).toBe(401);
  });
});
