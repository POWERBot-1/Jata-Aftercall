import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  businesses: new Map<string, any>(),
  products: new Map<string, any[]>(),
  services: new Map<string, any[]>(),
  faqs: new Map<string, any[]>(),
  knowledge: new Map<string, any[]>(),
  aiConfigs: new Map<string, any>(),
  entitlements: new Map<string, any>(),
  subscriptions: new Map<string, any[]>(),
  merchantPayments: new Map<string, any>(),
  recipients: new Map<string, any[]>(),
  orders: new Map<string, any>(),
  notifications: new Map<string, any>(),
  auditEvents: [] as any[],
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: vi.fn(async ({ where }: any) => state.businesses.get(where.id) || null),
      update: vi.fn(async ({ where, data }: any) => {
        const b = state.businesses.get(where.id);
        const next = { ...b, ...data };
        state.businesses.set(where.id, next);
        return next;
      }),
    },
    product: {
      findMany: vi.fn(async ({ where }: any) => state.products.get(where.businessId) || []),
      findFirst: vi.fn(async ({ where }: any) => {
        const list = state.products.get(where.businessId) || [];
        return list.find((p) => p.id === where.id) || null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const list = state.products.get(where.businessId) || [];
        const target = list.find((p) => p.id === where.id);
        if (!target || typeof target.quantity !== "number" || target.quantity < (where.quantity?.gte ?? 1)) {
          return { count: 0 };
        }
        target.quantity = data.quantity;
        target.stockStatus = data.stockStatus;
        return { count: 1 };
      }),
    },
    productVariant: { findMany: vi.fn(async () => []) },
    service: {
      findMany: vi.fn(async ({ where }: any) => state.services.get(where.businessId) || []),
    },
    fAQ: {
      findMany: vi.fn(async ({ where }: any) => state.faqs.get(where.businessId) || []),
      findFirst: vi.fn(async ({ where }: any) => {
        const list = state.faqs.get(where.businessId) || [];
        return list.find((f) => f.question === where.question) || null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const list = state.faqs.get(data.businessId) || [];
        const created = { id: `faq_${list.length + 1}`, ...data };
        list.push(created);
        state.faqs.set(data.businessId, list);
        return created;
      }),
    },
    knowledgeDocument: {
      findMany: vi.fn(async ({ where }: any) => state.knowledge.get(where.businessId) || []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "kd_1", ...data })),
      update: vi.fn(async ({ data }: any) => ({ id: "kd_1", ...data })),
    },
    aIConfiguration: {
      findUnique: vi.fn(async ({ where }: any) => state.aiConfigs.get(where.businessId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = state.aiConfigs.get(where.businessId);
        const next = existing ? { ...existing, ...update } : { id: "aic_1", ...create };
        state.aiConfigs.set(where.businessId, next);
        return next;
      }),
    },
    aIPackageEntitlement: {
      findUnique: vi.fn(async ({ where }: any) => state.entitlements.get(where.businessId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = state.entitlements.get(where.businessId);
        const next = existing ? { ...existing, ...update } : { id: "ent_1", ...create };
        state.entitlements.set(where.businessId, next);
        return next;
      }),
    },
    subscription: {
      findMany: vi.fn(async ({ where }: any) => state.subscriptions.get(where.businessId) || []),
    },
    merchantPaymentConfig: {
      findUnique: vi.fn(async ({ where }: any) => state.merchantPayments.get(where.businessId) || null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = state.merchantPayments.get(where.businessId);
        const next = existing ? { ...existing, ...update } : { id: "mp_1", ...create };
        state.merchantPayments.set(where.businessId, next);
        return next;
      }),
    },
    notificationRecipient: {
      findMany: vi.fn(async ({ where }: any) => state.recipients.get(where.businessId) || []),
      findFirst: vi.fn(async ({ where }: any) => (state.recipients.get(where.businessId) || [])[0] || null),
    },
    order: {
      findUnique: vi.fn(async ({ where }: any) => state.orders.get(where.orderReference || where.id) || null),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `ord_${state.orders.size + 1}`, ...data, items: data.items?.create || [] };
        state.orders.set(data.orderReference, created);
        return created;
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `notif_${state.notifications.size + 1}`, ...data };
        state.notifications.set(created.id, created);
        return created;
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: any) => {
        state.auditEvents.push(data);
        return { id: `aud_${state.auditEvents.length}`, ...data };
      }),
    },
    unansweredQuestion: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "uq_1", ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    demandInsight: {
      findMany: vi.fn(async () => []),
    },
    aIQualityEvent: {
      create: vi.fn(async ({ data }: any) => ({ id: "aiq_1", ...data })),
    },
  },
}));

