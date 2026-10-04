/**
 * BLOCKER-1 regression suite: conversational filler + quantity/grade must never be classified as
 * an unlisted product.
 *
 * The previous remediation (28443de) turned 78/102 adversarial filler messages into
 * "UNAVAILABLE_PRODUCT" determinations such as `actually 20` or `maybe 42.5`. These tests lock in
 * the corrected behaviour and the behaviours the remediation must not disturb:
 *   - filler + quantity/grade is conversation (with or without a live cart),
 *   - a filler-prefixed quantity correction continues an existing cart,
 *   - genuine unlisted products (Savannah, Dangote, bamboo, …) stay detected and are never
 *     substituted with a configured product,
 *   - configured catalogue grounding, active-product re-pinning, ambiguity, delivery continuation,
 *     bare delivery references and mixed orders keep working,
 *   - `singularize` handles packaging plurals (pieces → piece, boxes → box, …).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectUnlistedProductRequest,
  productLabel,
  productPhrase,
  singularize,
  unlistedProductTokens,
  type CatalogueProduct,
} from "@/lib/ai-grounding";

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
      update: vi.fn(async ({ where, data }: any) => ({ ...(mockState.businesses.get(where.id) || {}), ...data })),
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
    notification: { create: vi.fn(async ({ data }: any) => ({ id: "n", ...data })) },
    order: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: `ord_${mockState.orders.length + 1}`, ...data, items: data.items?.create || [] })),
    },
    auditEvent: { create: vi.fn(async ({ data }: any) => data) },
  },
}));

import { handleAIFrontDeskTurn } from "@/lib/ai-front-desk";
import { saveExtendedAIConfig, resetExtendedAIConfigForTests } from "@/lib/ai-config";
import { resetConversationsForTests } from "@/lib/ai-conversation";
import { getDemandInsights, resetIntelligenceForTests } from "@/lib/intelligence";

const hardware = "biz_filler_hardware";
const cement = "biz_filler_cement";

/** The filler prefixes named by the audit. */
const FILLER_PREFIXES = [
  "Actually", "Maybe", "Instead", "Exactly", "Basically", "Honestly", "Perhaps", "Probably",
  "Definitely", "Certainly", "Anyway", "However", "Otherwise", "Really", "Quite", "Alright",
  "Roughly", "Only", "Even", "Mostly", "Finally", "Meanwhile", "Sorry", "Please", "Yes", "Just",
  "Now", "Today", "Tomorrow", "Again", "Also", "Then",
];

/** Representative quantities, packaging units and grades from the audit. */
const FILLER_TAILS = [
  "20 bags", "42.5", "3 pieces", "6 chapatis", "10 units", "4 boxes",
  "5 bottles", "2 cartons", "3 kg", "20 kg", "32.5", "5 bags",
];

const UNLISTED_MARKER = "I don't have that product listed";

function isUnlistedReply(reply: string): boolean {
  return reply.includes(UNLISTED_MARKER) || reply.includes("is not a configured product");
}

async function unavailableInsights(businessId: string) {
  const insights = await getDemandInsights(businessId);
  return insights.filter((insight) => insight.insightType === "UNAVAILABLE_PRODUCT");
}

