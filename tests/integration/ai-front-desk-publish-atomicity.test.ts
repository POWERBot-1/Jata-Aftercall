/**
 * AI Front Desk publishing is atomic (§31).
 *
 * A publish that cannot complete must fail closed: no LIVE configuration on an unpublished
 * business, and no business flagged published while its configuration snapshot was never
 * promoted. The PR under review published the draft configuration first and then swallowed any
 * failure of the business update, which could leave exactly that half-live state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  state: {
    businesses: new Map<string, any>(),
    knowledgeWrites: 0,
    failBusinessUpdate: false,
    failKnowledgeWrite: false,
    entitlement: null as null | Record<string, unknown>,
    subscription: null as null | Record<string, unknown>,
    paidPayment: null as null | Record<string, unknown>,
    plan: null as null | Record<string, unknown>,
  },
  dbMock: {} as Record<string, any>,
}));

const state = hoisted.state;

Object.assign(hoisted.dbMock, {
  business: {
    findUnique: vi.fn(async ({ where }: any) => hoisted.state.businesses.get(where?.id) || null),
    findFirst: vi.fn(async ({ where }: any) => hoisted.state.businesses.get(where?.id) || null),
    update: vi.fn(async ({ where, data }: any) => {
      if (hoisted.state.failBusinessUpdate) throw new Error("BUSINESS_UPDATE_FAILED");
      const current = hoisted.state.businesses.get(where.id) || {};
      const next = { ...current, ...data };
      hoisted.state.businesses.set(where.id, next);
      return next;
    }),
  },
  product: { findMany: vi.fn(async () => [{ id: "p_1", name: "Cake", basePriceKES: 2500, stockStatus: "IN_STOCK", isActive: true }]) },
  productVariant: { findMany: vi.fn(async () => []) },
  service: { findMany: vi.fn(async () => []) },
  fAQ: { findMany: vi.fn(async () => [{ id: "f_1", question: "Do you deliver?", approvedAnswer: "Yes." }]) },
  knowledgeDocument: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      hoisted.state.knowledgeWrites += 1;
      if (hoisted.state.failKnowledgeWrite) throw new Error("KNOWLEDGE_WRITE_FAILED");
      return { id: "kd_1", ...data };
    }),
    update: vi.fn(async () => {
      hoisted.state.knowledgeWrites += 1;
      if (hoisted.state.failKnowledgeWrite) throw new Error("KNOWLEDGE_WRITE_FAILED");
      return { id: "kd_1" };
    }),
  },
  aIConfiguration: {
    findUnique: vi.fn(async () => ({
      escalationRules: "Escalate complaints, refunds, and anything not in the Business Brain to the owner.",
      orderingAllowed: true,
      fallbackMessage: "I don't have that information yet. Let me connect you with the business.",
    })),
  },
  offer: { findUnique: vi.fn(async () => null) },
  merchantPaymentConfig: {
    findUnique: vi.fn(async () => ({ id: "mp_1", publicInfo: "Paybill 247247 Acc SHOP", isActive: true })),
  },
  unansweredQuestion: { findMany: vi.fn(async () => []) },
  notificationRecipient: {
    findMany: vi.fn(async () => [{ id: "nr_1", label: "PRIMARY", phone: "+254700112233", isActive: true }]),
  },
  aIPackageEntitlement: { findUnique: vi.fn(async () => hoisted.state.entitlement) },
  subscription: { findUnique: vi.fn(async () => hoisted.state.subscription) },
  payment: { findFirst: vi.fn(async () => hoisted.state.paidPayment) },
  planConfig: { findUnique: vi.fn(async () => hoisted.state.plan) },
  auditEvent: { create: vi.fn(async () => ({ id: "audit_1" })) },
});

vi.mock("@/lib/db", () => ({ default: hoisted.dbMock }));

import { publishAIBusinessFrontDesk } from "@/lib/ai-readiness";
import { getExtendedAIConfig, resetExtendedAIConfigForTests } from "@/lib/ai-config";

const BUSINESS = "biz_publish";

describe("AI Front Desk publish atomicity (§31)", () => {
  beforeEach(async () => {
    hoisted.state.businesses.clear();
    hoisted.state.knowledgeWrites = 0;
    hoisted.state.failBusinessUpdate = false;
    hoisted.state.failKnowledgeWrite = false;
    hoisted.state.entitlement = {
      businessId: BUSINESS,
      packageKey: "AI_BUSINESS_FRONT_DESK",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
    hoisted.state.subscription = {
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      planId: "plan_ai",
    };
    hoisted.state.paidPayment = { status: "PAID", planId: "plan_ai" };
    hoisted.state.plan = { id: "plan_ai", key: "AI_BUSINESS_FRONT_DESK", priceKES: 499, durationDays: 30 };
    hoisted.state.businesses.set(BUSINESS, {
      id: BUSINESS,
      slug: "publish-shop",
      name: "Publish Shop",
      category: "Bakery",
      phone: "0700000000",
      whatsapp: "0700000000",
      openingHours: "Mon-Sat 08:00 - 18:00",
      isPublished: false,
      status: "DRAFT",
    });
    resetExtendedAIConfigForTests();
    await getExtendedAIConfig(BUSINESS, null, "Bakery");
  });

  it("publishes a ready, entitled business", async () => {
    const result = await publishAIBusinessFrontDesk({ businessId: BUSINESS, actorId: "user_owner" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sharePath).toBe("/b/publish-shop/ai");
    expect(hoisted.state.businesses.get(BUSINESS).isPublished).toBe(true);
  });

  it("never promotes the configuration when the business cannot be marked published", async () => {
    hoisted.state.failBusinessUpdate = true;
    const result = await publishAIBusinessFrontDesk({ businessId: BUSINESS, actorId: "user_owner" });
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe("PUBLISH_FAILED");
    expect(hoisted.state.businesses.get(BUSINESS).isPublished).toBe(false);
    // The draft configuration was not promoted, so nothing is half-live.
    expect(hoisted.state.knowledgeWrites).toBe(0);
  });

  it("rolls the business back when the configuration snapshot cannot be published", async () => {
    hoisted.state.failKnowledgeWrite = true;
    const result = await publishAIBusinessFrontDesk({ businessId: BUSINESS, actorId: "user_owner" });
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe("PUBLISH_FAILED");
    // Compensating rollback: the business is not left flagged as published.
    expect(hoisted.state.businesses.get(BUSINESS).isPublished).toBe(false);
    expect(hoisted.state.businesses.get(BUSINESS).status).toBe("DRAFT");
  });

  it("refuses to publish a ready but unpaid business", async () => {
    hoisted.state.entitlement = null;
    hoisted.state.subscription = null;
    hoisted.state.paidPayment = null;
    const result = await publishAIBusinessFrontDesk({ businessId: BUSINESS, actorId: "user_owner" });
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe("SUBSCRIPTION_REQUIRED");
    expect(hoisted.state.businesses.get(BUSINESS).isPublished).toBe(false);
  });
});
