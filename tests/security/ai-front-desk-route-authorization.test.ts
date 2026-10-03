/**
 * AI Business Front Desk — route authorization & entitlement regression suite (§2, §3, §5, §54).
 *
 * These tests exist because the PR under review replaced mandatory session checks
 * (`if (!session) return 401`) with optional ones (`if (user) { …tenant check… }`) on several
 * AI Front Desk endpoints. That silently granted anonymous callers read *and write* access to
 * tenant intelligence, notifications, pre-orders and — through answer approval — to the
 * business's authoritative knowledge base. This suite pins the required matrix:
 *
 *   unauthenticated            -> 401
 *   authenticated wrong tenant -> 403
 *   authenticated right tenant -> permitted
 *
 * It also pins the commercial gate: a live AI Front Desk is the KES 499 / 30-day package, so an
 * unpublished/unpaid business must never serve customer AI (§2, §3, §49).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  state: {
  currentUser: null as null | { id: string; email: string; role: string },
  businesses: new Map<string, any>(),
  entitlement: null as null | Record<string, unknown>,
  subscription: null as null | Record<string, unknown>,
  paidPayment: null as null | Record<string, unknown>,
  plan: null as null | Record<string, unknown>,
    notificationRecipients: [] as any[],
  },
  dbMock: {} as Record<string, any>,
}));

const state = hoisted.state;
const dbMock = hoisted.dbMock;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => state.currentUser),
  getSession: vi.fn(async () => state.currentUser),
}));

Object.assign(dbMock, {
  business: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where?.slug) {
        for (const b of state.businesses.values()) if (b.slug === where.slug) return b;
        return null;
      }
      return state.businesses.get(where?.id) || null;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const b of state.businesses.values()) {
        if (where?.id && b.id !== where.id) continue;
        if (where?.ownerId && b.ownerId !== where.ownerId) continue;
        return b;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const b = state.businesses.get(where.id);
      const next = { ...(b || {}), ...data };
      state.businesses.set(where.id, next);
      return next;
    }),
  },
  businessMember: { findMany: vi.fn(async () => []) },
  product: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  productVariant: { findMany: vi.fn(async () => []) },
  service: { findMany: vi.fn(async () => []) },
  fAQ: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  knowledgeDocument: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  aIConfiguration: { findUnique: vi.fn(async () => null) },
  offer: { findUnique: vi.fn(async () => null) },
  merchantPaymentConfig: { findUnique: vi.fn(async () => null) },
  unansweredQuestion: { findMany: vi.fn(async () => []) },
  notificationRecipient: { findMany: vi.fn(async () => state.notificationRecipients) },
  aIPackageEntitlement: { findUnique: vi.fn(async () => state.entitlement) },
  subscription: { findUnique: vi.fn(async () => state.subscription) },
  payment: { findFirst: vi.fn(async () => state.paidPayment) },
  planConfig: { findUnique: vi.fn(async () => state.plan) },
  order: { findMany: vi.fn(async () => []) },
  notification: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: "n1" })) },
  auditEvent: { create: vi.fn(async () => ({ id: "a1" })) },
});

vi.mock("@/lib/db", () => ({ default: hoisted.dbMock }));

import { GET as demandGet, POST as demandPost } from "@/app/api/intelligence/demand/route";
import { GET as qualityGet, POST as qualityPost } from "@/app/api/intelligence/quality/route";
import {
  GET as questionsGet,
  POST as questionsPost,
} from "@/app/api/intelligence/questions/route";
import { GET as notificationsGet, POST as notificationsPost } from "@/app/api/notifications/route";
import { POST as preordersPost } from "@/app/api/preorders/route";
import { GET as merchantPaymentGet } from "@/app/api/merchant-payment/route";
import { POST as aiChatPost } from "@/app/api/ai/chat/route";

const TENANT_A = "biz_tenant_a";
const TENANT_B = "biz_tenant_b";

function jsonPost(body: unknown) {
  return new Request("https://jata.test/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string) {
  return new Request(`https://jata.test${path}`);
}

/** Every anonymous request in the AI Front Desk surface must be refused with 401. */
const anonymousReads: Array<[string, () => Promise<Response>]> = [
  ["GET /api/intelligence/demand", () => demandGet(get(`/api/intelligence/demand?businessId=${TENANT_A}`))],
  ["GET /api/intelligence/quality", () => qualityGet(get(`/api/intelligence/quality?businessId=${TENANT_A}`))],
  ["GET /api/intelligence/questions", () => questionsGet(get(`/api/intelligence/questions?businessId=${TENANT_A}`))],
  ["GET /api/notifications", () => notificationsGet(get(`/api/notifications?businessId=${TENANT_A}`))],
  ["GET /api/merchant-payment", () => merchantPaymentGet(get(`/api/merchant-payment?businessId=${TENANT_A}`))],
];

