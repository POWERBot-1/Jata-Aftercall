/**
 * AI Front Desk order board — stage transition contract (§12, §28).
 *
 * The owner order board distinguishes a malformed stage from an impossible one:
 *
 *   unknown stage            -> 400 (the request itself is invalid)
 *   impossible transition    -> 409 (the request is well-formed but conflicts with current state)
 *
 * The PR under review collapsed both into 422, which silently changed the contract the
 * Interactive Business end-to-end journey asserts (`13 — the owner receives the order and
 * processes it`, expecting 409) and turned a live GitHub check red.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  state: {
    currentUser: null as null | { userId: string; email: string; role: string },
    businesses: new Map<string, any>(),
    orders: new Map<string, any>(),
    auditEvents: [] as any[],
  },
  dbMock: {} as Record<string, any>,
}));

const state = hoisted.state;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () =>
    hoisted.state.currentUser
      ? { ...hoisted.state.currentUser, id: hoisted.state.currentUser.userId }
      : null,
  ),
  getSession: vi.fn(async () => hoisted.state.currentUser),
}));

Object.assign(hoisted.dbMock, {
  business: {
    findUnique: vi.fn(async ({ where }: any) => hoisted.state.businesses.get(where?.id) || null),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const b of hoisted.state.businesses.values()) {
        if (where?.id && b.id !== where.id) continue;
        if (where?.ownerId && b.ownerId !== where.ownerId) continue;
        return b;
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...hoisted.state.businesses.values()].filter(
        (b) => !where?.ownerId || b.ownerId === where.ownerId,
      ),
    ),
  },
  businessMember: { findMany: vi.fn(async () => []) },
  order: {
    findUnique: vi.fn(async ({ where }: any) => hoisted.state.orders.get(where?.id) || null),
    update: vi.fn(async ({ where, data }: any) => {
      const current = hoisted.state.orders.get(where.id);
      const next = { ...(current || {}), ...data };
      hoisted.state.orders.set(where.id, next);
      return next;
    }),
  },
  auditEvent: { create: vi.fn(async ({ data }: any) => ({ id: "audit_1", ...data })) },
});

vi.mock("@/lib/db", () => ({ default: hoisted.dbMock }));

import { PATCH as ordersPatch } from "@/app/api/orders/route";

const BUSINESS = "biz_owner";
const ORDER = "order_1";

function patch(body: unknown) {
  return new Request("https://jata.test/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Owner order board stage transitions (§12, §28)", () => {
  beforeEach(() => {
    hoisted.state.currentUser = { userId: "user_owner", email: "owner@jata.test", role: "OWNER" };
    hoisted.state.businesses.clear();
    hoisted.state.orders.clear();
    hoisted.state.auditEvents = [];
    hoisted.state.businesses.set(BUSINESS, { id: BUSINESS, ownerId: "user_owner", slug: "owner-shop" });
    // The order has been paid and confirmed, so the owner has accepted it into PROCESSING.
    hoisted.state.orders.set(ORDER, {
      id: ORDER,
      businessId: BUSINESS,
      status: "PROCESSING",
      paymentStatus: "PAID",
      totalKES: 1700,
    });
  });

  it("a legal transition is applied", async () => {
    const res = await ordersPatch(patch({ orderId: ORDER, stage: "READY" }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(hoisted.state.orders.get(ORDER).status).toBe("READY");
  });

  it("an impossible transition is a state conflict (409), not a generic validation error", async () => {
    // PROCESSING/ACCEPTED can never go back to NEW — the §66 journey asserts 409 here.
    const res = await ordersPatch(patch({ orderId: ORDER, stage: "NEW" }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("INVALID_TRANSITION");
    // The refused transition must not have mutated the order.
    expect(hoisted.state.orders.get(ORDER).status).toBe("PROCESSING");
  });

  it("an unknown stage is a malformed request (400)", async () => {
    const res = await ordersPatch(patch({ orderId: ORDER, stage: "DELIVERED_BY_DRONE" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("UNKNOWN_STAGE");
    expect(hoisted.state.orders.get(ORDER).status).toBe("PROCESSING");
  });

  it("another tenant's order cannot be transitioned (403)", async () => {
    hoisted.state.orders.set("order_other", {
      id: "order_other",
      businessId: "biz_other",
      status: "PROCESSING",
      paymentStatus: "PAID",
    });
    const res = await ordersPatch(patch({ orderId: "order_other", stage: "READY" }));
    expect(res.status).toBe(403);
  });

  it("an unauthenticated caller cannot transition an order (401)", async () => {
    hoisted.state.currentUser = null;
    const res = await ordersPatch(patch({ orderId: ORDER, stage: "READY" }));
    expect(res.status).toBe(401);
  });
});
