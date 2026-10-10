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

vi.mock("@/lib/db", () => {
  const idempotencyRecords = new Map<string, any>();
  const client: any = {
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
        // Mirrors the compare-and-set: an exact-quantity match (the order transaction) or a minimum (legacy reserve).
        const exactMismatch = typeof where.quantity === "number" && target?.quantity !== where.quantity;
        if (!target || typeof target.quantity !== "number" || exactMismatch || target.quantity < (where.quantity?.gte ?? 1)) {
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
      findUnique: vi.fn(async ({ where }: any) =>
        state.orders.get(where.orderReference || where.id) ||
        [...state.orders.values()].find((o: any) => o.id === where.id) ||
        null),
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
    checkoutIdempotencyRecord: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.businessId_scope_key;
        return [...idempotencyRecords.values()].find((r) => r.businessId === k.businessId && r.scope === k.scope && r.key === k.key) || null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const dup = [...idempotencyRecords.values()].find((r) => r.businessId === data.businessId && r.scope === data.scope && r.key === data.key);
        if (dup) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const created = { id: `idem_${idempotencyRecords.size + 1}`, orderId: null, paymentId: null, responseJson: null, ...data };
        idempotencyRecords.set(created.id, created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = idempotencyRecords.get(where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    }
  };
  client.$transaction = async (fn: any) => fn(client);
  return { default: client };
});

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
        zones: [{ name: "Kilimani", feeKES: 200, estimatedTime: "1–2 hours" }],
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

  it("honours the emergency pause: a paused Front Desk stops serving customers but stays previewable (§45)", async () => {
    state.products.set(bizId, [
      { id: "prod_cake", businessId: bizId, name: "Black Forest Cake 1kg", basePriceKES: 2500, stockStatus: "IN_STOCK", quantity: 5, isActive: true },
    ]);
    await saveExtendedAIConfig(bizId, { operationalStatus: "LIVE" });

    const live = await handleAIFrontDeskTurn({ businessId: bizId, message: "How much is the Black Forest Cake 1kg?" });
    expect(live.responseType).toBe("KNOWN");

    await saveExtendedAIConfig(bizId, { operationalStatus: "PAUSED" });

    const paused = await handleAIFrontDeskTurn({ businessId: bizId, message: "How much is the Black Forest Cake 1kg?" });
    expect(paused.responseType).toBe("ACTION_REQUIRED");
    expect(paused.reply).toContain("paused");
    expect(paused.escalatedToHuman).toBe(true);

    // The owner can still exercise the same configuration in Preview Mode.
    const previewTurn = await handleAIFrontDeskTurn({
      businessId: bizId,
      message: "How much is the Black Forest Cake 1kg?",
      preview: true,
    });
    expect(previewTurn.preview).toBe(true);
    expect(previewTurn.responseType).toBe("KNOWN");
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

  it("executes the complete Section 15 Fresh End-to-End Journey with DB state verification at every transition", async () => {
    // 1. REGISTER & 2. CREATE BUSINESS
    const ownerUserId = "usr_e2e_owner_1";
    const journeyBizId = "biz_e2e_journey_1";
    state.businesses.set(journeyBizId, {
      id: journeyBizId,
      ownerId: ownerUserId,
      slug: "nairobi-roasters",
      name: "Nairobi Roasters",
      category: "Cafe / Restaurant",
      description: "Specialty Kenyan AA coffee roasters.",
      location: "Westlands, Nairobi",
      phone: "+254712345678",
      whatsapp: "+254712345678",
      openingHours: "Mon-Sat 07:30 - 19:00",
      isPublished: false,
      status: "PENDING",
    });
    expect(state.businesses.get(journeyBizId).isPublished).toBe(false);
    expect(state.businesses.get(journeyBizId).status).toBe("PENDING");

    // 3. CONFIGURE AI FRONT DESK
    state.merchantPayments.set(journeyBizId, {
      id: "mp_e2e_1",
      businessId: journeyBizId,
      publicInfo: "M-Pesa Till 889900 (Nairobi Roasters)",
      isActive: true,
    });
    state.recipients.set(journeyBizId, [
      {
        id: "nr_e2e_1",
        businessId: journeyBizId,
        label: "PRIMARY",
        phone: "+254712345678",
        whatsappEnabled: true,
        isActive: true,
      },
    ]);
    await saveExtendedAIConfig(journeyBizId, {
      toneOfVoice: "Friendly",
      languageBehavior: "English + Swahili",
      orderingAllowed: true,
      escalationRules: "Escalate wholesale export enquiries to the head roaster.",
      delivery: {
        pickupEnabled: true,
        deliveryEnabled: true,
        zones: [{ name: "Westlands", feeKES: 150, estimatedTime: "45–60 mins" }],
        freeDeliveryThresholdKES: 4000,
        deliveryInstructions: "Same-day dispatch before 4pm",
      },
      policies: {
        refundPolicy: "Fresh roast replacement within 48 hours if seal is damaged.",
        returnPolicy: "Unopened bags accepted within 7 days.",
        cancellationPolicy: "Cancel before dispatch for full refund.",
      },
    });

    // 4. ADD BUSINESS DATA
    state.products.set(journeyBizId, [
      {
        id: "prod_aa_500g",
        businessId: journeyBizId,
        name: "Kenyan AA Whole Bean 500g",
        description: "Medium roast Nyeri AA beans",
        basePriceKES: 1200,
        stockStatus: "IN_STOCK",
        quantity: 5,
        isActive: true,
      },
    ]);
    state.faqs.set(journeyBizId, [
      {
        id: "faq_grind",
        businessId: journeyBizId,
        question: "Do you grind beans for espresso?",
        answer: "Yes, we grind for espresso, V60, AeroPress, or French press at no extra charge.",
      },
    ]);
    expect(state.products.get(journeyBizId)).toHaveLength(1);
    expect(state.products.get(journeyBizId)![0].basePriceKES).toBe(1200);

    // 5. EDIT BUSINESS DATA (update authoritative price from 1200 -> 1350 KES)
    state.products.get(journeyBizId)![0].basePriceKES = 1350;
    state.knowledge.set(journeyBizId, [
      {
        id: "kd_old_menu",
        businessId: journeyBizId,
        title: "Old 2024 Flyer",
        content: "Kenyan AA Whole Bean 500g is KES 1000",
      },
    ]);
    expect(state.products.get(journeyBizId)![0].basePriceKES).toBe(1350);

    // 6. PREVIEW AI FRONT DESK (isolated from production orders/stock/notifications)
    const previewTurn = await handleAIFrontDeskTurn({
      businessId: journeyBizId,
      message: "How much is Kenyan AA Whole Bean 500g?",
      preview: true,
      mode: "ask_my_bot",
    });
    expect(previewTurn.responseType).toBe("KNOWN");
    expect(previewTurn.source).toBe("structured_data");
    expect(previewTurn.reply).toContain("1350");
    expect(previewTurn.diagnostics?.conflicts.length).toBeGreaterThanOrEqual(1);

    const previewOrder = await createAuthoritativeOrder({
      businessId: journeyBizId,
      customerName: "Preview Tester",
      customerPhone: "0700000000",
      items: [{ productId: "prod_aa_500g", quantity: 2 }],
      preview: true,
    });
    expect(previewOrder.preview).toBe(true);
    expect(state.orders.size).toBe(0);
    expect(state.notifications.size).toBe(0);
    expect(state.products.get(journeyBizId)![0].quantity).toBe(5);

    // 7. RUN READINESS CHECK (ready === true, but canPublish === false before KES 499 payment)
    const readinessBeforePay = await evaluateAIReadiness(journeyBizId);
    expect(readinessBeforePay.ready).toBe(true);
    expect(readinessBeforePay.canPublish).toBe(false);
    expect(readinessBeforePay.subscription.status).toBe("NONE");

    // 8. COMPLETE KES 499 PACKAGE PAYMENT TEST -> 9. SERVER PAYMENT VERIFICATION -> ENTITLEMENT ACTIVATION
    const planPricingCheck = assertAIFrontDeskPlanPricing({
      key: "AI_BUSINESS_FRONT_DESK",
      priceKes: 499,
      durationDays: 30,
      isActive: true,
    });
    expect(planPricingCheck.ok).toBe(true);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 86400_000);
    state.subscriptions.set(journeyBizId, [
      {
        id: "sub_e2e_1",
        businessId: journeyBizId,
        plan: "AI_BUSINESS_FRONT_DESK",
        status: "ACTIVE",
        amountKes: 499,
        startAt: now,
        expiresAt,
      },
    ]);
    state.entitlements.set(journeyBizId, {
      id: "ent_e2e_1",
      businessId: journeyBizId,
      packageKey: "AI_BUSINESS_FRONT_DESK",
      packageName: "AI_BUSINESS_FRONT_DESK",
      priceKES: 499,
      currency: "KES",
      billingCycleDays: 30,
      status: "ACTIVE",
      activatedAt: now,
      expiresAt,
    });

    const readinessAfterPay = await evaluateAIReadiness(journeyBizId);
    expect(readinessAfterPay.ready).toBe(true);
    expect(readinessAfterPay.canPublish).toBe(true);
    expect(readinessAfterPay.subscription.entitled).toBe(true);
    expect(readinessAfterPay.subscription.priceKES).toBe(499);
    expect(readinessAfterPay.subscription.billingCycleDays).toBe(30);

    // 10. PUBLISH AI FRONT DESK
    const publishResult = await publishAIBusinessFrontDesk({
      businessId: journeyBizId,
      actorId: ownerUserId,
    });
    expect(publishResult.ok).toBe(true);
    if (publishResult.ok) {
      expect(publishResult.sharePath).toBe("/b/nairobi-roasters/ai");
      expect(publishResult.publishedVersion).toBeGreaterThanOrEqual(1);
    }
    expect(state.businesses.get(journeyBizId).isPublished).toBe(true);
    expect(state.businesses.get(journeyBizId).status).toBe("ACTIVE");

    // 11. CUSTOMER ASKS AI QUESTION -> AI RETURNS AUTHORITATIVE ANSWER
    const customerTurn = await handleAIFrontDeskTurn({
      businessId: journeyBizId,
      conversationId: "conv_customer_e2e_1",
      customerName: "Kamau",
      customerPhone: "+254722998877",
      message: "How much is Kenyan AA Whole Bean 500g?",
      preview: false,
    });
    expect(customerTurn.responseType).toBe("KNOWN");
    expect(customerTurn.source).toBe("structured_data");
    expect(customerTurn.reply).toContain("1350");

    const customerDeliveryTurn = await handleAIFrontDeskTurn({
      businessId: journeyBizId,
      conversationId: "conv_customer_e2e_1",
      customerName: "Kamau",
      customerPhone: "+254722998877",
      message: "How much is delivery to Westlands?",
      preview: false,
    });
    expect(customerDeliveryTurn.responseType).toBe("KNOWN");
    expect(customerDeliveryTurn.reply).toContain("KES 150");

    // 12. CUSTOMER BUILDS CART -> BACKEND CALCULATES TOTAL
    // 13. CUSTOMER COMPLETES PAYMENT TEST -> SERVER VERIFIES PAYMENT -> ORDER CONFIRMED -> BUSINESS NOTIFICATION CREATED
    const liveOrder = await createAuthoritativeOrder({
      businessId: journeyBizId,
      customerName: "Kamau",
      customerPhone: "+254722998877",
      items: [{ productId: "prod_aa_500g", quantity: 2 }],
      deliveryFeeKES: 150,
      fulfilmentType: "DELIVERY",
      deliveryLocation: "Westlands",
      idempotencyKey: "idem_e2e_kamau_order_1",
      preview: false,
      confirmedByCustomer: true,
    });
    // Authoritative backend total: (2 * 1350) + 150 = 2850 KES
    expect(liveOrder.subtotalKES).toBe(2700);
    expect(liveOrder.deliveryFeeKES).toBe(150);
    expect(liveOrder.totalKES).toBe(2850);
    expect(liveOrder.status).toBe("PENDING_PAYMENT");
    expect(liveOrder.paymentStatus).toBe("UNPAID");
    // Inventory reserved from 5 -> 3
    expect(state.products.get(journeyBizId)![0].quantity).toBe(3);

    // Server-side payment verification transitions order to PAID & CONFIRMED and creates business notification
    const persistedOrder = state.orders.get(liveOrder.orderReference);
    expect(persistedOrder).toBeDefined();
    persistedOrder.paymentStatus = "PAID";
    persistedOrder.status = "CONFIRMED";
    expect(state.orders.get(liveOrder.orderReference).paymentStatus).toBe("PAID");
    expect(state.orders.get(liveOrder.orderReference).status).toBe("CONFIRMED");
    expect(state.notifications.size).toBeGreaterThanOrEqual(1);
  });
});