const anonymousWrites: Array<[string, () => Promise<Response>]> = [
  [
    "POST /api/intelligence/demand",
    () => demandPost(jsonPost({ businessId: TENANT_A, insightType: "PRICE_INQUIRY", subject: "Cake" })),
  ],
  [
    "POST /api/intelligence/quality",
    () => qualityPost(jsonPost({ businessId: TENANT_A, eventType: "TEST" })),
  ],
  [
    "POST /api/intelligence/questions (approve)",
    () =>
      questionsPost(
        jsonPost({ businessId: TENANT_A, action: "approve", questionId: "q_1", approvedAnswer: "Yes, always." }),
      ),
  ],
  [
    "POST /api/notifications",
    () => notificationsPost(jsonPost({ businessId: TENANT_A, eventType: "NEW_ORDER", title: "t", message: "m" })),
  ],
  [
    "POST /api/notifications (retry)",
    () => notificationsPost(jsonPost({ businessId: TENANT_A, action: "retry", notificationId: "n_1" })),
  ],
  [
    "POST /api/preorders",
    () => preordersPost(jsonPost({ businessId: TENANT_A, productName: "Cake", quantity: 1, fullPriceKES: 2500 })),
  ],
];

describe("AI Front Desk route authorization matrix (§5, §54)", () => {
  beforeEach(() => {
    state.currentUser = null;
    state.businesses.clear();
    state.entitlement = null;
    state.subscription = null;
    state.paidPayment = null;
    state.plan = null;
    state.notificationRecipients = [];
    state.businesses.set(TENANT_A, {
      id: TENANT_A,
      slug: "tenant-a-shop",
      name: "Tenant A Shop",
      ownerId: "user_tenant_a",
      category: "Retail Shop",
      isPublished: true,
      status: "PUBLISHED",
    });
    state.businesses.set(TENANT_B, {
      id: TENANT_B,
      slug: "tenant-b-shop",
      name: "Tenant B Shop",
      ownerId: "user_tenant_b",
      category: "Retail Shop",
      isPublished: true,
      status: "PUBLISHED",
    });
  });

  it("unauthenticated reads of tenant intelligence, notifications and payment config are refused (401)", async () => {
    for (const [label, call] of anonymousReads) {
      const res = await call();
      expect(res.status, `${label} must not be readable anonymously`).toBe(401);
    }
  });

  it("unauthenticated writes are refused (401) — including knowledge approval and notification delivery", async () => {
    for (const [label, call] of anonymousWrites) {
      const res = await call();
      expect(res.status, `${label} must not be writable anonymously`).toBe(401);
    }
  });

  it("an authenticated member of another tenant is refused (403)", async () => {
    state.currentUser = { id: "user_tenant_a", email: "a@jata.test", role: "OWNER" };

    const reads: Array<[string, Promise<Response>]> = [
      ["GET /api/intelligence/demand", demandGet(get(`/api/intelligence/demand?businessId=${TENANT_B}`))],
      ["GET /api/intelligence/quality", qualityGet(get(`/api/intelligence/quality?businessId=${TENANT_B}`))],
      ["GET /api/intelligence/questions", questionsGet(get(`/api/intelligence/questions?businessId=${TENANT_B}`))],
      ["GET /api/notifications", notificationsGet(get(`/api/notifications?businessId=${TENANT_B}`))],
      ["GET /api/merchant-payment", merchantPaymentGet(get(`/api/merchant-payment?businessId=${TENANT_B}`))],
    ];
    for (const [label, pending] of reads) {
      const res = await pending;
      expect(res.status, `${label} must be tenant-scoped`).toBe(403);
    }

    const writes: Array<[string, Promise<Response>]> = [
      [
        "POST /api/intelligence/questions (approve)",
        questionsPost(
          jsonPost({ businessId: TENANT_B, action: "approve", questionId: "q_1", approvedAnswer: "Free cakes." }),
        ),
      ],
      [
        "POST /api/notifications",
        notificationsPost(jsonPost({ businessId: TENANT_B, eventType: "NEW_ORDER", title: "t", message: "m" })),
      ],
      [
        "POST /api/preorders",
        preordersPost(jsonPost({ businessId: TENANT_B, productName: "Cake", quantity: 1, fullPriceKES: 2500 })),
      ],
    ];
    for (const [label, pending] of writes) {
      const res = await pending;
      expect(res.status, `${label} must be tenant-scoped`).toBe(403);
    }
  });

  it("the owning tenant is permitted on the same endpoints", async () => {
    state.currentUser = { id: "user_tenant_a", email: "a@jata.test", role: "OWNER" };

    const demand = await demandGet(get(`/api/intelligence/demand?businessId=${TENANT_A}`));
    expect(demand.status).toBe(200);

    const quality = await qualityGet(get(`/api/intelligence/quality?businessId=${TENANT_A}`));
    expect(quality.status).toBe(200);

    const questions = await questionsGet(get(`/api/intelligence/questions?businessId=${TENANT_A}`));
    expect(questions.status).toBe(200);

    const merchant = await merchantPaymentGet(get(`/api/merchant-payment?businessId=${TENANT_A}`));
    expect(merchant.status).toBe(200);
  });

  it("tenant isolation never queries a Business field that the schema does not define", async () => {
    const tenantSource = require("fs").readFileSync("lib/tenant.ts", "utf8");
    // `Business` is owned through `ownerId`; a `userId` filter makes Prisma throw for every
    // tenant check (observed as `Invalid .findFirst() invocation` in the CI database journey).
    expect(tenantSource).not.toMatch(/where:\s*\{\s*id:\s*businessId\s*,\s*userId\s*\}/);
  });
});

