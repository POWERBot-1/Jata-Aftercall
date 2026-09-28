import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "CUSTOMER" } as any, guardResult: { ok: true } as any,
  businessFind: vi.fn(), businessCreate: vi.fn(), businessUpdate: vi.fn(), memberCreate: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: vi.fn(async () => mocks.guardResult) }));
vi.mock("@/lib/db", () => ({ default: { business: { findUnique: mocks.businessFind, create: mocks.businessCreate, update: mocks.businessUpdate }, businessMember: { create: mocks.memberCreate } } }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
import { PATCH, POST } from "@/app/api/business/route";

function request(method: string, body: unknown) { return new Request("https://example.test/api/business", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }); }

describe("business create and location updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "owner-a", role: "CUSTOMER" };
    mocks.guardResult = { ok: true };
    mocks.businessFind.mockResolvedValue(null);
    mocks.businessCreate.mockResolvedValue({ id: "biz-a", ownerId: "owner-a", name: "Cafe", slug: "cafe", location: "Nairobi", lat: -1.28, lng: 36.82 });
    mocks.businessUpdate.mockResolvedValue({ id: "biz-a", location: "Nairobi", lat: -1.28, lng: 36.82 });
    mocks.memberCreate.mockResolvedValue({ id: "member-a" });
  });

  it("requires authentication and persists valid location plus coordinates", async () => {
    mocks.session = null;
    expect((await POST(request("POST", { name: "Cafe" }))).status).toBe(401);
    mocks.session = { userId: "owner-a", role: "CUSTOMER" };
    const response = await POST(request("POST", { name: "Cafe", location: "Nairobi", lat: "-1.28", lng: "36.82" }));
    expect(response.status).toBe(201);
    expect(mocks.businessCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: "owner-a", location: "Nairobi", lat: -1.28, lng: 36.82 }) }));
  });

  it.each([["1", ""], ["north", "36"], ["91", "36"], ["-1", "181"]])("rejects invalid coordinates %s,%s", async (lat, lng) => {
    const response = await POST(request("POST", { name: "Cafe", lat, lng }));
    expect(response.status).toBe(400);
    expect(mocks.businessCreate).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant location edits and saves authorized edits", async () => {
    mocks.guardResult = { ok: false, status: 403, error: "You don't have access to that business." };
    expect((await PATCH(request("PATCH", { businessId: "other-biz", location: "Here", lat: "1", lng: "2" }))).status).toBe(403);
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
    mocks.guardResult = { ok: true };
    const response = await PATCH(request("PATCH", { businessId: "biz-a", location: "Nairobi", lat: "-1.28", lng: "36.82" }));
    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "biz-a" }, data: expect.objectContaining({ location: "Nairobi", lat: -1.28, lng: 36.82 }) }));
  });
});
