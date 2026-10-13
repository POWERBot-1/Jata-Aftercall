import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as any,
  business: { category: "salon", isPublished: false, status: "DRAFT" } as any,
  ownership: vi.fn(),
  services: vi.fn(),
  businessRead: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => mocks.session }));
vi.mock("@/lib/tenant", () => ({ assertBusinessOwnership: mocks.ownership, guardTenantMutation: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { business: { findUnique: mocks.businessRead }, service: { findMany: mocks.services } } }));

import { GET } from "@/app/api/services/route";
const request = (id = "business-a") => new Request(`https://jata.test/api/services?businessId=${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = null;
  mocks.business = { category: "salon", isPublished: false, status: "DRAFT" };
  mocks.businessRead.mockImplementation(async () => mocks.business);
  mocks.ownership.mockRejectedValue(new Error("Different tenant"));
  mocks.services.mockResolvedValue([{ id: "service-a", businessId: "business-a", title: "Haircut" }]);
});

describe("services: ownership or public active catalogue, never unpublished tenant leakage", () => {
  it("refuses anonymous draft reads before querying services", async () => {
    const res = await GET(request());
    expect(res.status).toBe(404);
    expect(mocks.services).not.toHaveBeenCalled();
  });
  it("a session alone does not grant access to another tenant's draft", async () => {
    mocks.session = { userId: "user-b", role: "CUSTOMER" };
    expect((await GET(request())).status).toBe(404);
    expect(mocks.ownership).toHaveBeenCalledWith("business-a", mocks.session);
    expect(mocks.services).not.toHaveBeenCalled();
  });
  it("allows the authenticated owner to edit their own inactive services", async () => {
    mocks.session = { userId: "user-a", role: "CUSTOMER" };
    mocks.ownership.mockResolvedValue(undefined);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(mocks.services).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "business-a" }, take: 200 }));
  });
  it("public visitors get only active services of a published business", async () => {
    mocks.business.isPublished = true;
    mocks.business.status = "ACTIVE";
    expect((await GET(request())).status).toBe(200);
    expect(mocks.services).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "business-a", isActive: true } }));
  });
  it("another tenant still gets only the public active catalogue", async () => {
    mocks.session = { userId: "user-b", role: "CUSTOMER" };
    mocks.business.isPublished = true;
    expect((await GET(request())).status).toBe(200);
    expect(mocks.services).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "business-a", isActive: true } }));
  });
  it("refuses public suspended-business reads even if isPublished remains true", async () => {
    mocks.business = { ...mocks.business, isPublished: true, status: "SUSPENDED" };
    expect((await GET(request())).status).toBe(404);
    expect(mocks.services).not.toHaveBeenCalled();
  });
  it("missing business and missing identifier do not read catalogue data", async () => {
    mocks.business = null;
    expect((await GET(request())).status).toBe(404);
    expect((await GET(request(""))).status).toBe(400);
    expect(mocks.services).not.toHaveBeenCalled();
  });
  it("a database error fails safely without leaking implementation or credentials", async () => {
    mocks.businessRead.mockRejectedValue(new Error("postgresql://private"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("postgresql");
    expect(mocks.services).not.toHaveBeenCalled();
  });
});
