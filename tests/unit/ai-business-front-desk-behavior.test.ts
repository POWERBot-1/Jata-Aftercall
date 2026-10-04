import { beforeEach, describe, expect, it, vi } from "vitest";
import { composePublicPaymentText, interpretOpeningStatus, matchCatalogue, redactSecretsFromPublicText } from "@/lib/ai-grounding";
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

vi.mock("@/lib/db", () => ({
  default: {
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
  },
}));

import { handleAIFrontDeskTurn } from "@/lib/ai-front-desk";
import { saveExtendedAIConfig, resetExtendedAIConfigForTests } from "@/lib/ai-config";
import { resetConversationsForTests } from "@/lib/ai-conversation";
import { evaluateAIReadiness } from "@/lib/ai-readiness";
import { createAuthoritativeOrder } from "@/lib/order";
import { executeBusinessTool } from "@/lib/ai-tools";

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
});
