import { beforeEach, describe, expect, it, vi } from "vitest";
import { composePublicPaymentText, extractDeliveryArea, interpretOpeningStatus, isBareDeliveryFollowUp, matchCatalogue, redactSecretsFromPublicText, refersToPreviousPlace } from "@/lib/ai-grounding";
import { starterForTemplate, AI_BUSINESS_TEMPLATES } from "@/lib/ai-templates";

const mockState = vi.hoisted(() => ({
  businesses: new Map<string, any>(),
  products: new Map<string, any[]>(),
  services: new Map<string, any[]>(),
  faqs: new Map<string, any[]>(),
  knowledge: new Map<string, any[]>(),
  aiConfigs: new Map<string, any>(),
  offers: new Map<string, any>(),
  merchantPayments: new Map<string, any>(),
  recipients: new Map<string, any[]>(),
  payments: new Map<string, any[]>(),
  orders: [] as any[],
  notifications: [] as any[],
}));

vi.mock("@/lib/db", () => {
  const db: any = {
    business: {
      findUnique: vi.fn(async ({ where }: any) => mockState.businesses.get(where.id) || null),
      update: vi.fn(async ({ where, data }: any) => {
        const next = { ...(mockState.businesses.get(where.id) || {}), ...data };
        mockState.businesses.set(where.id, next);
        return next;
      }),
    },
    product: {
      findMany: vi.fn(async ({ where }: any) => mockState.products.get(where.businessId) || []),
      findFirst: vi.fn(async ({ where }: any) => (mockState.products.get(where.businessId) || []).find((p) => p.id === where.id) || null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    productVariant: { findMany: vi.fn(async () => []) },
    service: { findMany: vi.fn(async ({ where }: any) => mockState.services.get(where.businessId) || []) },
    fAQ: { findMany: vi.fn(async ({ where }: any) => mockState.faqs.get(where.businessId) || []) },
    knowledgeDocument: {
      findMany: vi.fn(async ({ where }: any) => mockState.knowledge.get(where.businessId) || []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "kd", ...data })),
      update: vi.fn(async ({ data }: any) => ({ id: "kd", ...data })),
    },
    aIConfiguration: { findUnique: vi.fn(async ({ where }: any) => mockState.aiConfigs.get(where.businessId) || null) },
    offer: { findUnique: vi.fn(async () => null) },
    merchantPaymentConfig: { findUnique: vi.fn(async ({ where }: any) => mockState.merchantPayments.get(where.businessId) || null) },
    notificationRecipient: {
      findMany: vi.fn(async ({ where }: any) => mockState.recipients.get(where.businessId) || []),
      findFirst: vi.fn(async ({ where }: any) => (mockState.recipients.get(where.businessId) || [])[0] || null),
    },
    unansweredQuestion: { findMany: vi.fn(async () => []), create: vi.fn(async ({ data }: any) => ({ id: "uq", ...data })) },
    demandInsight: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => data) },
    aIQualityEvent: { create: vi.fn(async ({ data }: any) => data) },
    payment: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `n${mockState.notifications.length + 1}`, ...data };
        mockState.notifications.push(created);
        return created;
      }),
    },
    order: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `ord_${mockState.orders.length + 1}`, ...data, items: data.items?.create || [] };
        mockState.orders.push(created);
        return created;
      }),
    },
    auditEvent: { create: vi.fn(async ({ data }: any) => data) },
    checkoutIdempotencyRecord: {
      create: vi.fn(async ({ data }: any) => ({ id: `rec_${Math.random().toString(36).slice(2)}`, ...data })),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async ({ data }: any) => data),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  // Transactions run in the same fake: the mock keeps the order and stock writes, it does not roll them back.
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { default: db };
});

import { handleAIFrontDeskTurn } from "@/lib/ai-front-desk";
import { saveExtendedAIConfig, resetExtendedAIConfigForTests } from "@/lib/ai-config";
import { resetConversationsForTests } from "@/lib/ai-conversation";
import { evaluateAIReadiness } from "@/lib/ai-readiness";
import { createAuthoritativeOrder } from "@/lib/order";
import { executeBusinessTool } from "@/lib/ai-tools";
import { getDemandInsights, resetIntelligenceForTests } from "@/lib/intelligence";

