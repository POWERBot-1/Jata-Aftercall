/**
 * Publication gate on the services API.
 *
 * Regression: `GET /api/services?businessId=…` documented that public reads are limited to a
 * published business but returned every service for any business id, so an unpaid/draft
 * business's catalogue was readable through the API while `/b/[slug]` correctly returned 404.
 * The gate now matches the page: guests see published businesses only; the owner/admin session
 * is the only thing that unlocks a draft.
 */

import { describe, expect, it, vi } from "vitest";

const businesses: Record<string, { id: string; category: string; isPublished: boolean; status: string }> = {
  bizPublished: { id: "bizPublished", category: "Beauty", isPublished: true, status: "ACTIVE" },
  bizDraft: { id: "bizDraft", category: "Beauty", isPublished: false, status: "ACTIVE" },
  bizSuspended: { id: "bizSuspended", category: "Beauty", isPublished: true, status: "SUSPENDED" },
};

const sessions = { current: null as null | { userId: string; role: string } };

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: vi.fn(async ({ where }: any) => businesses[where?.id] || null),
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.ownerId === "owner") return Object.values(businesses).filter((b) => b.id !== "bizSuspended").map((b) => ({ id: b.id }));
        return [];
      }),
    },
    businessMember: { findMany: vi.fn(async () => []) },
    service: {
      findMany: vi.fn(async ({ where }: any) => [{ id: `svc-${where.businessId}`, title: "Braiding", priceLabel: "From KES 1,500", businessId: where.businessId }]),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ getSession: async () => sessions.current }));

import { GET as servicesGet } from "@/app/api/services/route";

function get(businessId: string) {
  return servicesGet(new Request(`https://jata.test/api/services?businessId=${encodeURIComponent(businessId)}`));
}

describe("services API respects the publication gate", () => {
  it("serves a published business to a guest", async () => {
    sessions.current = null;
    const response = await get("bizPublished");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.services).toHaveLength(1);
  });

  it("hides a draft business from a guest (404, no payload)", async () => {
    sessions.current = null;
    const response = await get("bizDraft");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("hides a suspended business from a guest even though it is published", async () => {
    sessions.current = null;
    expect((await get("bizSuspended")).status).toBe(404);
  });

  it("lets the owning tenant read their own draft (studio/list usage)", async () => {
    sessions.current = { userId: "owner", role: "CUSTOMER" };
    const response = await get("bizDraft");
    expect(response.status).toBe(200);
    sessions.current = null;
  });

  it("hides a draft from another tenant", async () => {
    sessions.current = { userId: "stranger", role: "CUSTOMER" };
    expect((await get("bizDraft")).status).toBe(404);
    sessions.current = null;
  });

  it("lets an admin read any draft", async () => {
    sessions.current = { userId: "admin-1", role: "ADMIN" };
    expect((await get("bizDraft")).status).toBe(200);
    sessions.current = null;
  });

  it("returns 404 for an unknown business and 400 without a business id", async () => {
    sessions.current = null;
    expect((await get("bizMissing")).status).toBe(404);
    const missing = await servicesGet(new Request("https://jata.test/api/services"));
    expect(missing.status).toBe(400);
  });
});