describe("AI Front Desk — filler + quantity/grade must not become an unlisted product (BLOCKER-1)", () => {
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
      slug: "filler-hardware",
      name: "Filler Hardware",
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
    });

    // A catalogue whose product names carry the full brand + category + pack size.
    mockState.businesses.set(cement, {
      id: cement,
      slug: "filler-cement",
      name: "Filler Cement",
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

  it("never classifies filler + quantity/grade as an unlisted product (no cart)", async () => {
    for (const prefix of FILLER_PREFIXES) {
      for (const tail of FILLER_TAILS) {
        const message = `${prefix} ${tail}.`;
        const conversationId = `no-cart-${prefix}-${tail}`;
        const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message });
        expect(isUnlistedReply(turn.reply), `${message} -> ${turn.reply}`).toBe(false);
        expect(turn.reply, message).not.toMatch(/is not a configured product/i);
        expect(turn.cartSummary, message).toBeFalsy();
      }
    }
    expect(await unavailableInsights(hardware)).toEqual([]);
  });

  it("never classifies filler + quantity/grade as an unlisted product (live cart)", async () => {
    for (const prefix of FILLER_PREFIXES) {
      for (const tail of FILLER_TAILS) {
        const message = `${prefix} ${tail}.`;
        const conversationId = `live-cart-${prefix}-${tail}`;
        await handleAIFrontDeskTurn({
          businessId: hardware,
          conversationId,
          message: "I need 5 bags of Bamburi 32.5.",
        });
        const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message });
        expect(isUnlistedReply(turn.reply), `${message} -> ${turn.reply}`).toBe(false);
        for (const line of turn.cartSummary?.lineItems || []) {
          expect(line.name, message).toBe("Bamburi 32.5");
        }
      }
    }
    expect(await unavailableInsights(hardware)).toEqual([]);
  });

  it("never claims 'actually 20', 'maybe 42.5', 'yes 3' and friends are unavailable products", async () => {
    const forbidden = [
      "actually 20", "actually 42.5", "actually 3",
      "maybe 20", "maybe 42.5", "maybe 3",
      "instead 20", "instead 42.5", "instead 3",
      "yes 3", "please 3", "sorry 3", "just 3", "now 3", "today 3", "tomorrow 3", "again 3",
      "also 3", "then 3", "only 20", "even 20", "quite 20", "really 20",
    ];
    for (const prefix of FILLER_PREFIXES) {
      for (const tail of FILLER_TAILS) {
        const message = `${prefix} ${tail}.`;
        const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: `phrase-${prefix}-${tail}`, message });
        const lower = turn.reply.toLowerCase();
        for (const phrase of forbidden) {
          if (!message.toLowerCase().startsWith(phrase)) continue;
          expect(lower, `${message} -> ${turn.reply}`).not.toContain(`${phrase} is not a configured product`);
        }
      }
    }
    const insights = await unavailableInsights(hardware);
    expect(insights).toEqual([]);
  });

  it("continues a live cart when a filler-prefixed quantity correction arrives", async () => {
    const cases: Array<[string, string]> = [
      ["actually-20", "Actually 20 bags."],
      ["please-20", "Please 20 bags."],
      ["make-it-20", "Make it 20 bags."],
      ["actually-make-it-20", "Actually make it 20 bags."],
    ];
    for (const [id, correction] of cases) {
      const conversationId = `correction-${id}`;
      const first = await handleAIFrontDeskTurn({
        businessId: hardware,
        conversationId,
        message: "I need 5 bags of Bamburi 32.5.",
      });
      expect(first.cartSummary?.lineItems, id).toEqual([
        expect.objectContaining({ name: "Bamburi 32.5", quantity: 5, unitPriceKES: 750 }),
      ]);

      const second = await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: correction });
      expect(isUnlistedReply(second.reply), `${correction} -> ${second.reply}`).toBe(false);
      expect(second.reply, correction).not.toMatch(/is not a configured product/i);
      expect(second.cartSummary?.lineItems, correction).toEqual([
        expect.objectContaining({ name: "Bamburi 32.5", quantity: 20, unitPriceKES: 750 }),
      ]);
      expect(second.cartSummary?.subtotalKES, correction).toBe(15000);
      expect(second.cartSummary?.totalKES, correction).toBe(15000);
    }
    expect(await unavailableInsights(hardware)).toEqual([]);
  });

  it("keeps a grade-only correction neutral instead of turning it into a quantity", async () => {
    const conversationId = "grade-only-correction";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: "I need 5 bags of Bamburi 32.5." });
    for (const message of ["Maybe 42.5.", "Actually 32.5.", "Instead 10 units."]) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message });
      expect(isUnlistedReply(turn.reply), message).toBe(false);
      expect(turn.cartSummary, message).toBeFalsy();
    }
    expect(await unavailableInsights(hardware)).toEqual([]);
  });

  it("still rejects genuine unlisted brands without substituting a configured product", async () => {
    const phrases = [
      "50kg Savannah cement",
      "How much is Savannah cement?",
      "Do you have Savannah cement?",
      "I want 10 bags of Savannah cement.",
      "How much is Savannah 32.5?",
      "Savannah 42.5",
      "Dangote 32.5",
      "bamboo 32.5",
      "Rhino cement",
      "Mombasa Cement",
      "National Cement 50kg",
      "Ndovu cement",
      "Twiga cement",
    ];
    for (const message of phrases) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: `unlisted-${message}`, message });
      expect(turn.cartSummary, message).toBeFalsy();
      expect(turn.reply, message).toContain(UNLISTED_MARKER);
      expect(turn.reply.toLowerCase(), message).toMatch(/savannah|dangote|bamboo|rhino|mombasa|national|ndovu|twiga/);
      // No Bamburi substitution and no invented price.
      expect(turn.reply, message).not.toMatch(/(?:savannah|dangote|bamboo|rhino|mombasa|national|ndovu|twiga)[^.\n]{0,40}?is\s+kes/i);
      expect(turn.reply, message).not.toContain("Bamburi 32.5 is KES 750");
    }
    const insights = await unavailableInsights(hardware);
    expect(insights.length).toBeGreaterThan(0);
    const subjects = insights.map((insight) => insight.subject.toLowerCase()).join(" ");
    expect(subjects).toMatch(/savannah|dangote|bamboo|rhino|mombasa|national|ndovu|twiga/);
    expect(subjects).not.toMatch(/\b(actually|maybe|instead|exactly|yes|please|sorry|then|also)\b/);
  });

  it("still detects a quantity-prefixed single-name unlisted item", async () => {
    const turn = await handleAIFrontDeskTurn({
      businessId: hardware,
      conversationId: "unlisted-quantity-prefix",
      message: "I want 10 bags of Savannah.",
    });
    expect(turn.cartSummary).toBeFalsy();
    expect(turn.reply).toContain(UNLISTED_MARKER);
    expect(turn.reply.toLowerCase()).toContain("savannah");
    expect(turn.reply).not.toMatch(/savannah[^.\n]{0,40}?is\s+kes/i);
  });

  it("keeps configured cement catalogue queries grounded", async () => {
    const bamburi32 = await handleAIFrontDeskTurn({ businessId: cement, message: "Bamburi Cement 32.5" });
    expect(bamburi32.reply).toContain("Bamburi Cement 32.5");
    expect(bamburi32.reply).toContain("KES 750");
    expect(bamburi32.reply).not.toContain(UNLISTED_MARKER);

    const bamburi42 = await handleAIFrontDeskTurn({ businessId: cement, message: "Bamburi Cement 42.5" });
    expect(bamburi42.reply).toContain("Bamburi Cement 42.5");
    expect(bamburi42.reply).toContain("KES 850");

    const simba = await handleAIFrontDeskTurn({ businessId: cement, message: "Simba Cement 50kg" });
    expect(simba.reply).toContain("Simba Cement 50kg");
    expect(simba.reply).toContain("KES 700");
    expect(simba.reply).not.toContain(UNLISTED_MARKER);

    const family = await handleAIFrontDeskTurn({ businessId: cement, message: "How much is Bamburi cement?" });
    expect(family.reply).toContain("Bamburi Cement 32.5");
    expect(family.reply).toContain("Bamburi Cement 42.5");
    expect(family.reply).not.toContain(UNLISTED_MARKER);

    for (const message of [
      "How much is cement for construction?",
      "Do you have cement for construction?",
      "How much is cement for a building project?",
    ]) {
      const turn = await handleAIFrontDeskTurn({ businessId: cement, conversationId: `cat-${message}`, message });
      expect(turn.reply, message).not.toContain(UNLISTED_MARKER);
      expect(turn.reply, message).toContain("Bamburi Cement 32.5");
      expect(turn.reply, message).toContain("Bamburi Cement 42.5");
      expect(turn.reply, message).toContain("Simba Cement 50kg");
    }

    const category = await handleAIFrontDeskTurn({ businessId: cement, message: "cement" });
    expect(category.reply).toContain("Bamburi Cement 32.5");
    expect(category.reply).not.toContain(UNLISTED_MARKER);

    const site = await handleAIFrontDeskTurn({ businessId: cement, message: "I need cement for my site" });
    expect(site.reply).not.toContain(UNLISTED_MARKER);
    expect(site.reply.toLowerCase()).toMatch(/configured catalogue|which item/);

    expect(await unavailableInsights(cement)).toEqual([]);
  });

  it("keeps availability questions about facilities neutral instead of unlisted products", async () => {
    for (const message of [
      "Do you have wifi?",
      "Do you have parking?",
      "Do you have a website?",
      "Do you have a shop in Karen?",
      "Do you have a branch in Nairobi?",
      "Do you sell in Karen?",
      "Do you have an account with Equity?",
      "Do you have a physical address?",
    ]) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: `facility-${message}`, message });
      expect(isUnlistedReply(turn.reply), `${message} -> ${turn.reply}`).toBe(false);
      expect(turn.cartSummary, message).toBeFalsy();
    }
    expect(await unavailableInsights(hardware)).toEqual([]);
  });

  it("keeps conversational sentences with numbers out of the unlisted branch", async () => {
    for (const message of [
      "I think 2 bags is enough for now.",
      "My budget is around 20,000.",
      "Sorry I meant 20 bags.",
      "Is 32.5 better than 42.5?",
    ]) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: `sentence-${message}`, message });
      expect(isUnlistedReply(turn.reply), `${message} -> ${turn.reply}`).toBe(false);
      expect(turn.cartSummary, message).toBeFalsy();
    }
    expect(await unavailableInsights(hardware)).toEqual([]);
  });

  it("keeps active-product re-pinning and genuine ambiguity intact", async () => {
    const pinned = "filler-pinned";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "How much is Bamburi 42.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "How much is Bamburi 32.5?" });
    const chosen = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: pinned, message: "Give me that one." });
    expect(chosen.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 1, unitPriceKES: 750 }),
    ]);
    expect(chosen.reply.toLowerCase()).not.toContain("which item");

    const ambiguous = "filler-ambiguous";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: ambiguous, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: ambiguous, message: "How much is Bamburi 42.5?" });
    const ask = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: ambiguous, message: "Give me that one." });
    expect(ask.cartSummary).toBeFalsy();
    expect(ask.reply.toLowerCase()).toMatch(/which item|which grade/);
  });

  it("keeps delivery continuation and bare delivery references intact", async () => {
    const delivery = "filler-delivery";
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "How much is Bamburi 42.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "How much is Bamburi 32.5?" });
    await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "Do you deliver to Syokimau?" });
    const cart = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: delivery, message: "I need 20 bags delivered there." });
    expect(cart.cartSummary?.lineItems).toEqual([
      expect.objectContaining({ name: "Bamburi 32.5", quantity: 20, unitPriceKES: 750 }),
    ]);
    expect(cart.cartSummary?.deliveryFeeKES).toBe(500);
    expect(cart.cartSummary?.totalKES).toBe(15500);
    expect(cart.reply).toContain("KES 500");
    expect(cart.reply).toContain("2–3 hours");
    expect(cart.reply).not.toContain("Bamburi 42.5");

    for (const phrase of ["same place", "same area", "that place", "that area", "there", "delivered there", "huko", "pale"]) {
      const conversationId = `filler-bare-${phrase.replace(/\s+/g, "-")}`;
      await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: "Do you deliver to Syokimau?" });
      const bare = await handleAIFrontDeskTurn({ businessId: hardware, conversationId, message: phrase });
      expect(bare.reply.toLowerCase(), phrase).toContain("syokimau");
      expect(bare.reply, phrase).toContain("KES 500");
      expect(bare.reply, phrase).not.toContain(UNLISTED_MARKER);
      expect(bare.cartSummary, phrase).toBeFalsy();
    }
  });

  it("keeps the order of a mixed listed/unlisted message from changing in either direction", async () => {
    for (const [id, message] of [
      ["forward", "I need 5 bags of Bamburi 32.5 and 2 bags of Savannah cement."],
      ["reverse", "I need 2 bags of Savannah cement and 5 bags of Bamburi 32.5."],
    ] as Array<[string, string]>) {
      const turn = await handleAIFrontDeskTurn({ businessId: hardware, conversationId: `mixed-${id}`, message });
      expect(turn.cartSummary?.lineItems, id).toEqual([
        expect.objectContaining({ name: "Bamburi 32.5", quantity: 5, unitPriceKES: 750 }),
      ]);
      expect(turn.reply, id).toContain("5 × Bamburi 32.5");
      expect(turn.reply.toLowerCase(), id).toContain("savannah cement");
      expect(turn.reply, id).toMatch(/not included in this cart|don't have/i);
      expect(turn.reply, id).not.toMatch(/2 × Bamburi|10 × Bamburi/);
    }
    const insights = await unavailableInsights(hardware);
    expect(insights.map((insight) => insight.subject.toLowerCase()).join(" ")).toContain("savannah");
  });
});