describe("AI Business Front Desk — business-anchored behavior", () => {
  const hardware = "biz_hardware";
  const kitchen = "biz_kitchen";

  beforeEach(async () => {
    mockState.businesses.clear();
    mockState.products.clear();
    mockState.services.clear();
    mockState.faqs.clear();
    mockState.knowledge.clear();
    mockState.aiConfigs.clear();
    mockState.merchantPayments.clear();
    mockState.recipients.clear();
    mockState.orders.length = 0;
    mockState.notifications.length = 0;
    resetExtendedAIConfigForTests();
    resetConversationsForTests();

    mockState.businesses.set(hardware, {
      id: hardware,
      slug: "mlolongo-hardware",
      name: "Mlolongo Hardware",
      category: "Hardware",
      location: "Mlolongo",
      phone: "+254711222333",
      whatsapp: "+254711222333",
      openingHours: "Mon-Sat 08:00 - 18:00",
      isPublished: true,
      status: "ACTIVE",
    });
    mockState.products.set(hardware, [
      { id: "p32", businessId: hardware, name: "Bamburi 32.5", category: "Cement", portionSize: "bag", basePriceKES: 750, stockStatus: "IN_STOCK", quantity: 200, isActive: true },
      { id: "p42", businessId: hardware, name: "Bamburi 42.5", category: "Cement", portionSize: "bag", basePriceKES: 850, stockStatus: "IN_STOCK", quantity: 80, isActive: true },
    ]);
    mockState.merchantPayments.set(hardware, { id: "mp", businessId: hardware, publicInfo: "M-Pesa Till: 556677", isActive: true });
    mockState.recipients.set(hardware, [{ id: "nr", businessId: hardware, label: "PRIMARY", phone: "+254711222333", isActive: true }]);
    await saveExtendedAIConfig(hardware, {
      orderingAllowed: true,
      escalationRules: "Escalate complaints, refunds, and missing information to the owner.",
      delivery: {
        pickupEnabled: true,
        deliveryEnabled: true,
        zones: [{ name: "Syokimau", feeKES: 500, estimatedTime: "2–3 hours" }],
      },
      policies: { refundPolicy: "Unused cement can be returned within 24 hours if unopened." },
    });

    mockState.businesses.set(kitchen, {
      id: kitchen,
      slug: "kitchen",
      name: "Kitchen Counter",
      category: "Restaurant",
      location: "South B",
      phone: "+254700111222",
      openingHours: "Daily 08:00 - 21:00",
      isPublished: true,
      status: "ACTIVE",
    });
    mockState.products.set(kitchen, [
      { id: "chapati", businessId: kitchen, name: "Chapati", portionSize: "piece", basePriceKES: 30, stockStatus: "IN_STOCK", quantity: 40, isActive: true },
      { id: "beef", businessId: kitchen, name: "Beef", portionSize: "plate", basePriceKES: 250, stockStatus: "IN_STOCK", quantity: 15, isActive: true },
    ]);
    mockState.merchantPayments.set(kitchen, { id: "mpk", businessId: kitchen, publicInfo: "M-Pesa Till: 112233", isActive: true });
    await saveExtendedAIConfig(kitchen, {
      orderingAllowed: true,
      escalationRules: "Call the owner for complaints.",
      delivery: { pickupEnabled: true, deliveryEnabled: true, zones: [{ name: "South B", feeKES: 100, estimatedTime: "30–45 mins" }] },
    });
  });

  it("quotes both configured Bamburi prices and does not invent a third", async () => {
    const turn = await handleAIFrontDeskTurn({ businessId: hardware, message: "How much is Bamburi cement?" });
    expect(turn.responseType).toBe("KNOWN");
    expect(turn.reply).toContain("KES 750");
    expect(turn.reply).toContain("KES 850");
    expect(turn.reply).toContain("Bamburi 32.5");
    expect(turn.reply).toContain("Bamburi 42.5");
    expect(turn.reply).not.toMatch(/KES 900/);
    expect(turn.reply).not.toContain("I don't have that product listed");
  });

  it("answers Syokimau delivery from the configured zone, fee and ETA", async () => {
    const turn = await handleAIFrontDeskTurn({ businessId: hardware, message: "Do you deliver to Syokimau?" });
    expect(turn.responseType).toBe("KNOWN");
    expect(turn.reply).toContain("KES 500");
    expect(turn.reply).toContain("2–3 hours");
    expect(turn.reply.toLowerCase()).toContain("syokimau");
  });

  it("continues an order for 20 bags to the previously discussed zone", async () => {
    const price = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "cement-order",
      message: "How much is Bamburi 32.5?",
    });
    expect(price.reply).toContain("KES 750");

    const delivery = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "cement-order",
      message: "Do you deliver to Syokimau?",
    });
    expect(delivery.reply).toContain("KES 500");

    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "cement-order",
      message: "I need 20 bags delivered there.",
    });
    expect(order.reply).toContain("20 × Bamburi 32.5");
    expect(order.reply).toContain("KES 15000");
    expect(order.reply).toContain("KES 500");
    expect(order.reply).toContain("KES 15500");
    expect(order.reply.toLowerCase()).toContain("syokimau");
    expect(order.cartSummary?.totalKES).toBe(15500);
    expect(order.reply.toLowerCase()).toMatch(/name|phone/);
  });

  it("understands a food order and a quantity follow-up", async () => {
    const order = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: "lunch",
      message: "I want 5 chapatis and beef.",
    });
    expect(order.cartSummary?.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Chapati", quantity: 5, unitPriceKES: 30 }),
        expect.objectContaining({ name: "Beef", quantity: 1, unitPriceKES: 250 }),
      ]),
    );
    expect(order.cartSummary?.subtotalKES).toBe(5 * 30 + 250);

    const followUp = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: "beef-follow",
      message: "How much is beef?",
    });
    expect(followUp.reply).toContain("KES 250");
    const two = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: "beef-follow",
      message: "Give me two.",
    });
    expect(two.cartSummary?.lineItems[0]).toMatchObject({ name: "Beef", quantity: 2, unitPriceKES: 250 });
    expect(two.cartSummary?.subtotalKES).toBe(500);
  });

  it("does not invent an unknown price, zone, stock figure, or payment destination", async () => {
    const unknownProduct = await handleAIFrontDeskTurn({ businessId: hardware, message: "How much is the pizza?" });
    expect(unknownProduct.reply).toContain("I don't have that product listed");
    expect(unknownProduct.reply).not.toMatch(/pizza is kes/i);

    const unknownZone = await handleAIFrontDeskTurn({ businessId: hardware, message: "Do you deliver to Karen?" });
    expect(unknownZone.reply).toContain("do not currently have delivery configured for Karen");
    expect(unknownZone.reply).not.toMatch(/Karen is KES/i);

    mockState.products.set(hardware, [
      { id: "mystery", businessId: hardware, name: "Mystery Nails", basePriceKES: 100, stockStatus: null, quantity: null, isActive: true },
    ]);
    const unknownStock = await handleAIFrontDeskTurn({ businessId: hardware, message: "How much is Mystery Nails?" });
    expect(unknownStock.reply).toContain("KES 100");
    expect(unknownStock.reply.toLowerCase()).toContain("stock has not been confirmed");
    expect(unknownStock.reply).not.toContain("IN_STOCK");

    mockState.merchantPayments.delete(hardware);
    const pay = await handleAIFrontDeskTurn({ businessId: hardware, message: "Can I pay by M-Pesa?" });
    expect(pay.reply).toContain("I don't have that information yet");
    expect(pay.reply).not.toMatch(/till\s*\d/i);
  });

  it("returns configured payment instructions and escalates a human request", async () => {
    const pay = await handleAIFrontDeskTurn({ businessId: hardware, message: "Can I pay by M-Pesa?" });
    expect(pay.reply).toContain("M-Pesa Till: 556677");
    expect(pay.reply).not.toMatch(/sk_live|api key|password/i);

    const human = await handleAIFrontDeskTurn({ businessId: hardware, message: "I want to speak to the owner." });
    expect(human.escalatedToHuman).toBe(true);
    expect(human.reply).toContain("I'll pass this to the business team.");
  });

  it("keeps answering prices when ordering is paused, and blocks new orders", async () => {
    await saveExtendedAIConfig(hardware, { pauseAllOrdering: true, operationalStatus: "LIVE" });
    const price = await handleAIFrontDeskTurn({ businessId: hardware, message: "How much is Bamburi 32.5?" });
    expect(price.reply).toContain("KES 750");
    const order = await handleAIFrontDeskTurn({ businessId: hardware, message: "I need 20 bags of Bamburi 32.5." });
    expect(order.reply.toLowerCase()).toContain("ordering is temporarily paused");
    expect(order.cartSummary).toBeFalsy();
  });

  it("states a configured refund policy and does not invent a credit policy", async () => {
    const refund = await handleAIFrontDeskTurn({ businessId: hardware, message: "What is your refund policy?" });
    expect(refund.reply).toContain("Unused cement can be returned within 24 hours");
    const credit = await handleAIFrontDeskTurn({ businessId: hardware, message: "Do you offer credit?" });
    expect(credit.reply).toContain("I don't have that information yet");
    expect(credit.reply.toLowerCase()).not.toContain("yes, we offer credit");
  });

  it("tells the owner exactly what readiness is missing and blocks unpaid publish data", async () => {
    const incomplete = "biz_incomplete";
    mockState.businesses.set(incomplete, {
      id: incomplete,
      name: "Incomplete Shop",
      category: "Retail",
      phone: "+254700000000",
      isPublished: false,
      status: "DRAFT",
    });
    const report = await evaluateAIReadiness(incomplete);
    expect(report.ready).toBe(false);
    expect(report.canPublish).toBe(false);
    expect(report.missingItems.join(" ")).toMatch(/product|hours|notification|escalat/i);

    const ready = await evaluateAIReadiness(hardware);
    expect(ready.ready).toBe(true);
    expect(ready.canPublish).toBe(false);
    expect(ready.checks.find((check) => check.id === "delivery_configuration")?.passed).toBe(true);
    expect(ready.checks.find((check) => check.id === "human_handoff")?.passed).toBe(true);
  });

  it("does not put template sample prices or locations into customer answers", () => {
    for (const template of Object.values(AI_BUSINESS_TEMPLATES)) {
      const starter = starterForTemplate(template);
      const blob = JSON.stringify(starter);
      expect(blob).not.toMatch(/KES\s*\d/);
      expect(blob).not.toMatch(/Syokimau|Westlands|Kilimani/);
      expect(template.sampleFAQs.every((faq) => !faq.answer || faq.answer.length === 0)).toBe(true);
    }
  });

  it("keeps unrelated cart lines when a later quantity refers to one product", async () => {
    const conv = "lunch-same";
    const first = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv,
      message: "I want 5 chapatis and beef.",
    });
    expect(first.cartSummary?.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Chapati", quantity: 5 }),
        expect.objectContaining({ name: "Beef", quantity: 1 }),
      ]),
    );
    const price = await handleAIFrontDeskTurn({ businessId: kitchen, conversationId: conv, message: "How much is beef?" });
    expect(price.reply).toContain("KES 250");
    const two = await handleAIFrontDeskTurn({ businessId: kitchen, conversationId: conv, message: "Give me two." });
    expect(two.cartSummary?.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Chapati", quantity: 5, unitPriceKES: 30 }),
        expect.objectContaining({ name: "Beef", quantity: 2, unitPriceKES: 250 }),
      ]),
    );
    expect(two.cartSummary?.lineItems).toHaveLength(2);
  });

  it("resolves 'that one' to the uniquely established product", async () => {
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "that", message: "How much is Bamburi 32.5?" });
    const selected = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "that", message: "Give me that one." });
    expect(selected.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 1, unitPriceKES: 750 }),
    ]);
    expect(selected.reply).not.toContain("Bamburi 42.5");
  });

  it("applies the established zone when the customer says same delivery address", async () => {
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "addr", message: "Do you deliver to Syokimau?" });
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "addr",
      message: "I need 2 bags of Bamburi 32.5 to the same delivery address.",
    });
    expect(order.reply.toLowerCase()).toContain("syokimau");
    expect(order.reply).toContain("KES 500");
    expect(order.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 2, unitPriceKES: 750 }),
    ]);
    expect(order.cartSummary?.deliveryFeeKES).toBe(500);
    expect(order.cartSummary?.totalKES).toBe(2000);

    const otherTenant = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: "addr",
      message: "I need 2 chapatis to the same delivery address.",
    });
    expect(otherTenant.reply).not.toContain("KES 500");
    expect(otherTenant.reply.toLowerCase()).not.toContain("syokimau");
  });

  it("asks which grade after an ambiguous cement quote instead of guessing", async () => {
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "family", message: "How much is Bamburi cement?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "family", message: "Do you deliver to Syokimau?" });
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "family",
      message: "I need 20 bags delivered there.",
    });
    expect(order.cartSummary).toBeFalsy();
    expect(order.reply).toContain("Bamburi 32.5");
    expect(order.reply).toContain("Bamburi 42.5");
    expect(order.reply).not.toContain("20 ×");
  });

  it("ignores a customer-supplied discount and delivery fee", async () => {
    const spoofed = await executeBusinessTool(
      "create_order",
      {
        customerName: "Asha",
        customerPhone: "0711222333",
        items: [{ productId: "p32", name: "Fake", quantity: 1, unitPriceKES: 1 }],
        discountKES: 700,
        deliveryFeeKES: 1,
        fulfilmentType: "DELIVERY",
        deliveryLocation: "Syokimau",
        confirmedByCustomer: true,
      },
      { businessId: hardware, actorRole: "CUSTOMER", preview: true },
    );
    expect(spoofed.ok).toBe(true);
    const created = spoofed.data as { subtotalKES: number; discountKES: number; deliveryFeeKES: number; totalKES: number; paymentStatus: string };
    expect(created.subtotalKES).toBe(750);
    expect(created.discountKES).toBe(0);
    expect(created.deliveryFeeKES).toBe(500);
    expect(created.totalKES).toBe(1250);
    expect(created.paymentStatus).toBe("UNPAID");

    const direct = await createAuthoritativeOrder({
      businessId: hardware,
      customerName: "Asha",
      customerPhone: "0711222333",
      items: [{ productId: "p32", quantity: 2, unitPriceKES: 1 }],
      discountKES: 1000,
      deliveryFeeKES: 99999,
      fulfilmentType: "PICKUP",
    });
    expect(direct.subtotalKES).toBe(1500);
    expect(direct.discountKES).toBe(0);
    expect(direct.deliveryFeeKES).toBe(0);
    expect(direct.totalKES).toBe(1500);
    expect(direct.paymentStatus).toBe("UNPAID");
  });

  it("reuses one established delivery zone for natural place references, including punctuation", async () => {
    const phrases = [
      "I need 2 bags of Bamburi 32.5 to the same place.",
      "I need 2 bags of Bamburi 32.5 to the same place",
      "I need 2 bags of Bamburi 32.5 to the same area.",
      "I need 2 bags of Bamburi 32.5 to that place.",
      "I need 2 bags of Bamburi 32.5 to that area.",
      "I need 2 bags of Bamburi 32.5 there.",
      "I need 2 bags of Bamburi 32.5 delivered there.",
      "I need 2 bags of Bamburi 32.5 delivered huko.",
      "I need 2 bags of Bamburi 32.5 delivered pale.",
      "I need 2 bags of Bamburi 32.5 to the same delivery address.",
    ];
    for (const message of phrases) {
      const conversationId = `zone-${message}`;
      await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: "Do you deliver to Syokimau?" });
      const order = await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message });
      expect(order.reply.toLowerCase(), message).toContain("syokimau");
      expect(order.reply, message).toContain("KES 500");
      expect(order.reply, message).toContain("2–3 hours");
      expect(order.cartSummary?.lineItems, message).toEqual([
        expect.objectContaining({ name: "Bamburi 32.5", quantity: 2, unitPriceKES: 750 }),
      ]);
      expect(order.cartSummary?.deliveryFeeKES, message).toBe(500);
      expect(order.cartSummary?.discountKES, message).toBe(0);
      expect(order.cartSummary?.totalKES, message).toBe(2000);
      expect(order.reply, message).not.toContain("Bamburi 42.5");
    }
  });

  it("does not invent a delivery location or fee when none was established", async () => {
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "no-prior-zone",
      message: "I need 2 bags of Bamburi 32.5 to the same place.",
    });
    expect(order.reply.toLowerCase()).not.toContain("syokimau");
    expect(order.reply).not.toContain("KES 500");
    expect(order.reply.toLowerCase()).toContain("delivery area");
    expect(order.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 2, unitPriceKES: 750 }),
    ]);
    expect(order.cartSummary?.deliveryFeeKES).toBe(0);
    expect(order.cartSummary?.totalKES).toBe(1500);
  });

  it("does not let another business inherit an established delivery zone", async () => {
    await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "shared-zone",
      message: "Do you deliver to Syokimau?",
    });
    const kitchenOrder = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: "shared-zone",
      message: "I need 2 chapatis to the same place.",
    });
    expect(kitchenOrder.reply.toLowerCase()).not.toContain("syokimau");
    expect(kitchenOrder.reply).not.toContain("KES 500");
    expect(kitchenOrder.cartSummary?.deliveryFeeKES ?? 0).toBe(0);

    await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: "shared-zone-reverse",
      message: "Do you deliver to South B?",
    });
    const hardwareOrder = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "shared-zone-reverse",
      message: "I need 2 bags of Bamburi 32.5 to the same place.",
    });
    expect(hardwareOrder.reply.toLowerCase()).not.toContain("south b");
    expect(hardwareOrder.reply).not.toContain("KES 100");
    expect(hardwareOrder.reply.toLowerCase()).not.toContain("syokimau");
    expect(hardwareOrder.cartSummary?.deliveryFeeKES ?? 0).toBe(0);
  });

  it("asks which delivery area when more than one is plausible", async () => {
    await saveExtendedAIConfig(hardware, {
      orderingAllowed: true,
      delivery: {
        pickupEnabled: true,
        deliveryEnabled: true,
        zones: [
          { name: "Syokimau", feeKES: 500, estimatedTime: "2–3 hours" },
          { name: "Athi River", feeKES: 400, estimatedTime: "3–4 hours" },
        ],
      },
    });
    const conversationId = "two-zones";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: "Do you deliver to Syokimau?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: "Do you deliver to Athi River?" });
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId,
      message: "I need 2 bags of Bamburi 32.5 to the same place.",
    });
    expect(order.cartSummary).toBeFalsy();
    expect(order.reply).toContain("Syokimau");
    expect(order.reply).toContain("Athi River");
    expect(order.reply.toLowerCase()).toContain("which delivery area");
    expect(order.reply).not.toContain("KES 500");
    expect(order.reply).not.toContain("KES 400");
    expect(order.reply).not.toContain("2 ×");
  });

  it("still asks which product when the delivery reference is unambiguous", async () => {
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "grade-place", message: "How much is Bamburi cement?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: "grade-place", message: "Do you deliver to Syokimau?" });
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "grade-place",
      message: "I need 20 bags to the same place.",
    });
    expect(order.cartSummary).toBeFalsy();
    expect(order.reply).toContain("Bamburi 32.5");
    expect(order.reply).toContain("Bamburi 42.5");
    expect(order.reply).not.toContain("20 ×");
  });

  it("recognises punctuated place references without treating bare words as locations", () => {
    expect(extractDeliveryArea("I need 2 bags of Bamburi 32.5 to the same place.").refersToPrevious).toBe(true);
    expect(extractDeliveryArea("I need 2 bags of Bamburi 32.5 to the same place.").zone).toBeNull();
    expect(extractDeliveryArea("to the same place").refersToPrevious).toBe(true);
    expect(extractDeliveryArea("to that area!").refersToPrevious).toBe(true);
    expect(extractDeliveryArea("Do you deliver to Syokimau?").zone).toBe("Syokimau");
    expect(extractDeliveryArea("Do you deliver to Syokimau?").refersToPrevious).toBe(false);
    expect(refersToPreviousPlace("there is cement")).toBe(false);
    expect(refersToPreviousPlace("Is there delivery?")).toBe(false);
    expect(refersToPreviousPlace("place an order")).toBe(false);
    expect(refersToPreviousPlace("that one")).toBe(false);
    expect(refersToPreviousPlace("the same")).toBe(false);
    expect(refersToPreviousPlace("I need 2 bags there.")).toBe(true);
    expect(refersToPreviousPlace("delivered huko.")).toBe(true);
    expect(refersToPreviousPlace("delivered pale")).toBe(true);
  });

  it("strips secrets from public payment text and matches catalogue families", () => {
    const payment = composePublicPaymentText({
      mpesaTill: "556677",
      otherInstructions: "api key: sk_live_should_not_appear",
    });
    expect(payment).toContain("M-Pesa Till: 556677");
    expect(payment).not.toContain("sk_live_should_not_appear");
    expect(redactSecretsFromPublicText("password: hunter2").containedSecret).toBe(true);

    const matches = matchCatalogue("how much is bamburi cement", [
      { id: "a", name: "Bamburi 32.5", category: "Cement" },
      { id: "b", name: "Bamburi 42.5", category: "Cement" },
      { id: "c", name: "Roofing Nails", category: "Nails" },
    ]);
    expect(matches.map((item) => item.id).sort()).toEqual(["a", "b"]);

    const sunday = new Date("2026-10-04T12:00:00Z");
    const status = interpretOpeningStatus("Mon-Sat 08:00 - 18:00", sunday);
    expect(status.summary).toContain("Mon-Sat 08:00 - 18:00");
    expect(status.openNow).toBe(false);
  });

  it("resolves multi-item order and immediate quantity follow-up safely", async () => {
    const conv = "multi-item-immediate";
    const order = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv,
      message: "I want 5 chapatis and beef.",
    });
    expect(order.cartSummary?.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Chapati", quantity: 5, unitPriceKES: 30 }),
        expect.objectContaining({ name: "Beef", quantity: 1, unitPriceKES: 250 }),
      ]),
    );
    expect(order.cartSummary?.subtotalKES).toBe(5 * 30 + 250);

    const followUp = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv,
      message: "Give me two.",
    });
    expect(followUp.cartSummary?.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Chapati", quantity: 5, unitPriceKES: 30 }),
        expect.objectContaining({ name: "Beef", quantity: 2, unitPriceKES: 250 }),
      ]),
    );
    expect(followUp.cartSummary?.lineItems).toHaveLength(2);
    expect(followUp.cartSummary?.subtotalKES).toBe(5 * 30 + 2 * 250);
    expect(followUp.reply).not.toMatch(/which item/i);
  });

  it("asks which item on ambiguous quantity follow-up instead of guessing", async () => {
    mockState.products.set(kitchen, [
      { id: "chapati", businessId: kitchen, name: "Chapati", portionSize: "piece", basePriceKES: 30, stockStatus: "IN_STOCK", quantity: 40, isActive: true },
      { id: "samosa", businessId: kitchen, name: "Samosa", portionSize: "piece", basePriceKES: 50, stockStatus: "IN_STOCK", quantity: 30, isActive: true },
      { id: "beef", businessId: kitchen, name: "Beef", portionSize: "plate", basePriceKES: 250, stockStatus: "IN_STOCK", quantity: 15, isActive: true },
    ]);
    const conv = "both-explicit";
    await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv,
      message: "I want 5 chapatis and 2 samosas.",
    });
    const ambiguous = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv,
      message: "Give me three.",
    });
    expect(ambiguous.reply.toLowerCase()).toContain("which item");
    expect(ambiguous.reply).toContain("Chapati");
    expect(ambiguous.reply).toContain("Samosa");
    expect(ambiguous.cartSummary?.lineItems).toBeUndefined();

    const conv2 = "both-default";
    await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv2,
      message: "I want chapati and beef.",
    });
    const ambiguous2 = await handleAIFrontDeskTurn({
      businessId: kitchen,
      conversationId: conv2,
      message: "Give me two.",
    });
    expect(ambiguous2.reply.toLowerCase()).toContain("which item");
  });

  it("asks which Bamburi grade when multiple grades were discussed, blocking arbitrary order creation", async () => {
    const conv = "bamburi-ambiguous-order";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "How much is Bamburi 42.5?" });
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: conv,
      message: "I need 20 bags delivered there.",
    });
    expect(order.cartSummary).toBeFalsy();
    expect(order.reply).toContain("Bamburi 32.5");
    expect(order.reply).toContain("Bamburi 42.5");
    expect(order.reply).not.toContain("20 ×");
    expect(order.reply).not.toContain("KES 15000");
    expect(order.reply).not.toContain("KES 17000");

    const conv2 = "bamburi-ambiguous-same-place";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv2, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv2, message: "How much is Bamburi 42.5?" });
    const order2 = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: conv2,
      message: "I need 20 bags to the same place.",
    });
    expect(order2.cartSummary).toBeFalsy();
    expect(order2.reply).toContain("Bamburi 32.5");
    expect(order2.reply).toContain("Bamburi 42.5");
    expect(order2.reply).not.toContain("20 ×");
  });

  it("distinguishes one unambiguous active product, multiple plausible products, and no product context", async () => {
    // 1. One unambiguous active product
    const convSingle = "single-prod";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convSingle, message: "How much is Bamburi 32.5?" });
    const singleOrder = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convSingle, message: "Give me that one." });
    expect(singleOrder.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 1, unitPriceKES: 750 }),
    ]);

    // 2. Multiple plausible products: "that one" after discussing two grades asks for clarification
    const convMulti = "multi-prod";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convMulti, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convMulti, message: "How much is Bamburi 42.5?" });
    const multiOrder = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convMulti, message: "Give me that one." });
    expect(multiOrder.cartSummary).toBeFalsy();
    expect(multiOrder.reply.toLowerCase()).toContain("which item");

    // 3. No product context: "Give me two" at the beginning asks what to order
    const convNone = "no-prod";
    const noneOrder = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convNone, message: "Give me two." });
    expect(noneOrder.cartSummary).toBeFalsy();
    expect(noneOrder.reply.toLowerCase()).toMatch(/catalogue|which item|what/);
  });

  it("consistently returns configured payment instructions for various payment questions", async () => {
    const questions = ["Where do I pay?", "How do I pay?", "Can I pay by M-Pesa?", "Where to pay?", "Payment instructions?"];
    for (const q of questions) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message: q });
      expect(turn.reply, q).toContain("M-Pesa Till: 556677");
      expect(turn.reply, q).not.toContain("I don't have that information yet");
    }
  });

  it("distinguishes unstocked product/brand from configured products in same category without inventing price", async () => {
    const unstocked = await handleAIFrontDeskTurn({ businessId: hardware, message: "50kg Savannah cement" });
    expect(unstocked.cartSummary).toBeFalsy();
    expect(unstocked.reply).not.toMatch(/savannah\s+(?:cement\s+)?is\s+kes/i);
    expect(unstocked.reply.toLowerCase()).toContain("don't have that product listed");
    expect(unstocked.reply).toContain("Bamburi 32.5");
    expect(unstocked.reply).toContain("Bamburi 42.5");
  });

  it("verifies shared storefront order path with configured delivery zone, pickup, and financial authority", async () => {
    const order = await createAuthoritativeOrder({
      businessId: hardware,
      customerName: "Kamau",
      customerPhone: "0712345678",
      items: [{ productId: "p32", quantity: 2 }],
      fulfilmentType: "DELIVERY",
      deliveryLocation: "Syokimau",
    });
    expect(order.subtotalKES).toBe(1500);
    expect(order.deliveryFeeKES).toBe(500);
    expect(order.discountKES).toBe(0);
    expect(order.totalKES).toBe(2000);
    expect(order.paymentStatus).toBe("UNPAID");

    const pickupOrder = await createAuthoritativeOrder({
      businessId: hardware,
      customerName: "Kamau",
      customerPhone: "0712345678",
      items: [{ productId: "p32", quantity: 3 }],
      fulfilmentType: "PICKUP",
    });
    expect(pickupOrder.subtotalKES).toBe(2250);
    expect(pickupOrder.deliveryFeeKES).toBe(0);
    expect(pickupOrder.totalKES).toBe(2250);
    expect(pickupOrder.paymentStatus).toBe("UNPAID");

    const spoofedOrder = await createAuthoritativeOrder({
      businessId: hardware,
      customerName: "Kamau",
      customerPhone: "0712345678",
      items: [{ productId: "p32", quantity: 1, unitPriceKES: 10 }],
      discountKES: 500,
      deliveryFeeKES: 1,
      fulfilmentType: "DELIVERY",
      deliveryLocation: "Syokimau",
    });
    expect(spoofedOrder.subtotalKES).toBe(750);
    expect(spoofedOrder.discountKES).toBe(0);
    expect(spoofedOrder.deliveryFeeKES).toBe(500);
    expect(spoofedOrder.totalKES).toBe(1250);
    expect(spoofedOrder.paymentStatus).toBe("UNPAID");
  });

  it("re-establishes a pinned product after both grades without deleting discussed history", async () => {
    const conv = "pin-that-one";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "How much is Bamburi 42.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "How much is Bamburi 32.5?" });
    const order = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "Give me that one." });
    expect(order.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 1, unitPriceKES: 750 }),
    ]);
    expect(order.reply.toLowerCase()).not.toContain("which item");

    const convBags = "pin-bags-there";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convBags, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convBags, message: "How much is Bamburi 42.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convBags, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convBags, message: "Do you deliver to Syokimau?" });
    const bags = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: convBags,
      message: "I need 20 bags delivered there.",
    });
    expect(bags.reply.toLowerCase()).not.toContain("which item");
    expect(bags.reply).toContain("20 × Bamburi 32.5");
    expect(bags.reply.toLowerCase()).toContain("syokimau");
    expect(bags.reply).toContain("KES 500");
    expect(bags.reply).toContain("2–3 hours");
    expect(bags.reply).toContain("KES 15500");
    expect(bags.cartSummary?.totalKES).toBe(15500);
    expect(bags.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 20, unitPriceKES: 750 }),
    ]);

    const convAsk = "pin-still-ambiguous";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convAsk, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convAsk, message: "How much is Bamburi 42.5?" });
    const ambiguous = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: convAsk, message: "Give me that one." });
    expect(ambiguous.cartSummary).toBeFalsy();
    expect(ambiguous.reply.toLowerCase()).toMatch(/which item|which grade/);
    expect(ambiguous.reply).toContain("Bamburi 32.5");
    expect(ambiguous.reply).toContain("Bamburi 42.5");

    const explicit = await handleAIFrontDeskTurn({
      businessId: hardware,
      message: "I want 20 bags of Bamburi 32.5.",
    });
    expect(explicit.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 20, unitPriceKES: 750 }),
    ]);
  });

  it("does not price an unlisted cement brand from a shared category noun", async () => {
    mockState.products.set(hardware, [
      { id: "p32", businessId: hardware, name: "Bamburi Cement 32.5", category: "Cement", portionSize: "bag", basePriceKES: 750, stockStatus: "IN_STOCK", quantity: 200, isActive: true },
      { id: "p42", businessId: hardware, name: "Bamburi Cement 42.5", category: "Cement", portionSize: "bag", basePriceKES: 850, stockStatus: "IN_STOCK", quantity: 80, isActive: true },
      { id: "simba", businessId: hardware, name: "Simba Cement 50kg", category: "Cement", portionSize: "bag", basePriceKES: 700, stockStatus: "IN_STOCK", quantity: 40, isActive: true },
    ]);
    const catalogue = mockState.products.get(hardware);
    expect(matchCatalogue("50kg Savannah cement", catalogue)).toEqual([]);
    expect(matchCatalogue("How much is Bamburi Cement 32.5?", catalogue).map((product) => product.name)).toEqual(["Bamburi Cement 32.5"]);
    expect(matchCatalogue("How much is Simba Cement 50kg?", catalogue).map((product) => product.name)).toEqual(["Simba Cement 50kg"]);
    expect(matchCatalogue("How much is Bamburi cement?", catalogue).map((product) => product.name).sort()).toEqual([
      "Bamburi Cement 32.5",
      "Bamburi Cement 42.5",
    ]);

    const phrases = [
      "50kg Savannah cement",
      "How much is Savannah cement?",
      "Do you have Savannah cement?",
      "I want 10 bags of Savannah cement.",
    ];
    for (const message of phrases) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message });
      expect(turn.cartSummary, message).toBeFalsy();
      expect(turn.reply, message).toContain("I don't have that product listed");
      expect(turn.reply.toLowerCase(), message).toContain("savannah");
      expect(turn.reply.toLowerCase(), message).toMatch(/not listed|not a configured product/);
      expect(turn.reply, message).not.toMatch(/savannah[^.?\n]{0,40}is\s+kes/i);
      expect(turn.reply, message).toContain("Configured alternatives");
      expect(turn.reply, message).toContain("Bamburi Cement 32.5");
      expect(turn.reply, message).not.toMatch(/savannah cement is kes/i);
    }
  });

  it("treats bare delivery follow-ups as the established zone, not an unlisted product", async () => {
    expect(isBareDeliveryFollowUp("same place")).toBe(true);
    expect(isBareDeliveryFollowUp("same place.")).toBe(true);
    expect(isBareDeliveryFollowUp("there!")).toBe(true);
    expect(isBareDeliveryFollowUp("to the same area")).toBe(true);
    expect(isBareDeliveryFollowUp("delivered huko")).toBe(true);
    expect(isBareDeliveryFollowUp("there is")).toBe(false);
    expect(isBareDeliveryFollowUp("place an order")).toBe(false);

    const phrases = [
      "same place",
      "same area",
      "that place",
      "that area",
      "there",
      "same place.",
      "there!",
      "to the same place",
      "to the same area",
      "to that place",
      "to that area",
      "delivered there",
      "delivered huko",
      "delivered pale",
      "to the same place?",
    ];
    for (const message of phrases) {
      const conv = `bare-${message.replace(/[^a-z0-9]+/gi, "-")}`;
      await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "Do you deliver to Syokimau?" });
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message });
      expect(turn.reply.toLowerCase(), message).toContain("syokimau");
      expect(turn.reply, message).toContain("KES 500");
      expect(turn.reply, message).toContain("2–3 hours");
      expect(turn.reply.toLowerCase(), message).toMatch(/item|quantity/);
      expect(turn.reply, message).not.toContain("I don't have that product listed");
      expect(turn.reply, message).not.toMatch(/bamburi[^.?\n]{0,40}is\s+kes/i);
      expect(turn.cartSummary, message).toBeFalsy();
    }

    const noZone = await handleAIFrontDeskTurn({ businessId: hardware, message: "same place" });
    expect(noZone.reply.toLowerCase()).not.toContain("syokimau");
    expect(noZone.reply).not.toContain("KES 500");
    expect(noZone.reply).not.toContain("I don't have that product listed");
    expect(noZone.reply.toLowerCase()).toMatch(/area|destination/);
    const noZoneThere = await handleAIFrontDeskTurn({ businessId: hardware, message: "there" });
    expect(noZoneThere.reply).not.toContain("KES 500");
    expect(noZoneThere.reply.toLowerCase()).not.toContain("syokimau");

    await saveExtendedAIConfig(hardware, {
      orderingAllowed: true,
      delivery: {
        pickupEnabled: true,
        deliveryEnabled: true,
        zones: [
          { name: "Syokimau", feeKES: 500, estimatedTime: "2–3 hours" },
          { name: "Athi River", feeKES: 700, estimatedTime: "3–4 hours" },
        ],
      },
    });
    const multi = "multi-zone-bare";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: multi, message: "Do you deliver to Syokimau?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: multi, message: "Do you deliver to Athi River?" });
    const which = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: multi, message: "same place" });
    expect(which.reply.toLowerCase()).toContain("which");
    expect(which.reply).toContain("Syokimau");
    expect(which.reply).toContain("Athi River");
    expect(which.reply).not.toContain("KES 500");
    expect(which.reply).not.toContain("KES 700");
    expect(which.cartSummary).toBeFalsy();

    const sharedId = "shared-zone-id";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: sharedId, message: "Do you deliver to Syokimau?" });
    const kitchenTurn = await handleAIFrontDeskTurn({ businessId: kitchen, conversationId: sharedId, message: "same place" });
    expect(kitchenTurn.reply.toLowerCase()).not.toContain("syokimau");
    expect(kitchenTurn.reply).not.toContain("KES 500");
    expect(kitchenTurn.reply).not.toContain("556677");
    expect(kitchenTurn.reply).not.toContain("I don't have that product listed");
  });
});


