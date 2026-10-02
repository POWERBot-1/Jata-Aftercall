/**
 * Publishing gate (§3, §15, §58)
 *
 * The single most important rule in the package: an unpaid or incomplete premium site never
 * reaches customers — not by clicking a button, and not by calling the API directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  ownershipError: null as (Error & { status?: number }) | null,
  business: {
    id: "business-a", name: "Choma Place", slug: "choma-place", category: "Food & Restaurant",
    phone: "0722000000", whatsapp: null, location: "Kilimani", logoUrl: "/logo.png", isPublished: false,
  },
  experience: {
    id: "exp-a", businessId: "business-a", status: "DRAFT", categoryKey: "food", themeKey: "food-grill",
    draftJson: JSON.stringify({
      categoryKey: "food", themeKey: "food-grill",
      brand: { businessName: "Choma Place", heroImageUrl: "/hero.jpg" },
      settings: { phone: "0722000000", deliveryFeeKES: 200 },
      sections: [
        { id: "nav", type: "navigation", visible: true },
        { id: "hero", type: "hero", visible: true },
        { id: "menu", type: "menu", visible: true },
      ],
    }),
    publishedJson: null, draftVersion: 3, publishedVersion: 0,
  },
  productCount: 2,
  serviceCount: 0,
  products: [{ id: "p1", name: "Chicken", basePriceKES: 900, salePriceKES: null }],
  paidPayment: { status: "PAID" } as { status: string } | null,
  subscription: { status: "ACTIVE", expiresAt: new Date(Date.now() + 10 * 86400000), graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS", name: "Interactive Business" } } as any,
  entitlement: { entitled: true, status: "ACTIVE", reason: "Active" } as any,
  experienceUpdate: vi.fn(),
  businessUpdate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error { status = 403; },
  assertBusinessOwnership: vi.fn(async () => {
    if (mocks.ownershipError) throw mocks.ownershipError;
  }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business), update: mocks.businessUpdate },
    businessExperience: { findUnique: vi.fn(async () => mocks.experience), update: mocks.experienceUpdate },
    product: {
      count: vi.fn(async () => mocks.productCount),
      findMany: vi.fn(async () => mocks.products),
    },
    service: { count: vi.fn(async () => mocks.serviceCount) },
    payment: { findFirst: vi.fn(async () => mocks.paidPayment) },
    subscription: { findUnique: vi.fn(async () => mocks.subscription) },
    experienceVersion: { upsert: vi.fn(async () => ({})) },
    auditEvent: { create: mocks.audit },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/experience/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience/entitlement")>();
  return {
    ...actual,
    getInteractiveEntitlement: vi.fn(async () => mocks.entitlement),
    syncInteractiveEntitlement: mocks.sync,
  };
});

import { POST } from "@/app/api/experience/publish/route";

function request(body: unknown) {
  return new Request("https://jata.test/api/experience/publish", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.ownershipError = null;
  mocks.business.isPublished = false;
  mocks.experience.status = "DRAFT";
  mocks.experience.draftVersion = 3;
  mocks.experience.publishedVersion = 0;
  mocks.paidPayment = { status: "PAID" };
  mocks.subscription = { status: "ACTIVE", expiresAt: new Date(Date.now() + 10 * 86400000), graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS", name: "Interactive Business" } };
  mocks.entitlement = { entitled: true, status: "ACTIVE", reason: "Active" };
  mocks.productCount = 2;
  mocks.experienceUpdate.mockResolvedValue({ id: "exp-a", status: "PUBLISHED", publishedVersion: 3, publishedAt: new Date() });
  mocks.businessUpdate.mockResolvedValue({ id: "business-a", isPublished: true });
  mocks.transaction.mockImplementation(async (work: any) => work({
    businessExperience: { update: mocks.experienceUpdate },
    experienceVersion: { upsert: vi.fn(async () => ({})) },
    business: { update: mocks.businessUpdate },
    auditEvent: { create: mocks.audit },
  }));
  mocks.audit.mockResolvedValue({});
  mocks.sync.mockResolvedValue(mocks.entitlement);
});

describe("POST /api/experience/publish", () => {
  it("publishes a paid, entitled, complete website and snapshots the version", async () => {
    const response = await POST(request({ businessId: "business-a" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.published).toBe(true);
    expect(body.version).toBe(3);
    expect(mocks.experienceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED" }) }));
    expect(mocks.businessUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isPublished: true }) }));
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("refuses to publish before payment is verified", async () => {
    mocks.paidPayment = null;
    mocks.subscription = { status: "PENDING", expiresAt: null, graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS" } };
    const response = await POST(request({ businessId: "business-a" }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.requires).toBe("PAYMENT");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("refuses to publish when the entitlement has lapsed", async () => {
    mocks.entitlement = { entitled: false, status: "EXPIRED", reason: "Your Interactive Business subscription has expired." };
    const response = await POST(request({ businessId: "business-a" }));
    expect(response.status).toBe(403);
    expect((await response.json()).requires).toBe("ENTITLEMENT");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("refuses to publish a website that is not ready", async () => {
    mocks.productCount = 0;
    const response = await POST(request({ businessId: "business-a" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.requires).toBe("VALIDATION");
    expect(body.validation.ready).toBe(false);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("rejects publishing someone else's business", async () => {
    mocks.ownershipError = Object.assign(new Error("not owner"), { status: 403 });
    const response = await POST(request({ businessId: "business-b" }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("always allows unpublishing, because hiding a site must never be blocked", async () => {
    mocks.business.isPublished = true;
    mocks.entitlement = { entitled: false, status: "EXPIRED", reason: "expired" };
    mocks.paidPayment = null;
    const response = await POST(request({ businessId: "business-a", action: "unpublish" }));
    expect(response.status).toBe(200);
    expect((await response.json()).published).toBe(false);
    expect(mocks.businessUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isPublished: false }) }));
  });

  it("requires a session", async () => {
    mocks.session = null;
    expect((await POST(request({ businessId: "business-a" }))).status).toBe(401);
  });
});
