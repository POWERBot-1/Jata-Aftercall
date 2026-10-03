import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  currentUser: null as null | { id: string; email: string; role: string },
  businesses: new Map<string, { id: string; userId: string; slug: string; name: string; category: string; isPublished: boolean }>(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => authState.currentUser),
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findFirst: vi.fn(async ({ where }: any) => {
        const biz = authState.businesses.get(where.id);
        if (biz && biz.userId === where.userId) return { id: biz.id };
        return null;
      }),
      findUnique: vi.fn(async ({ where }: any) => authState.businesses.get(where.id) || null),
    },
    product: { findMany: vi.fn(async () => []) },
    productVariant: { findMany: vi.fn(async () => []) },
    service: { findMany: vi.fn(async () => []) },
    fAQ: { findMany: vi.fn(async () => []) },
    knowledgeDocument: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    aIConfiguration: {
      findUnique: vi.fn(async ({ where }: any) => ({
        id: `aic_${where.businessId}`,
        businessId: where.businessId,
        toneOfVoice: "Friendly",
        orderingAllowed: true,
      })),
      upsert: vi.fn(async ({ create }: any) => ({ id: "aic_1", ...create })),
    },
    aIPackageEntitlement: {
      findUnique: vi.fn(async () => null),
    },
    subscription: { findMany: vi.fn(async () => []) },
    planConfig: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.key === "AI_BUSINESS_FRONT_DESK"
          ? { key: "AI_BUSINESS_FRONT_DESK", label: "AI Business Front Desk", priceKes: 499, durationDays: 30, isActive: true }
          : null,
      ),
    },
    merchantPaymentConfig: {
      findUnique: vi.fn(async () => ({ id: "mp_1", publicInfo: "Till 998877", isActive: true })),
      upsert: vi.fn(async ({ create }: any) => ({ id: "mp_1", publicInfo: create.publicInfo, isActive: true })),
    },
    notificationRecipient: { findMany: vi.fn(async () => []) },
    unansweredQuestion: { findMany: vi.fn(async () => []) },
    demandInsight: { findMany: vi.fn(async () => []) },
    aIQualityEvent: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
    order: { findMany: vi.fn(async () => []) },
    preOrder: { findMany: vi.fn(async () => []) },
    notification: { findMany: vi.fn(async () => []) },
    auditEvent: { create: vi.fn(async () => ({})) },
  },
}));

import { GET as getAIConfig, POST as postAIConfig } from "@/app/api/ai/config/route";
import { GET as getAIReadiness } from "@/app/api/ai/readiness/route";
import { GET as getAIEntitlement } from "@/app/api/ai/entitlement/route";
import { GET as getAIDashboard } from "@/app/api/ai/dashboard/route";
import { POST as postAIChat } from "@/app/api/ai/chat/route";
import { POST as postMerchantPayment } from "@/app/api/merchant-payment/route";

describe("AI Business Front Desk Authorization & Tenant Isolation (§5, §10, §54)", () => {
  const tenantABiz = "biz_tenant_a";
  const tenantBBiz = "biz_tenant_b";

  beforeEach(() => {
    authState.currentUser = null;
    authState.businesses.clear();
    authState.businesses.set(tenantABiz, {
      id: tenantABiz,
      userId: "user_tenant_a",
      slug: "tenant-a-shop",
      name: "Tenant A Shop",
      category: "Retail Shop",
      isPublished: true,
    });
    authState.businesses.set(tenantBBiz, {
      id: tenantBBiz,
      userId: "user_tenant_b",
      slug: "tenant-b-shop",
      name: "Tenant B Shop",
      category: "Retail Shop",
      isPublished: true,
    });
  });

  it("Unauthenticated = denied (401) across protected AI Front Desk endpoints", async () => {
    authState.currentUser = null;

    const cfgRes = await getAIConfig(new Request(`https://jata.test/api/ai/config?businessId=${tenantABiz}`));
    expect(cfgRes.status).toBe(401);

    const readyRes = await getAIReadiness(new Request(`https://jata.test/api/ai/readiness?businessId=${tenantABiz}`));
    expect(readyRes.status).toBe(401);

    const entRes = await getAIEntitlement(new Request(`https://jata.test/api/ai/entitlement?businessId=${tenantABiz}`));
    expect(entRes.status).toBe(401);

    const dashRes = await getAIDashboard(new Request(`https://jata.test/api/ai/dashboard?businessId=${tenantABiz}`));
    expect(dashRes.status).toBe(401);

    const previewChatRes = await postAIChat(
      new Request("https://jata.test/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: tenantABiz, message: "Hello", preview: true }),
      }),
    );
    expect(previewChatRes.status).toBe(401);
  });

  it("Tenant A -> Tenant B = denied (403) across AI config, readiness, entitlement, dashboard, chat, and merchant payment", async () => {
    authState.currentUser = { id: "user_tenant_a", email: "a@jata.test", role: "OWNER" };

    const cfgRes = await getAIConfig(new Request(`https://jata.test/api/ai/config?businessId=${tenantBBiz}`));
    expect(cfgRes.status).toBe(403);

    const postCfgRes = await postAIConfig(
      new Request("https://jata.test/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: tenantBBiz, toneOfVoice: "Formal" }),
      }),
    );
    expect(postCfgRes.status).toBe(403);

    const readyRes = await getAIReadiness(new Request(`https://jata.test/api/ai/readiness?businessId=${tenantBBiz}`));
    expect(readyRes.status).toBe(403);

    const entRes = await getAIEntitlement(new Request(`https://jata.test/api/ai/entitlement?businessId=${tenantBBiz}`));
    expect(entRes.status).toBe(403);

    const dashRes = await getAIDashboard(new Request(`https://jata.test/api/ai/dashboard?businessId=${tenantBBiz}`));
    expect(dashRes.status).toBe(403);

    const chatCrossTenant = await postAIChat(
      new Request("https://jata.test/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: tenantBBiz, message: "Show me products", preview: true }),
      }),
    );
    expect(chatCrossTenant.status).toBe(403);

    const payCrossTenant = await postMerchantPayment(
      new Request("https://jata.test/api/merchant-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: tenantBBiz, publicInfo: "Till 111111" }),
      }),
    );
    expect(payCrossTenant.status).toBe(403);
  });

  it("Tenant A -> Tenant A = allowed (200) and never leaks encrypted merchant payment credentials", async () => {
    authState.currentUser = { id: "user_tenant_a", email: "a@jata.test", role: "OWNER" };

    const cfgRes = await getAIConfig(new Request(`https://jata.test/api/ai/config?businessId=${tenantABiz}`));
    expect(cfgRes.status).toBe(200);

    const entRes = await getAIEntitlement(new Request(`https://jata.test/api/ai/entitlement?businessId=${tenantABiz}`));
    expect(entRes.status).toBe(200);
    const entJson = await entRes.json();
    expect(entJson.plan?.priceKes).toBe(499);
    expect(entJson.plan?.durationDays).toBe(30);

    const payRes = await postMerchantPayment(
      new Request("https://jata.test/api/merchant-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: tenantABiz,
          publicInfo: "M-Pesa Paybill 247247 Acc TENANTA",
          privateCredentials: { consumerSecret: "top_secret_mpesa_key" },
        }),
      }),
    );
    expect(payRes.status).toBe(200);
    const payBodyText = JSON.stringify(await payRes.json());
    expect(payBodyText).not.toContain("top_secret_mpesa_key");
    expect(payBodyText).not.toContain("encryptedCredentials");
  });
});