import { evaluateAIReadiness, publishAIBusinessFrontDesk } from "@/lib/ai-readiness";
import { assertAIFrontDeskPlanPricing, deriveAIEntitlement } from "@/lib/ai-entitlement";
import { createAuthoritativeOrder, resetOrderIdempotencyForTests } from "@/lib/order";
import { reserveInventoryForOrder } from "@/lib/inventory";
import { approveAnswer, recordUnansweredQuestion, resetIntelligenceForTests } from "@/lib/intelligence";
import { handleAIFrontDeskTurn } from "@/lib/ai-front-desk";
import { resetExtendedAIConfigForTests, saveExtendedAIConfig } from "@/lib/ai-config";
import { generateAILinkQRCodeSvg, getShareableAILink } from "@/lib/qr";
import { redactAuditMetadata, logAudit } from "@/lib/audit";
import { canBusinessRolePerform } from "@/lib/tenant";

describe("AI Business Front Desk Lifecycle Integration Suite (§3, §4, §16–§22, §28–§35, §44–§48, §53)", () => {
  const bizId = "biz_lifecycle_1";

  beforeEach(async () => {
    state.businesses.clear();
    state.products.clear();
    state.services.clear();
    state.faqs.clear();
    state.knowledge.clear();
    state.aiConfigs.clear();
    state.entitlements.clear();
    state.subscriptions.clear();
    state.merchantPayments.clear();
    state.recipients.clear();
    state.orders.clear();
    state.notifications.clear();
    state.auditEvents.length = 0;
    resetOrderIdempotencyForTests();
    resetExtendedAIConfigForTests();
    resetIntelligenceForTests();

    state.businesses.set(bizId, {
      id: bizId,
      slug: "savanna-bakery",
      name: "Savanna Bakery",
      category: "Bakery / Cake Business",
      description: "Artisanal cakes and pastries in Nairobi.",
      location: "Kilimani, Nairobi",
      phone: "+254700112233",
      whatsapp: "+254700112233",
      openingHours: "Daily 07:00 - 20:00",
      isPublished: false,
      status: "DRAFT",
    });
  });

  it("enforces AI_BUSINESS_FRONT_DESK subscription pricing invariant (KES 499 / 30 days) and lifecycle states", () => {
    const check = assertAIFrontDeskPlanPricing({
      key: "AI_BUSINESS_FRONT_DESK",
      priceKes: 499,
      durationDays: 30,
      isActive: true,
    });
    expect(check.ok).toBe(true);

    const active = deriveAIEntitlement({
      entitlement: {
        packageName: "AI_BUSINESS_FRONT_DESK",
        priceKES: 499,
        currency: "KES",
        billingCycleDays: 30,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    expect(active.entitled).toBe(true);
    expect(active.status).toBe("ACTIVE");

    const expired = deriveAIEntitlement({
      entitlement: {
        packageName: "AI_BUSINESS_FRONT_DESK",
        priceKES: 499,
        currency: "KES",
        billingCycleDays: 30,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() - 10 * 86400_000),
      },
    });
    expect(expired.entitled).toBe(false);
    expect(expired.status).toBe("EXPIRED");
  });

  it("enforces AI Readiness Gate and Atomic Publishing (§30, §31): blocks incomplete or unpaid businesses, publishes when ready and subscribed", async () => {
    // 1. Incomplete configuration -> readiness fails
    const initialReadiness = await evaluateAIReadiness(bizId);
    expect(initialReadiness.ready).toBe(false);
    expect(initialReadiness.canPublish).toBe(false);

    const blockedByReadiness = await publishAIBusinessFrontDesk({ businessId: bizId, actorId: "user_owner" });
    expect(blockedByReadiness.ok).toBe(false);
    expect((blockedByReadiness as { code?: string }).code).toBe("READINESS_FAILED");

    // 2. Complete all 6 readiness criteria, but no active subscription yet
    state.products.set(bizId, [
      {
        id: "prod_cake",
        businessId: bizId,
        name: "Black Forest Cake 1kg",
        basePriceKES: 2500,
        stockStatus: "IN_STOCK",
        quantity: 2,
        isActive: true,
      },
    ]);
    state.merchantPayments.set(bizId, {
      id: "mp_1",
      businessId: bizId,
      publicInfo: "M-Pesa Paybill: 247247 Account: SAVANNA",
      isActive: true,
    });
    state.recipients.set(bizId, [
      { id: "nr_1", businessId: bizId, label: "PRIMARY", phone: "+254700112233", isActive: true },
    ]);
    await saveExtendedAIConfig(bizId, {
      orderingAllowed: true,
      escalationRules: "Escalate custom wedding cakes and refunds to the head baker.",
      delivery: {
        pickupEnabled: true,
        deliveryEnabled: true,
        zones: [{ name: "Kilimani", feeKES: 200 }],
        freeDeliveryThresholdKES: 5000,
        deliveryInstructions: null,
      },
    });

    const readyButUnpaid = await publishAIBusinessFrontDesk({ businessId: bizId, actorId: "user_owner" });
    expect(readyButUnpaid.ok).toBe(false);
    expect((readyButUnpaid as { code?: string }).code).toBe("SUBSCRIPTION_REQUIRED");
    expect(readyButUnpaid.readiness.ready).toBe(true);

    // 3. Activate server-verified AI_BUSINESS_FRONT_DESK subscription -> atomic publish succeeds
    state.entitlements.set(bizId, {
      businessId: bizId,
      packageName: "AI_BUSINESS_FRONT_DESK",
      priceKES: 499,
      currency: "KES",
      billingCycleDays: 30,
      status: "ACTIVE",
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    });

    const published = await publishAIBusinessFrontDesk({ businessId: bizId, actorId: "user_owner" });
    expect(published.ok).toBe(true);
    if (published.ok) {
      expect(published.sharePath).toBe("/b/savanna-bakery/ai");
      expect(published.publishedVersion).toBeGreaterThanOrEqual(1);
    }
    expect(state.businesses.get(bizId).isPublished).toBe(true);
  });

  it("enforces Preview Mode isolation (§28), Order Idempotency (§17), and Scarce Stock Concurrency (§18)", async () => {
    state.products.set(bizId, [
      {
        id: "prod_scarce",
        businessId: bizId,
        name: "Limited Truffle Box",
        basePriceKES: 1800,
        stockStatus: "LOW_STOCK",
        quantity: 1, // Only 1 in stock!
        isActive: true,
      },
    ]);

    // 1. Preview order does not persist to DB, does not decrement stock, and does not send live notifications
    const previewOrder = await createAuthoritativeOrder({
      businessId: bizId,
      customerName: "Owner Preview",
      customerPhone: "0711000000",
      items: [{ productId: "prod_scarce", quantity: 1 }],
      preview: true,
    });
    expect(previewOrder.preview).toBe(true);
    expect(previewOrder.status).toBe("DRAFT");
    expect(state.orders.size).toBe(0);
    expect(state.notifications.size).toBe(0);
    expect(state.products.get(bizId)![0].quantity).toBe(1);

    // 2. Live order with idempotencyKey reserves the 1 remaining item; duplicate submission with same key is idempotent
    const liveOrder1 = await createAuthoritativeOrder({
      businessId: bizId,
      customerName: "Wanjiku",
      customerPhone: "0722111222",
      items: [{ productId: "prod_scarce", quantity: 1 }],
      idempotencyKey: "idem_order_truffle_1",
      confirmedByCustomer: true,
    });
    expect(liveOrder1.preview).toBe(false);
    expect(liveOrder1.idempotent).toBe(false);
    expect(liveOrder1.totalKES).toBe(1800);
    expect(state.orders.size).toBe(1);
    expect(state.products.get(bizId)![0].quantity).toBe(0);

    const duplicateOrder1 = await createAuthoritativeOrder({
      businessId: bizId,
      customerName: "Wanjiku",
      customerPhone: "0722111222",
      items: [{ productId: "prod_scarce", quantity: 1 }],
      idempotencyKey: "idem_order_truffle_1",
      confirmedByCustomer: true,
    });
    expect(duplicateOrder1.idempotent).toBe(true);
    expect(duplicateOrder1.orderReference).toBe(liveOrder1.orderReference);
    expect(state.orders.size).toBe(1); // No duplicate order created

    // 3. Second customer attempting to reserve the now-exhausted scarce product is prevented from overselling
    const secondAttempt = await reserveInventoryForOrder({
      businessId: bizId,
      items: [{ productId: "prod_scarce", quantity: 1 }],
      idempotencyKey: "idem_order_truffle_2",
    });
    expect(secondAttempt.ok).toBe(false);
  });

  it("promotes owner-approved unanswered questions directly into authoritative Business Brain knowledge (§35)", async () => {
    const uq = await recordUnansweredQuestion(bizId, "Do you bake eggless cakes?");
    await approveAnswer(
      bizId,
      uq.id,
      "Yes! All our cakes can be baked 100% eggless on request at no extra cost.",
    );

    const turn = await handleAIFrontDeskTurn({
      businessId: bizId,
      message: "Do you bake eggless cakes?",
    });
    expect(turn.responseType).toBe("KNOWN");
    expect(turn.source).toBe("faq");
    expect(turn.reply).toContain("100% eggless");
  });

  it("generates shareable AI link + QR code (§44), enforces role matrix (§46), and redacts secrets from audit logs (§47)", async () => {
    const link = getShareableAILink("savanna-bakery", "https://jata.co.ke");
    expect(link.path).toBe("/b/savanna-bakery/ai");
    expect(link.url).toBe("https://jata.co.ke/b/savanna-bakery/ai");
    const svg = generateAILinkQRCodeSvg(link.url);
    expect(svg).toContain("<svg");
    expect(svg).toContain("QR Code for https://jata.co.ke/b/savanna-bakery/ai");

    // Role matrix (§46)
    expect(canBusinessRolePerform("OWNER", "publish")).toBe(true);
    expect(canBusinessRolePerform("STAFF", "publish")).toBe(false);
    expect(canBusinessRolePerform("STAFF", "manage_orders")).toBe(true);
    expect(canBusinessRolePerform("VIEWER", "manage_orders")).toBe(false);
    expect(canBusinessRolePerform("VIEWER", "read")).toBe(true);

    // Audit secret redaction (§10, §47)
    const redacted = redactAuditMetadata({
      businessId: bizId,
      publicInfo: "Till 123456",
      paystackSecret: "sk_live_super_secret",
      encryptedCredentials: "v1:cipher:data",
    }) as Record<string, unknown>;
    expect(redacted.publicInfo).toBe("Till 123456");
    expect(redacted.paystackSecret).toBe("[REDACTED]");
    expect(redacted.encryptedCredentials).toBe("[REDACTED]");

    await logAudit({
      actorId: "user_owner",
      action: "MERCHANT_PAYMENT_CONFIG_UPDATED",
      targetType: "MERCHANT_PAYMENT_CONFIG",
      targetId: "mp_1",
      metadata: { businessId: bizId, apiSecret: "secret_value_123" },
    });
    expect(JSON.stringify(state.auditEvents)).not.toContain("secret_value_123");
    expect(JSON.stringify(state.auditEvents)).toContain("[REDACTED]");
  });
});
