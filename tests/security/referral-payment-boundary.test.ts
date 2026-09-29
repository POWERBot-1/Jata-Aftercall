import { beforeEach, describe, expect, it, vi } from "vitest";

// Stage 1's payment-before-publication gate is the protected baseline. These tests pin that a
// referred business gets no publication or payment advantage from its referral origin.

const mocks = vi.hoisted(() => ({
  session: { userId: "user-b", role: "CUSTOMER", email: "b@example.test" } as any,
  payment: null as { status: string } | null,
  subscription: null as { status: string; expiresAt: Date | null; graceUntil: Date | null } | null,
  updates: [] as Array<Record<string, unknown>>,
  referralAccesses: 0,
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({
  default: {
    business: {
      update: vi.fn(async ({ where, data }: any) => {
        mocks.updates.push({ where, data });
        return { id: where.id, ...data };
      }),
    },
    payment: {
      findFirst: vi.fn(async () => mocks.payment),
    },
    subscription: {
      findUnique: vi.fn(async () => mocks.subscription),
    },
    // If the publication path ever consults referral state, this throws and the test fails.
    referral: {
      findUnique: vi.fn(async () => {
        mocks.referralAccesses += 1;
        throw new Error("publication must not depend on referral state");
      }),
      findFirst: vi.fn(async () => {
        mocks.referralAccesses += 1;
        throw new Error("publication must not depend on referral state");
      }),
      findMany: vi.fn(async () => {
        mocks.referralAccesses += 1;
        throw new Error("publication must not depend on referral state");
      }),
    },
  },
}));

import { PATCH } from "@/app/api/business/route";
import { PUBLISH_REQUIRES_PAYMENT, canSetPublished, hasVerifiedPublicationRight } from "@/lib/publication";
import { SAFE_ERRORS } from "@/lib/safeError";

const REFERRED_BUSINESS = "biz-referred";
const in30Days = new Date(Date.now() + 30 * 86400000);
const in33Days = new Date(Date.now() + 33 * 86400000);
const yesterday = new Date(Date.now() - 86400000);

function patch(body: unknown) {
  return PATCH(
    new Request("https://jata.test/api/business", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-b", role: "CUSTOMER", email: "b@example.test" };
  mocks.payment = null;
  mocks.subscription = null;
  mocks.updates = [];
  mocks.referralAccesses = 0;
});

describe("referred business — publication still requires verified payment", () => {
  it("rejects publishing a referred business that has no payment", async () => {
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: SAFE_ERRORS.publishPaymentRequired });
    expect(mocks.updates).toHaveLength(0);
  });

  it("rejects publishing a referred business whose payment is not verified", async () => {
    mocks.payment = { status: "PENDING" };
    mocks.subscription = { status: "ACTIVE", expiresAt: in30Days, graceUntil: in33Days };
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    expect(response.status).toBe(403);
    expect(mocks.updates).toHaveLength(0);
  });

  it("rejects publishing a referred business whose subscription lapsed", async () => {
    mocks.payment = { status: "PAID" };
    mocks.subscription = { status: "EXPIRED", expiresAt: yesterday, graceUntil: yesterday };
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    expect(response.status).toBe(403);
    expect(mocks.updates).toHaveLength(0);
  });

  it("rejects publishing when a subscription is active but no verified payment backs it", async () => {
    mocks.payment = null;
    mocks.subscription = { status: "ACTIVE", expiresAt: in30Days, graceUntil: in33Days };
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    expect(response.status).toBe(403);
    expect(mocks.updates).toHaveLength(0);
  });

  it("allows publishing a referred business once payment is verified", async () => {
    mocks.payment = { status: "PAID" };
    mocks.subscription = { status: "ACTIVE", expiresAt: in30Days, graceUntil: in33Days };
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    expect(response.status).toBe(200);
    expect(mocks.updates[0].data).toMatchObject({ isPublished: true });
  });

  it("always allows unpublishing a referred business", async () => {
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: false });
    expect(response.status).toBe(200);
    expect(mocks.updates[0].data).toMatchObject({ isPublished: false });
  });

  it("keeps the admin operator override unchanged", async () => {
    mocks.session = { userId: "admin", role: "ADMIN", email: "admin@jata.link" };
    const response = await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    expect(response.status).toBe(200);
    expect(mocks.updates[0].data).toMatchObject({ isPublished: true });
  });

  it("never reads referral state when deciding publication", async () => {
    mocks.payment = { status: "PAID" };
    mocks.subscription = { status: "ACTIVE", expiresAt: in30Days, graceUntil: in33Days };
    await patch({ businessId: REFERRED_BUSINESS, isPublished: true });
    await patch({ businessId: REFERRED_BUSINESS, isPublished: false });
    expect(mocks.referralAccesses).toBe(0);
  });
});

describe("publication gate has no referral input", () => {
  it("pins the Stage 1 gate", () => {
    expect(PUBLISH_REQUIRES_PAYMENT).toBe(true);
    expect(canSetPublished(true)).toBe(false);
    expect(canSetPublished(true, { verifiedPayment: true })).toBe(true);
  });

  it("cannot be satisfied by referral context", () => {
    // Extra referral context passed in is ignored: only payment evidence grants the right.
    expect(hasVerifiedPublicationRight({ paidPayment: null, subscription: { status: "ACTIVE", expiresAt: in30Days }, referral: "CONVERTED" } as any)).toBe(false);
    expect(hasVerifiedPublicationRight({ paidPayment: { status: "PENDING" }, subscription: null, referral: "CONVERTED" } as any)).toBe(false);
    expect(canSetPublished(true, { verifiedPayment: false, referralRecorded: true } as any)).toBe(false);
    expect(canSetPublished(true, { isAdmin: false, verifiedPayment: false, referralRecorded: true } as any)).toBe(false);
  });
});