describe("AI Business Front Desk — unlisted-product guard (PR #34 DEFECT-1 remediation)", () => {
  const hardware = "biz_unlisted_guard";
  const cement = "biz_unlisted_guard_cement";

  beforeEach(async () => {
    mockState.businesses.clear();
    mockState.products.clear();
    mockState.services.clear();
    mockState.faqs.clear();
    mockState.knowledge.clear();
    mockState.aiConfigs.clear();
    mockState.merchantPayments.clear();
    mockState.recipients.clear();
    mockState.orders.length = 0;
    mockState.notifications.length = 0;
    resetExtendedAIConfigForTests();
    resetConversationsForTests();
    resetIntelligenceForTests();

    mockState.businesses.set(hardware, {
      id: hardware,
      slug: "guard-hardware",
      name: "Guard Hardware",
      category: "Hardware",
      location: "Mlolongo",
      phone: "+254711222333",
      openingHours: "Mon-Sat 08:00 - 18:00",
      isPublished: true,
      status: "ACTIVE",
    });
    mockState.products.set(hardware, [
      { id: "p32", businessId: hardware, name: "Bamburi 32.5", category: "Cement", portionSize: "bag", basePriceKES: 750, stockStatus: "IN_STOCK", quantity: 200, isActive: true },
      { id: "p42", businessId: hardware, name: "Bamburi 42.5", category: "Cement", portionSize: "bag", basePriceKES: 850, stockStatus: "IN_STOCK", quantity: 80, isActive: true },
    ]);
    mockState.merchantPayments.set(hardware, { id: "mp", businessId: hardware, publicInfo: "M-Pesa Till: 556677", isActive: true });
    mockState.recipients.set(hardware, [{ id: "nr", businessId: hardware, label: "PRIMARY", phone: "+254711222333", isActive: true }]);
    await saveExtendedAIConfig(hardware, {
      orderingAllowed: true,
      delivery: { pickupEnabled: true, deliveryEnabled: true, zones: [{ name: "Syokimau", feeKES: 500, estimatedTime: "2–3 hours" }] },
    });

    // A second catalogue used for the legitimate third-party-brand matching checks.
    mockState.businesses.set(cement, {
      id: cement,
      slug: "guard-cement",
      name: "Guard Cement",
      category: "Hardware",
      location: "Mlolongo",
      phone: "+254711222444",
      openingHours: "Mon-Sat 08:00 - 18:00",
      isPublished: true,
      status: "ACTIVE",
    });
    mockState.products.set(cement, [
      { id: "b32", businessId: cement, name: "Bamburi Cement 32.5", category: "Cement", portionSize: "bag", basePriceKES: 750, stockStatus: "IN_STOCK", quantity: 200, isActive: true },
      { id: "b42", businessId: cement, name: "Bamburi Cement 42.5", category: "Cement", portionSize: "bag", basePriceKES: 850, stockStatus: "IN_STOCK", quantity: 80, isActive: true },
      { id: "simba", businessId: cement, name: "Simba Cement 50kg", category: "Cement", portionSize: "bag", basePriceKES: 700, stockStatus: "IN_STOCK", quantity: 40, isActive: true },
    ]);
    mockState.merchantPayments.set(cement, { id: "mpc", businessId: cement, publicInfo: "M-Pesa Till: 556677", isActive: true });
    await saveExtendedAIConfig(cement, {
      orderingAllowed: true,
      delivery: { pickupEnabled: true, deliveryEnabled: true, zones: [{ name: "Syokimau", feeKES: 500, estimatedTime: "2–3 hours" }] },
    });
  });

  it("answers ordinary conversation neutrally instead of treating it as an unlisted product", async () => {
    const ordinary = ["hello", "hi", "hey", "asante", "thank you", "thanks", "good morning", "good evening", "my name is Kamau", "Kamau 0712345678", "0712345678"];
    for (const message of ordinary) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message });
      expect(turn.reply, message).not.toContain("I don't have that product listed");
      expect(turn.reply, message).not.toContain("is not a configured product");
      expect(turn.reply, message).not.toMatch(/KES\s?750|KES\s?850/);
      expect(turn.cartSummary, message).toBeFalsy();
    }
  });

  it("does not record UNAVAILABLE_PRODUCT demand insights for ordinary conversation", async () => {
    const ordinary = ["hello", "asante", "thank you", "my name is Kamau", "0712345678", "Syokimau", "Nairobi", "I want lunch", "I need a table for two at 7pm"];
    for (const message of ordinary) {
      await handleAIFrontDeskTurn({ businessId: hardware, message });
    }
    const insights = await getDemandInsights(hardware);
    const unavailable = insights.filter((insight) => insight.insightType === "UNAVAILABLE_PRODUCT");
    expect(unavailable).toEqual([]);
  });

  it("treats bare place names as places, not products, and never invents a zone", async () => {
    for (const message of ["Syokimau", "Nairobi", "Karen", "Athi River"]) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message });
      expect(turn.reply, message).not.toContain("I don't have that product listed");
      expect(turn.reply, message).not.toContain("is not a configured product");
      expect(turn.cartSummary, message).toBeFalsy();
    }
    // Without an established delivery context no fee may be quoted for a bare place name.
    const bare = await handleAIFrontDeskTurn({ businessId: hardware, message: "Syokimau" });
    expect(bare.reply).not.toContain("KES 500");
    expect(bare.reply.toLowerCase()).not.toContain("delivery to syokimau");
  });

  it("resolves a bare configured zone answer inside an established delivery conversation", async () => {
    const conv = "guard-zone-answer";
    const asked = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "Do you deliver to Syokimau?" });
    expect(asked.reply).toContain("KES 500");
    const answer = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "Syokimau" });
    expect(answer.reply.toLowerCase()).toContain("syokimau");
    expect(answer.reply).toContain("KES 500");
    expect(answer.reply).toContain("2–3 hours");
    expect(answer.reply).not.toContain("I don't have that product listed");

    const unconfigured = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "Karen" });
    expect(unconfigured.reply.toLowerCase()).not.toContain("kes 500");
    expect(unconfigured.reply).not.toContain("I don't have that product listed");
  });

  it("keeps generic non-catalogue requests out of the unlisted-product branch", async () => {
    for (const message of ["I want lunch", "I need a table for two at 7pm", "I need help", "I want information", "Can you help me?"]) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message });
      expect(turn.reply, message).not.toContain("I don't have that product listed");
      expect(turn.reply, message).not.toContain("is not a configured product");
      expect(turn.cartSummary, message).toBeFalsy();
    }
  });

  it("answers a category-level request with venue context from the catalogue, not as unlisted", async () => {
    for (const message of ["Do you have cement for construction?", "How much is cement for a building project?"]) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message });
      expect(turn.reply, message).not.toContain("I don't have that product listed");
      expect(turn.reply, message).toMatch(/Bamburi 32\.5 is KES 750/);
      expect(turn.reply, message).toContain("Bamburi 42.5 is KES 850");
    }
    // The venue/context noun must not become an unlisted product when it trails a real brand either.
    const brand = await handleAIFrontDeskTurn({
      businessId: hardware,
      message: "How much is Savannah cement for my site?",
    });
    expect(brand.reply).toContain("I don't have that product listed");
    expect(brand.reply.toLowerCase()).toContain("savannah cement");
    expect(brand.reply).not.toContain("site");
  });

  it("still recognises genuine unlisted products and records the missed demand", async () => {
    const phrases = [
      "50kg Savannah cement",
      "How much is Savannah cement?",
      "Do you have Savannah cement?",
      "I want 10 bags of Savannah cement.",
      "How much is Savannah 32.5?",
      "Savannah 42.5",
      "Dangote 32.5",
      "bamboo 32.5",
    ];
    for (const message of phrases) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, message });
      expect(turn.cartSummary, message).toBeFalsy();
      expect(turn.reply, message).toContain("I don't have that product listed");
      expect(turn.reply.toLowerCase(), message).toMatch(/savannah|dangote|bamboo/);
      expect(turn.reply, message).not.toMatch(/(?:savannah|dangote|bamboo)[^.\n]{0,40}?is\s+kes/i);
      expect(turn.reply, message).not.toContain("750 per bag");
    }
    const insights = await getDemandInsights(hardware);
    const unavailable = insights.filter((insight) => insight.insightType === "UNAVAILABLE_PRODUCT");
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable.map((insight) => insight.subject.toLowerCase()).join(" ")).toMatch(/savannah|dangote|bamboo/);
  });

  it("keeps legitimate catalogue matching intact for configured cement products", async () => {
    const bamburi = await handleAIFrontDeskTurn({ businessId: cement, message: "Bamburi Cement 32.5" });
    expect(bamburi.reply).toContain("Bamburi Cement 32.5");
    expect(bamburi.reply).toContain("KES 750");

    const simba = await handleAIFrontDeskTurn({ businessId: cement, message: "Simba Cement 50kg" });
    expect(simba.reply).toContain("Simba Cement 50kg");
    expect(simba.reply).toContain("KES 700");
    expect(simba.reply).not.toContain("I don't have that product listed");

    const family = await handleAIFrontDeskTurn({ businessId: cement, message: "How much is Bamburi cement?" });
    expect(family.reply).toContain("Bamburi Cement 32.5");
    expect(family.reply).toContain("Bamburi Cement 42.5");
    expect(family.reply).not.toContain("I don't have that product listed");
  });

  it("keeps an unlisted item visible inside an otherwise valid mixed order", async () => {
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      message: "I need 5 bags of Bamburi 32.5 and 2 bags of Savannah cement.",
    });
    expect(order.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 5, unitPriceKES: 750 }),
    ]);
    expect(order.reply).toContain("5 × Bamburi 32.5");
    expect(order.reply.toLowerCase()).toContain("savannah cement");
    expect(order.reply).toMatch(/not included in this cart|don't have/i);
    expect(order.reply).not.toMatch(/2 × Bamburi|10 × Bamburi/);
    expect(order.cartSummary?.lineItems).toHaveLength(1);
  });

  it("does not add the unlisted note to a clean order", async () => {
    const order = await handleAIFrontDeskTurn({
      businessId: hardware,
      message: "I need 5 bags of Bamburi 32.5.",
    });
    expect(order.reply).not.toMatch(/not included in this cart/i);
    expect(order.reply).toContain("5 × Bamburi 32.5");

    const withProse = await handleAIFrontDeskTurn({
      businessId: hardware,
      message: "I need 5 bags of Bamburi 32.5 for my site in Mlolongo.",
    });
    expect(withProse.reply).not.toMatch(/not included in this cart/i);
    expect(withProse.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 5 }),
    ]);
  });

  it("answers product questions that merely start with a greeting", async () => {
    const price = await handleAIFrontDeskTurn({ businessId: hardware, message: "hello, how much is Bamburi 32.5?" });
    expect(price.reply).toContain("KES 750");
    expect(price.reply).not.toContain("I don't have that product listed");

    const order = await handleAIFrontDeskTurn({ businessId: hardware, message: "thanks, I need 2 bags of Bamburi 32.5." });
    expect(order.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 2, unitPriceKES: 750 }),
    ]);
  });

  it("retains the primary active-product, ambiguity, delivery and cart behaviours", async () => {
    // 1. Re-pinning: the latest explicit mention is the referent.
    const pinned = "guard-pinned";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "How much is Bamburi 42.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "How much is Bamburi 32.5?" });
    const chosen = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "Give me that one." });
    expect(chosen.cartSummary?.lineItems).toEqual([expect.objectContaining({ name: "Bamburi 32.5", quantity: 1 })]);
    expect(chosen.reply.toLowerCase()).not.toContain("which item");

    // 2. Genuine ambiguity is still preserved.
    const ambiguous = "guard-ambiguous";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: ambiguous, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: ambiguous, message: "How much is Bamburi 42.5?" });
    const ask = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: ambiguous, message: "Give me that one." });
    expect(ask.cartSummary).toBeFalsy();
    expect(ask.reply.toLowerCase()).toMatch(/which item|which grade/);

    // 3. Delivery continuation.
    const delivery = "guard-delivery";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "How much is Bamburi 42.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "Do you deliver to Syokimau?" });
    const cart = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "I need 20 bags delivered there." });
    expect(cart.cartSummary?.lineItems).toEqual([expect.objectContaining({ name: "Bamburi 32.5", quantity: 20 })]);
    expect(cart.cartSummary?.deliveryFeeKES).toBe(500);
    expect(cart.cartSummary?.totalKES).toBe(15500);
    expect(cart.reply).toContain("KES 500");
    expect(cart.reply).toContain("2–3 hours");
    expect(cart.reply).not.toContain("Bamburi 42.5");

    // 4. Bare delivery references.
    for (const phrase of ["same place", "same area", "that place", "that area", "there", "delivered there", "huko", "pale"]) {
      const conv = `guard-bare-${phrase.replace(/\s+/g, "-")}`;
      await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: "Do you deliver to Syokimau?" });
      const bare = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: conv, message: phrase });
      expect(bare.reply.toLowerCase(), phrase).toContain("syokimau");
      expect(bare.reply, phrase).toContain("KES 500");
      expect(bare.reply, phrase).toContain("2–3 hours");
      expect(bare.reply, phrase).not.toContain("I don't have that product listed");
      expect(bare.reply, phrase).not.toMatch(/bamburi[^.\n]{0,40}?is\s+kes/i);
      expect(bare.cartSummary, phrase).toBeFalsy();
    }
  });
});