describe("AI grounding — item phrase, evidence and packaging plurals", () => {
  const products: CatalogueProduct[] = [
    { id: "p32", name: "Bamburi 32.5", category: "Cement", basePriceKES: 750, isActive: true },
    { id: "p42", name: "Bamburi 42.5", category: "Cement", basePriceKES: 850, isActive: true },
  ];

  it("singularizes packaging plurals without breaking ordinary words", () => {
    expect(singularize("piece")).toBe("piece");
    expect(singularize("pieces")).toBe("piece");
    expect(singularize("box")).toBe("box");
    expect(singularize("boxes")).toBe("box");
    expect(singularize("bottle")).toBe("bottle");
    expect(singularize("bottles")).toBe("bottle");
    expect(singularize("bag")).toBe("bag");
    expect(singularize("bags")).toBe("bag");
    expect(singularize("carton")).toBe("carton");
    expect(singularize("cartons")).toBe("carton");
    expect(singularize("kg")).toBe("kg");
    // Three-letter words are left alone by the plural rule; "kgs" is already a pack token.
    expect(singularize("kgs")).toBe("kgs");
    expect(singularize("plate")).toBe("plate");
    expect(singularize("plates")).toBe("plate");
    expect(singularize("unit")).toBe("unit");
    expect(singularize("units")).toBe("unit");
    expect(singularize("chapati")).toBe("chapati");
    expect(singularize("chapatis")).toBe("chapati");
    // Existing protected words and shapes must not change.
    expect(singularize("chips")).toBe("chips");
    expect(singularize("fries")).toBe("fries");
    expect(singularize("glass")).toBe("glass");
    expect(singularize("classes")).toBe("class");
    expect(singularize("sizes")).toBe("size");
    expect(singularize("tomatoes")).toBe("tomato");
  });

  it("does not turn packaging plurals into product tokens", () => {
    expect(unlistedProductTokens("3 pieces", products)).toEqual([]);
    expect(unlistedProductTokens("4 boxes", products)).toEqual([]);
    expect(unlistedProductTokens("5 bottles", products)).toEqual([]);
    expect(unlistedProductTokens("2 cartons", products)).toEqual([]);
    expect(unlistedProductTokens("3 kg", products)).toEqual([]);
  });

  it("reduces a captured request to its item phrase", () => {
    expect(productPhrase("actually 20 bags")).toBe("20 bags");
    expect(productPhrase("Maybe 42.5")).toBe("42.5");
    expect(productPhrase("sorry 3 pieces")).toBe("3 pieces");
    expect(productPhrase("savannah cement for my site")).toBe("savannah cement");
    expect(productPhrase("50kg savannah cement")).toBe("50kg savannah cement");
    expect(productPhrase("savannah 42.5")).toBe("savannah 42.5");
    expect(productPhrase("dangote 32.5")).toBe("dangote 32.5");
    expect(productLabel("savannah cement for my site", products)).toBe("savannah cement");
    expect(productLabel("to buy dangote 32.5", products)).toBe("dangote 32.5");
  });

  it("never treats a filler-prefixed quantity or grade as a plausible unlisted product", () => {
    const messages = [
      "Actually 20 bags.", "Maybe 42.5.", "Instead 10 units.", "Exactly 3 pieces.",
      "Basically 6 chapatis.", "Honestly 4 boxes.", "Perhaps 5 bottles.", "Probably 2 cartons.",
      "Definitely 3 kg.", "Certainly 20 kg.", "Anyway 32.5.", "However 42.5.", "Otherwise 20 bags.",
      "Really 3 pieces.", "Quite 6 chapatis.", "Alright 10 units.", "Roughly 4 boxes.",
      "Only 5 bottles.", "Even 2 cartons.", "Mostly 3 kg.", "Finally 20 kg.", "Meanwhile 32.5.",
      "Sorry 3 pieces.", "Please 3 pieces.", "Yes 3 pieces.", "Just 3 pieces.", "Now 3 pieces.",
      "Today 3 pieces.", "Tomorrow 3 pieces.", "Again 3 pieces.", "Also 3 pieces.", "Then 3 pieces.",
    ];
    for (const message of messages) {
      const decision = detectUnlistedProductRequest({
        message,
        candidate: message.toLowerCase().replace(/\.$/, ""),
        frame: "bare",
        products,
      });
      expect(decision.plausible, `${message} -> ${decision.tokens.join(",")}`).toBe(false);
      expect(decision.tokens.join(" "), message).not.toMatch(/^(actually|maybe|instead|exactly|basically|honestly|perhaps|probably|definitely|certainly|anyway|however|otherwise|really|quite|alright|roughly|only|even|mostly|finally|meanwhile|sorry|please|yes|just|now|today|tomorrow|again|also|then)\b/);
    }
  });

  it("keeps credible product evidence plausible in every frame", () => {
    const check = (message: string, candidate: string, frame: "price" | "availability" | "order" | "bare") =>
      detectUnlistedProductRequest({ message, candidate, frame, products }).plausible;

    expect(check("50kg Savannah cement", "savannah cement", "bare")).toBe(true);
    expect(check("How much is Savannah cement?", "savannah cement", "price")).toBe(true);
    expect(check("Do you have Savannah cement?", "savannah cement", "availability")).toBe(true);
    expect(check("I want 10 bags of Savannah cement.", "savannah cement", "order")).toBe(true);
    expect(check("How much is Savannah 32.5?", "savannah 32.5", "price")).toBe(true);
    expect(check("Savannah 42.5", "savannah 42.5", "bare")).toBe(true);
    expect(check("Dangote 32.5", "dangote 32.5", "bare")).toBe(true);
    // A quantity that belongs to the phrase (or sits immediately in front of it) is evidence.
    expect(check("I want 10 bags of Savannah.", "savannah", "order")).toBe(true);
    expect(check("42.5 Dangote", "dangote", "bare")).toBe(true);
    // "How much is the pizza?" stays answerable as an unlisted product.
    expect(check("How much is the pizza?", "pizza", "price")).toBe(true);
    // Category-level and conversational text is not a product.
    expect(check("How much is cement for construction?", "cement for construction", "price")).toBe(false);
    expect(check("Do you have wifi?", "wifi", "availability")).toBe(false);
    expect(check("Do you sell in Karen?", "in karen", "availability")).toBe(false);
    expect(check("I think 2 bags is enough for now.", "i think 2 bags is enough", "bare")).toBe(false);
    expect(check("My budget is around 20,000.", "my budget is around 20,000", "bare")).toBe(false);
  });
});
