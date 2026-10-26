/**
 * AI Front Desk publication enforcement (P0 remediation).
 *
 * The defect under repair: the Front Desk could appear LIVE — and could be switched into live
 * operation — without a server-verified paid subscription. Three separate causes are pinned here:
 *
 *   1. `getExtendedAIConfig()` defaulted `operationalStatus` to `"LIVE"`, so a business that had
 *      never configured anything read back as live simply because no status row existed.
 *   2. `POST /api/ai/status` and `POST /api/ai/config` accepted `operationalStatus: "LIVE"` from
 *      the owner without checking the subscription, so a direct API call activated the desk.
 *   3. `POST /api/ai/chat` only checked the entitlement for anonymous callers, so any signed-in
 *      session (the owner, or a logged-in customer) reached live AI without a paid plan.
 *
 * These tests exercise the real routes and the real entitlement/config/publication modules against
 * an in-memory database. Only the brain fixture and the audit sink are doubled.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const state = {
    user: null as null | { id: string; email: string; role: string },
    businesses: new Map<string, any>(),
    entitlements: new Map<string, any>(),
    subscriptions: new Map<string, any>(),
    payments: [] as any[],
    plans: [] as any[],
    aiConfigs: new Map<string, any>(),
    knowledgeDocs: [] as any[],
    audit: [] as any[],
  };
  return { state };
});

const state = hoisted.state;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => state.user),
  getSession: vi.fn(async () =>
    state.user ? { userId: state.user.id, email: state.user.email, role: state.user.role } : null,
  ),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (event: any) => {
    state.audit.push(event);
    return { id: `audit_${state.audit.length}` };
  }),
}));

/**
 * A complete readiness fixture: this business is *ready* to publish, which is what makes the
 * subscription gate the only remaining reason publication can fail.
 */
function brainFixture(businessId: string) {
  const business = state.businesses.get(businessId);
  return {
    business,
    products: [
      {
        id: "prod_cake",
        businessId,
        name: "Black Forest Cake",
        description: "1kg celebration cake",
        category: "Cakes",
        basePriceKES: 2500,
        currency: "KES",
        stockStatus: "IN_STOCK",
        quantity: 5,
        isActive: true,
        preOrderAllowed: false,
        deliveryEligible: true,
      },
    ],
    services: [],
    faqs: [],
    knowledge: [],
    notificationRecipients: [{ id: "rec_1", label: "PRIMARY", phone: "0712345678", isActive: true }],
    aiConfig: { tone: "friendly", language: "English + Swahili", orderingAllowed: false },
    extendedConfig: {
      operationalStatus: state.aiConfigs.get(businessId)?.operationalStatus || "DRAFT",
      orderingAllowed: false,
      pauseAllOrdering: false,
      greetingMessage: "Karibu! Ask me anything about our cakes.",
      fallbackMessage: "I don't have that information yet. Let me connect you with the business.",
      escalationRules: "Complaints, refunds and custom orders go to the owner on WhatsApp.",
      afterHoursMessage: null,
      bookingsAllowed: false,
      preordersAllowed: false,
      toneOfVoice: "Friendly",
      languageBehavior: "English + Swahili",
      draftVersion: 1,
      publishedVersion: 0,
    },
    delivery: { deliveryEnabled: false, mode: "PICKUP", zones: [] },
    paymentMethods: { isConfigured: true, publicInfo: "M-Pesa Till 123456" },
    policies: {},
    conflicts: [],
    knowledgeVersion: 1,
  };
}

vi.mock("@/lib/ai-business-brain", () => ({
  getBusinessBrain: vi.fn(async (businessId: string) => brainFixture(businessId)),
}));