describe("Live AI Front Desk requires a verified KES 499 entitlement (§2, §3, §49)", () => {
  beforeEach(() => {
    state.currentUser = null;
    state.businesses.clear();
    state.entitlement = null;
    state.subscription = null;
    state.paidPayment = null;
    state.plan = null;
    state.notificationRecipients = [];
    state.businesses.set(TENANT_A, {
      id: TENANT_A,
      slug: "tenant-a-shop",
      name: "Tenant A Shop",
      ownerId: "user_tenant_a",
      category: "Retail Shop",
      isPublished: true,
      status: "PUBLISHED",
    });
  });

  const customerChat = (businessId: string) =>
    aiChatPost(jsonPost({ businessId, message: "How much is a cake?", channel: "web_chat" }));

  it("a published business with no AI entitlement is not served live AI", async () => {
    const res = await customerChat(TENANT_A);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.error).toContain("unavailable");
  });

  it("a pending (unpaid) entitlement is not served live AI", async () => {
    state.entitlement = {
      businessId: TENANT_A,
      packageKey: "AI_BUSINESS_FRONT_DESK",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
    const res = await customerChat(TENANT_A);
    const body = await res.json();
    expect(body.source).toBe("fallback");
  });

  it("an expired entitlement cannot keep granting access", async () => {
    state.entitlement = {
      businessId: TENANT_A,
      packageKey: "AI_BUSINESS_FRONT_DESK",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() - 86_400_000),
    };
    state.subscription = { status: "EXPIRED", expiresAt: new Date(Date.now() - 86_400_000), planId: "plan_ai" };
    state.paidPayment = { status: "PAID", planId: "plan_ai" };
    state.plan = { id: "plan_ai", key: "AI_BUSINESS_FRONT_DESK", priceKES: 499, durationDays: 30 };

    const res = await customerChat(TENANT_A);
    const body = await res.json();
    expect(body.source).toBe("fallback");
  });

  it("a paid, entitled business is served live AI", async () => {
    state.entitlement = {
      businessId: TENANT_A,
      packageKey: "AI_BUSINESS_FRONT_DESK",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
    state.subscription = { status: "ACTIVE", expiresAt: new Date(Date.now() + 30 * 86_400_000), planId: "plan_ai" };
    state.paidPayment = { status: "PAID", planId: "plan_ai" };
    state.plan = { id: "plan_ai", key: "AI_BUSINESS_FRONT_DESK", priceKES: 499, durationDays: 30 };

    const res = await customerChat(TENANT_A);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).not.toBe("fallback");
    expect(typeof body.reply).toBe("string");
  });

  it("owner Preview Mode stays available without an entitlement", async () => {
    state.currentUser = { id: "user_tenant_a", email: "a@jata.test", role: "OWNER" };
    const res = await aiChatPost(
      jsonPost({ businessId: TENANT_A, message: "How much is a cake?", preview: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.source).not.toBe("fallback");
  });
});