vi.mock("@/lib/db", () => {
  const client: any = {
    business: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id) return state.businesses.get(where.id) || null;
        if (where?.slug) {
          for (const b of state.businesses.values()) if (b.slug === where.slug) return b;
        }
        return null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const b of state.businesses.values()) {
          if (where?.id && b.id !== where.id) continue;
          if (where?.ownerId && b.ownerId !== where.ownerId) continue;
          if (where?.slug && b.slug !== where.slug) continue;
          return b;
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const before = state.businesses.get(where.id) || {};
        const next = { ...before, ...data };
        state.businesses.set(where.id, next);
        return next;
      }),
    },
    businessMember: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    planConfig: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id) return state.plans.find((plan) => plan.id === where.id) || null;
        if (where?.key) return state.plans.find((plan) => plan.key === where.key) || null;
        return null;
      }),
    },
    aIPackageEntitlement: {
      findUnique: vi.fn(async ({ where }: any) => state.entitlements.get(where.businessId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = state.entitlements.get(where.businessId);
        const next = existing ? { ...existing, ...update } : { id: `ent_${state.entitlements.size + 1}`, ...create };
        state.entitlements.set(where.businessId, next);
        return next;
      }),
    },
    subscription: {
      findUnique: vi.fn(async ({ where }: any) => state.subscriptions.get(where.businessId) || null),
    },
    payment: {
      findFirst: vi.fn(async ({ where }: any) =>
        state.payments.find(
          (payment) =>
            payment.businessId === where?.businessId &&
            (!where?.status || payment.status === where.status),
        ) || null,
      ),
      findMany: vi.fn(async () => state.payments),
    },
    aIConfiguration: {
      findUnique: vi.fn(async ({ where }: any) => state.aiConfigs.get(where.businessId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = state.aiConfigs.get(where.businessId);
        const next = existing ? { ...existing, ...update } : { id: `aic_${state.aiConfigs.size + 1}`, ...create };
        state.aiConfigs.set(where.businessId, next);
        return next;
      }),
    },
    knowledgeDocument: {
      findFirst: vi.fn(async ({ where }: any) =>
        state.knowledgeDocs.find(
          (doc) => doc.businessId === where.businessId && doc.sourceType === where.sourceType,
        ) || null,
      ),
      findMany: vi.fn(async ({ where }: any) =>
        state.knowledgeDocs.filter((doc) => doc.businessId === where?.businessId),
      ),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `kd_${state.knowledgeDocs.length + 1}`, ...data };
        state.knowledgeDocs.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const doc = state.knowledgeDocs.find((entry) => entry.id === where.id);
        Object.assign(doc, data);
        return doc;
      }),
    },
    auditEvent: { create: vi.fn(async ({ data }: any) => ({ id: "audit", ...data })) },
  };
  return { default: client };
});

import { POST as publishPost } from "@/app/api/ai/publish/route";
import { GET as statusGet, POST as statusPost } from "@/app/api/ai/status/route";
import { GET as configGet, POST as configPost } from "@/app/api/ai/config/route";
import { POST as chatPost } from "@/app/api/ai/chat/route";
import { authorizeAIFrontDeskOperation, deriveAIFrontDeskPublication } from "@/lib/ai-publication";
import {
  publishAIConfigSnapshot,
  resetInMemoryAIConfigForTests,
  saveExtendedAIConfig,
} from "@/lib/ai-config";

const OWNER = "user_owner_a";
const TENANT_A = "biz_a";
const TENANT_B = "biz_b";

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(`https://jata.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string) {
  return new Request(`https://jata.test${url}`);
}

function seedBusiness(id: string, overrides: Record<string, unknown> = {}) {
  state.businesses.set(id, {
    id,
    slug: id === TENANT_A ? "savanna-bakery" : "other-shop",
    name: id === TENANT_A ? "Savanna Bakery" : "Other Shop",
    ownerId: id === TENANT_A ? OWNER : "user_owner_b",
    category: "Bakery",
    description: "Fresh cakes baked daily",
    phone: "0712345678",
    whatsapp: "0712345678",
    location: "Kitengela",
    openingHours: "Mon-Sat 8am-6pm",
    isPublished: false,
    status: "PENDING",
    ...overrides,
  });
}

/** A server-verified, currently active AI Business Front Desk subscription. */
function seedActiveSubscription(businessId: string) {
  state.plans.push({
    id: "plan_ai",
    key: "AI_BUSINESS_FRONT_DESK",
    name: "AI Business Front Desk",
    priceKES: 499,
    durationDays: 30,
    isActive: true,
  });
  state.subscriptions.set(businessId, {
    id: `sub_${businessId}`,
    businessId,
    status: "ACTIVE",
    planId: "plan_ai",
    startAt: new Date(Date.now() - 86_400_000),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    graceUntil: null,
  });
  state.entitlements.set(businessId, {
    id: `ent_${businessId}`,
    businessId,
    packageKey: "AI_BUSINESS_FRONT_DESK",
    status: "ACTIVE",
    activatedAt: new Date(Date.now() - 86_400_000),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  state.payments.push({
    id: `pay_${businessId}`,
    businessId,
    status: "PAID",
    planId: "plan_ai",
    reference: `JATA-AI-${businessId}`,
  });
}

beforeEach(() => {
  state.user = { id: OWNER, email: "owner@jata.test", role: "OWNER" };
  state.businesses.clear();
  state.entitlements.clear();
  state.subscriptions.clear();
  state.payments = [];
  state.plans = [];
  state.aiConfigs.clear();
  state.knowledgeDocs = [];
  state.audit = [];
  resetInMemoryAIConfigForTests();
  seedBusiness(TENANT_A);
  seedBusiness(TENANT_B);
});

describe("an unconfigured business is never described as LIVE", () => {
  it("defaults the operational switch to DRAFT instead of LIVE", async () => {
    const config = await configGet(getRequest(`/api/ai/config?businessId=${TENANT_A}`));
    expect(config.status).toBe(200);
    const body = await config.json();
    expect(body.extendedConfig.operationalStatus).toBe("DRAFT");
    expect(body.publication.state).toBe("DRAFT");
    expect(body.publication.publiclyOperational).toBe(false);
  });

  it("reports a published-but-unpaid desk as not live, even when the stored switch says LIVE", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });
    await saveExtendedAIConfig(TENANT_A, { operationalStatus: "LIVE" });

    const res = await statusGet(getRequest(`/api/ai/status?businessId=${TENANT_A}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operationalStatus).toBe("LIVE"); // the stored switch is reported as stored…
    expect(body.publication.state).toBe("SUSPENDED"); // …but the status customers see is not LIVE
    expect(body.publication.publiclyOperational).toBe(false);
  });
});

describe("publication requires a verified paid entitlement", () => {
  it("refuses to publish for an unpaid business and leaves the record unpublished", async () => {
    const res = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(state.businesses.get(TENANT_A).isPublished).toBe(false);
    expect(state.audit.some((event) => event.action === "AI_FRONT_DESK_PUBLISHED")).toBe(false);
  });

  it("treats a PENDING payment as unpaid, not as a verified payment", async () => {
    state.plans.push({ id: "plan_ai", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk", priceKES: 499, durationDays: 30 });
    state.subscriptions.set(TENANT_A, { id: "sub_a", businessId: TENANT_A, status: "PENDING", planId: "plan_ai" });
    state.payments.push({ id: "pay_pending", businessId: TENANT_A, status: "PENDING", planId: "plan_ai" });

    const publish = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    expect(publish.status).toBe(402);

    const activate = await statusPost(jsonRequest("/api/ai/status", { businessId: TENANT_A, operationalStatus: "LIVE" }));
    expect(activate.status).toBe(402);
  });

  it("denies an expired subscriber and does not reactivate the desk", async () => {
    state.plans.push({ id: "plan_ai", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk", priceKES: 499, durationDays: 30 });
    state.subscriptions.set(TENANT_A, {
      id: "sub_a",
      businessId: TENANT_A,
      status: "EXPIRED",
      planId: "plan_ai",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    state.entitlements.set(TENANT_A, {
      id: "ent_a",
      businessId: TENANT_A,
      packageKey: "AI_BUSINESS_FRONT_DESK",
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    state.payments.push({ id: "pay_a", businessId: TENANT_A, status: "PAID", planId: "plan_ai" });
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });

    const activate = await statusPost(jsonRequest("/api/ai/status", { businessId: TENANT_A, operationalStatus: "LIVE" }));
    expect(activate.status).toBe(402);
    expect((await activate.json()).code).toBe("SUBSCRIPTION_REQUIRED");

    const publication = await authorizeAIFrontDeskOperation({ businessId: TENANT_A });
    expect(publication.allowed).toBe(false);
    expect(publication.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("fails closed when the billing records cannot be read", async () => {
    const db = (await import("@/lib/db")).default as any;
    db.aIPackageEntitlement.findUnique.mockRejectedValueOnce(new Error("billing unavailable"));
    db.subscription.findUnique.mockRejectedValueOnce(new Error("billing unavailable"));
    db.payment.findFirst.mockRejectedValueOnce(new Error("billing unavailable"));

    const res = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    expect(res.status).toBe(402);
    expect(state.businesses.get(TENANT_A).isPublished).toBe(false);

    const chat = await chatPost(jsonRequest("/api/ai/chat", { businessId: TENANT_A, message: "How much is a cake?" }));
    expect(chat.status).toBeGreaterThanOrEqual(402);
    expect((await chat.json()).blocked).toBe(true);
  });

  it("publishes for a valid active paid subscriber and then reports LIVE from the server", async () => {
    seedActiveSubscription(TENANT_A);

    const res = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sharePath).toBe("/b/savanna-bakery/ai");
    expect(state.businesses.get(TENANT_A).isPublished).toBe(true);

    const status = await statusGet(getRequest(`/api/ai/status?businessId=${TENANT_A}`));
    const statusBody = await status.json();
    expect(statusBody.publication.state).toBe("LIVE");
    expect(statusBody.publication.publiclyOperational).toBe(true);

    const authorization = await authorizeAIFrontDeskOperation({ businessId: TENANT_A });
    expect(authorization.allowed).toBe(true);
    expect(authorization.code).toBe(null);
  });

  it("keeps a legitimate paid subscriber entitled across repeated reads (no state drift)", async () => {
    seedActiveSubscription(TENANT_A);
    await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));

    const first = await (await statusGet(getRequest(`/api/ai/status?businessId=${TENANT_A}`))).json();
    const second = await (await statusGet(getRequest(`/api/ai/status?businessId=${TENANT_A}`))).json();
    expect(second.publication.state).toBe(first.publication.state);
    expect(second.publication.state).toBe("LIVE");
    expect(state.businesses.get(TENANT_A).isPublished).toBe(true);
  });
});

describe("the publish step itself never activates without an entitlement", () => {
  it("promotes the version but leaves an unpaid desk dormant", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });

    const published = await publishAIConfigSnapshot(TENANT_A, { activateLive: true });

    expect(published.operationalStatus).not.toBe("LIVE");
    const status = await (await statusGet(getRequest(`/api/ai/status?businessId=${TENANT_A}`))).json();
    expect(status.publication.state).not.toBe("LIVE");
    expect(status.publication.publiclyOperational).toBe(false);
  });

  it("activates only for a verified paid subscriber", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });
    seedActiveSubscription(TENANT_A);

    const published = await publishAIConfigSnapshot(TENANT_A, { activateLive: true });
    expect(published.operationalStatus).toBe("LIVE");
  });

  it("does not activate when the caller does not ask for activation", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });
    seedActiveSubscription(TENANT_A);

    const published = await publishAIConfigSnapshot(TENANT_A);
    expect(published.operationalStatus).not.toBe("LIVE");
  });

  it("never un-pauses a desk an owner paused, even when publishing", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });
    seedActiveSubscription(TENANT_A);
    await saveExtendedAIConfig(TENANT_A, { operationalStatus: "PAUSED" });

    const published = await publishAIConfigSnapshot(TENANT_A, { activateLive: true });
    expect(published.operationalStatus).toBe("PAUSED");
  });
});

describe("direct API activation is refused without an entitlement", () => {
  it("refuses operationalStatus=LIVE through POST /api/ai/status", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });

    const res = await statusPost(jsonRequest("/api/ai/status", { businessId: TENANT_A, operationalStatus: "LIVE" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("SUBSCRIPTION_REQUIRED");

    const stored = await (await configGet(getRequest(`/api/ai/config?businessId=${TENANT_A}`))).json();
    expect(stored.extendedConfig.operationalStatus).not.toBe("LIVE");
  });

  it("refuses operationalStatus=LIVE smuggled through POST /api/ai/config", async () => {
    const res = await configPost(
      jsonRequest("/api/ai/config", {
        businessId: TENANT_A,
        toneOfVoice: "Friendly",
        operationalStatus: "LIVE",
      }),
    );
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("SUBSCRIPTION_REQUIRED");

    const stored = await (await configGet(getRequest(`/api/ai/config?businessId=${TENANT_A}`))).json();
    expect(stored.extendedConfig.operationalStatus).not.toBe("LIVE");
  });

  it("still lets the owner switch the desk OFF without a subscription (never locked out)", async () => {
    const res = await statusPost(jsonRequest("/api/ai/status", { businessId: TENANT_A, operationalStatus: "PAUSED" }));
    expect(res.status).toBe(200);
    expect((await res.json()).operationalStatus).toBe("PAUSED");
  });

  it("requires publication before reactivating an unpaid desk", async () => {
    seedActiveSubscription(TENANT_A);
    // Entitled but never published: switching LIVE would claim a version customers cannot see.
    const res = await statusPost(jsonRequest("/api/ai/status", { businessId: TENANT_A, operationalStatus: "LIVE" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NOT_PUBLISHED");
  });
});

describe("live customer access is refused for unpaid or unpublished desks", () => {
  it("refuses an anonymous customer on a published but unpaid desk", async () => {
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });
    await saveExtendedAIConfig(TENANT_A, { operationalStatus: "LIVE" });

    const res = await chatPost(jsonRequest("/api/ai/chat", { businessId: TENANT_A, message: "How much is a cake?" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.blocked).toBe(true);
    expect(body.source).toBe("fallback");
    // The customer-facing message never exposes the tenant's billing situation.
    expect(body.error).not.toMatch(/KES|subscription|plan/i);
  });

  it("refuses a signed-in owner's non-preview turn on an unpaid desk", async () => {
    // Previously the authenticated branch skipped the entitlement check entirely.
    state.businesses.set(TENANT_A, { ...state.businesses.get(TENANT_A), isPublished: true });
    await saveExtendedAIConfig(TENANT_A, { operationalStatus: "LIVE" });

    const res = await chatPost(jsonRequest("/api/ai/chat", { businessId: TENANT_A, message: "How much is a cake?" }));
    expect(res.status).toBe(402);
    expect((await res.json()).blocked).toBe(true);
  });

  it("still allows the owner's private preview without an entitlement", async () => {
    const res = await chatPost(
      jsonRequest("/api/ai/chat", { businessId: TENANT_A, message: "How much is a cake?", preview: true }),
    );
    // Preview is allowed through the gate; whether the engine answers is a separate concern.
    expect(res.status).not.toBe(402);
  });
});

describe("tenant isolation and overrides", () => {
  it("does not let tenant A publish with tenant B's paid entitlement", async () => {
    seedActiveSubscription(TENANT_B);
    state.businesses.set(TENANT_B, { ...state.businesses.get(TENANT_B), isPublished: true });

    const res = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_B }));
    expect(res.status).toBe(403);
    expect(state.businesses.get(TENANT_B).isPublished).toBe(true);

    // Tenant A, with no entitlement of its own, is still refused for its own business.
    const own = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    expect(own.status).toBe(402);
    expect(state.businesses.get(TENANT_A).isPublished).toBe(false);
  });

  it("rejects a forged client-side LIVE claim in the publish body", async () => {
    const res = await publishPost(
      jsonRequest("/api/ai/publish", {
        businessId: TENANT_A,
        isPublished: true,
        operationalStatus: "LIVE",
        entitlement: { entitled: true, status: "ACTIVE" },
        verifiedPayment: true,
      }),
    );
    expect(res.status).toBe(402);

    const status = await (await statusGet(getRequest(`/api/ai/status?businessId=${TENANT_A}`))).json();
    expect(status.publication.state).toBe("DRAFT");
    expect(status.publication.publiclyOperational).toBe(false);
  });

  it("has no hidden administrator bypass for an unpaid business", async () => {
    state.user = { id: "user_admin", email: "admin@jata.test", role: "ADMIN" };
    const res = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    expect(res.status).toBe(402);
    expect(state.businesses.get(TENANT_A).isPublished).toBe(false);
  });

  it("rejects an owner-tier action from a role that is not allowed to publish", async () => {
    // A signed-in user who is not a member of the tenant is refused before any entitlement work.
    state.user = { id: "user_stranger", email: "stranger@jata.test", role: "CUSTOMER" };
    const res = await publishPost(jsonRequest("/api/ai/publish", { businessId: TENANT_A }));
    expect(res.status).toBe(403);
  });
});

describe("derived publication states", () => {
  const entitlement = (overrides: Record<string, unknown> = {}) => ({
    entitled: true,
    status: "ACTIVE" as const,
    reason: "Active",
    ...overrides,
  });

  it("never derives LIVE from a stored switch alone", () => {
    expect(
      deriveAIFrontDeskPublication({ isPublished: false, operationalStatus: "LIVE", entitlement: entitlement() }).state,
    ).toBe("DRAFT");
    expect(
      deriveAIFrontDeskPublication({ isPublished: true, operationalStatus: "LIVE", entitlement: entitlement({ entitled: false, status: "EXPIRED" }) }).state,
    ).toBe("SUSPENDED");
    expect(
      deriveAIFrontDeskPublication({ isPublished: true, operationalStatus: "CONFIGURED", entitlement: entitlement() }).state,
    ).toBe("DRAFT");
  });

  it("derives LIVE only when published, activated and entitled together", () => {
    const publication = deriveAIFrontDeskPublication({
      isPublished: true,
      operationalStatus: "LIVE",
      entitlement: entitlement(),
    });
    expect(publication.state).toBe("LIVE");
    expect(publication.publiclyOperational).toBe(true);
  });

  it("keeps pause and maintenance distinct from live", () => {
    const paused = deriveAIFrontDeskPublication({ isPublished: true, operationalStatus: "PAUSED", entitlement: entitlement() });
    expect(paused.state).toBe("PAUSED");
    expect(paused.publiclyOperational).toBe(false);
    const maintenance = deriveAIFrontDeskPublication({ isPublished: true, operationalStatus: "MAINTENANCE", entitlement: entitlement() });
    expect(maintenance.state).toBe("MAINTENANCE");
    expect(maintenance.publiclyOperational).toBe(false);
  });

  it("labels an owner preview as PREVIEW even when the desk is live", () => {
    const preview = deriveAIFrontDeskPublication({
      isPublished: true,
      operationalStatus: "LIVE",
      entitlement: entitlement(),
      preview: true,
    });
    expect(preview.state).toBe("PREVIEW");
    expect(preview.publiclyOperational).toBe(false);
  });

  it("treats an unknown or missing entitlement as not entitled", () => {
    expect(deriveAIFrontDeskPublication({ isPublished: true, operationalStatus: "LIVE", entitlement: null }).state).toBe(
      "SUSPENDED",
    );
    expect(deriveAIFrontDeskPublication({ isPublished: true, operationalStatus: "LIVE" }).entitlementStatus).toBe("UNKNOWN");
  });
});
