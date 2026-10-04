/**
 * Nullable-category regression suite: a genuine product phrase must not become undetectable when the
 * optional `category` field on the configured catalogue items is `null`.
 *
 * Independent audit finding (after 28443de / c443fb3): with `category: null`, these genuine
 * unlisted-product requests answered `plausible: false` and fell through to the neutral fallback —
 * no unlisted-product response, no `UNAVAILABLE_PRODUCT` insight:
 *
 *   Do you have Savannah cement? / Rhino cement / Mombasa Cement / Ndovu cement / Twiga cement
 *
 * They passed only while `category: "Cement"` was set, which made the plausibility evidence depend on
 * optional metadata. This suite runs the same conceptual requests against a category-present
 * catalogue and a category-null catalogue and requires the same outcome from both, while pinning the
 * behaviours the fix must not disturb:
 *   - configured catalogue products still win (no configured product becomes "unlisted"),
 *   - facility / non-product questions stay neutral,
 *   - conversational filler + quantity/grade stays conversational,
 *   - live-cart corrections, active-product re-pinning, ambiguity, delivery continuation and mixed
 *     listed/unlisted orders keep working,
 *   - no unlisted request is ever substituted with a configured product's price.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { detectUnlistedProductRequest, type CatalogueProduct } from "@/lib/ai-grounding";
import { saveExtendedAIConfig, resetExtendedAIConfigForTests } from "@/lib/ai-config";
import { resetConversationsForTests } from "@/lib/ai-conversation";
import { getDemandInsights, resetIntelligenceForTests } from "@/lib/intelligence";

/** Catalogue with grades in the product names — the fixture the audit ran with `category: null`. */
const gradedPresent = "biz_nullable_graded_present";
const gradedNull = "biz_nullable_graded_null";
/** Catalogue whose product names carry the category noun as well. */
const namedPresent = "biz_nullable_named_present";
const namedNull = "biz_nullable_named_null";

const ALL_BUSINESSES = [gradedPresent, gradedNull, namedPresent, namedNull];
/** Same catalogue content, with and without the optional metadata. */
const CATEGORY_STATE_PAIRS: Array<[string, string]> = [
  [gradedPresent, gradedNull],
  [namedPresent, namedNull],
];
/** Pairs whose product names are "Bamburi 32.5" / "Bamburi 42.5". */
const GRADED_PAIRS: Array<[string, string]> = [[gradedPresent, gradedNull]];
/** Pairs whose product names carry the category noun ("Bamburi Cement 32.5"). */
const NAMED_PAIRS: Array<[string, string]> = [[namedPresent, namedNull]];

/** Configured products that must keep winning over the unlisted-product branch. */
const GRADED_CATALOGUE_CASES: Array<[string, string, number]> = [
  ["How much is Bamburi 32.5?", "Bamburi 32.5", 750],
  ["How much is Bamburi 42.5?", "Bamburi 42.5", 850],
  ["Bamburi 32.5", "Bamburi 32.5", 750],
  ["Do you have Bamburi 42.5?", "Bamburi 42.5", 850],
];

const NAMED_CATALOGUE_CASES: Array<[string, string, number]> = [
  ["Bamburi Cement 32.5", "Bamburi Cement 32.5", 750],
  ["Bamburi Cement 42.5", "Bamburi Cement 42.5", 850],
  ["Simba Cement 50kg", "Simba Cement 50kg", 700],
  ["How much is Bamburi Cement 32.5?", "Bamburi Cement 32.5", 750],
  ["Do you have Simba Cement 50kg?", "Simba Cement 50kg", 700],
];

/** Genuine unlisted-product requests: the audit's nullable-category cases plus the ones that already
 * worked without category metadata (they must keep working, and must behave the same in both states). */
const UNLISTED_CASES: Array<[string, RegExp]> = [
  ["Do you have Savannah cement?", /savannah/i],
  ["Rhino cement", /rhino/i],
  ["Mombasa Cement", /mombasa/i],
  ["Ndovu cement", /ndovu/i],
  ["Twiga cement", /twiga/i],
  ["50kg Savannah cement", /savannah/i],
  ["How much is Savannah cement?", /savannah/i],
  ["I want 10 bags of Savannah cement.", /savannah/i],
  ["How much is Savannah 32.5?", /savannah/i],
  ["Savannah 42.5", /savannah/i],
  ["Dangote 32.5", /dangote/i],
  ["bamboo 32.5", /bamboo/i],
];

/** Facilities, channels and places: questions about them are never unlisted products. */
const FACILITY_CASES = [
  "Do you have wifi?",
  "Do you have parking?",
  "Do you have a website?",
  "Do you have a shop in Karen?",
  "Do you have a branch in Nairobi?",
  "Do you sell in Karen?",
  "Do you have an account with Equity?",
  "Do you have a physical address?",
];

/** The conversational filler + quantity/grade minimum named by the audit (the full 102-message
 * corpus runs in tests/unit/ai-front-desk-filler-regression.test.ts, in both category states). */
const FILLER_CASES = [
  "Actually 20 bags.",
  "Maybe 42.5.",
  "Please 3 pieces.",
  "Yes 3 pieces.",
  "Just 20 bags.",
  "Again 3 pieces.",
];

const UNLISTED_MARKER = "I don't have that product listed";

function isUnlistedReply(reply: string): boolean {
  return reply.includes(UNLISTED_MARKER) || reply.includes("is not a configured product");
}

async function unavailableInsights(businessId: string) {
  const insights = await getDemandInsights(businessId);
  return insights.filter((insight) => insight.insightType === "UNAVAILABLE_PRODUCT");
}

function registerBusiness(
  businessId: string,
  products: Array<{ name: string; price: number; category: string | null }>,
): void {
  mockState.businesses.set(businessId, {
    id: businessId,
    slug: businessId.replace(/_/g, "-"),
    name: "Nullable Catalogue Hardware",
    category: "Hardware",
    location: "Mlolongo",
    phone: "+254711222555",
    whatsapp: "+254711222555",
    openingHours: "Mon-Sat 08:00 - 18:00",
    isPublished: true,
    status: "ACTIVE",
  });
  mockState.products.set(
    businessId,
    products.map((product, index) => ({
      id: `${businessId}_p${index}`,
      businessId,
      name: product.name,
      category: product.category,
      portionSize: "bag",
      basePriceKES: product.price,
      stockStatus: "IN_STOCK",
      quantity: 200,
      isActive: true,
    })),
  );
  mockState.merchantPayments.set(businessId, { id: `${businessId}_mp`, businessId, publicInfo: "M-Pesa Till: 556677", isActive: true });
  mockState.recipients.set(businessId, [{ id: `${businessId}_nr`, businessId, label: "PRIMARY", phone: "+254711222555", isActive: true }]);
}

describe("AI Front Desk — nullable category metadata must not hide unlisted products", () => {
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

    const graded = [
      { name: "Bamburi 32.5", price: 750, category: "Cement" as string | null },
      { name: "Bamburi 42.5", price: 850, category: "Cement" as string | null },
    ];
    const named = [
      { name: "Bamburi Cement 32.5", price: 750, category: "Cement" as string | null },
      { name: "Bamburi Cement 42.5", price: 850, category: "Cement" as string | null },
      { name: "Simba Cement 50kg", price: 700, category: "Cement" as string | null },
    ];
    registerBusiness(gradedPresent, graded);
    registerBusiness(gradedNull, graded.map((product) => ({ ...product, category: null })));
    registerBusiness(namedPresent, named);
    registerBusiness(namedNull, named.map((product) => ({ ...product, category: null })));

    for (const businessId of ALL_BUSINESSES) {
      await saveExtendedAIConfig(businessId, {
        orderingAllowed: true,
        escalationRules: "Escalate complaints, refunds, and missing information to the owner.",
        delivery: {
          pickupEnabled: true,
          deliveryEnabled: true,
          zones: [{ name: "Syokimau", feeKES: 500, estimatedTime: "2–3 hours" }],
        },
      });
    }
  });

  it("answers genuine unlisted products the same way with and without category metadata", async () => {
    for (const businessId of [gradedNull, gradedPresent, namedNull, namedPresent]) {
      for (const [message, brand] of UNLISTED_CASES) {
        const turn = await handleAIFrontDeskTurn({
          businessId,
          conversationId: `${businessId}-${message}`,
          message,
        });
        expect(isUnlistedReply(turn.reply), `${businessId} :: ${message} -> ${turn.reply}`).toBe(true);
        expect(turn.reply, `${businessId} :: ${message}`).toContain(UNLISTED_MARKER);
        expect(turn.reply, `${businessId} :: ${message}`).toMatch(brand);
        // No cart, and no substitution with a configured product's price.
        expect(turn.cartSummary, `${businessId} :: ${message}`).toBeFalsy();
        expect(turn.reply, `${businessId} :: ${message}`).not.toContain("I have prepared your cart");
        expect(turn.reply, `${businessId} :: ${message}`).not.toMatch(
          /(?:savannah|rhino|mombasa|ndovu|twiga|dangote|bamboo)[^.\n]{0,40}?is\s+kes/i,
        );
        expect(turn.reply, `${businessId} :: ${message}`).not.toContain("Bamburi 32.5 is KES 750");
      }
    }

    // The missed demand is recorded for every genuine request, without filler leaking into the insight.
    for (const businessId of [gradedNull, gradedPresent, namedNull, namedPresent]) {
      const insights = await unavailableInsights(businessId);
      const subjects = insights.map((insight) => insight.subject.toLowerCase()).join(" | ");
      for (const brand of [/savannah/i, /rhino/i, /mombasa/i, /ndovu/i, /twiga/i, /dangote/i, /bamboo/i]) {
        expect(subjects, `${businessId} insights: ${subjects}`).toMatch(brand);
      }
      expect(subjects, businessId).not.toMatch(/\b(actually|maybe|instead|exactly|please|yes|just|again)\b/);
    }
  });

  it("classifies the same unlisted phrase identically in both category states", async () => {
    for (const [present, absent] of CATEGORY_STATE_PAIRS) {
      for (const [message] of UNLISTED_CASES) {
        const withCategory = await handleAIFrontDeskTurn({ businessId: present, conversationId: `${present}-${message}`, message });
        const withoutCategory = await handleAIFrontDeskTurn({ businessId: absent, conversationId: `${absent}-${message}`, message });
        expect(isUnlistedReply(withoutCategory.reply), `${absent} :: ${message} -> ${withoutCategory.reply}`).toBe(
          isUnlistedReply(withCategory.reply),
        );
        expect(isUnlistedReply(withoutCategory.reply), `${absent} :: ${message}`).toBe(true);
        expect(Boolean(withoutCategory.cartSummary), `${absent} :: ${message}`).toBe(Boolean(withCategory.cartSummary));
      }
    }
  });

  it("keeps catalogue matching in priority with and without category metadata", async () => {
    for (const [present, absent] of GRADED_PAIRS) {
      for (const businessId of [present, absent]) {
        for (const [message, name, price] of GRADED_CATALOGUE_CASES) {
          const turn = await handleAIFrontDeskTurn({ businessId, message });
          expect(turn.reply, `${businessId} :: ${message}`).toContain(name);
          expect(turn.reply, `${businessId} :: ${message}`).toContain(`KES ${price}`);
          expect(turn.reply, `${businessId} :: ${message}`).not.toContain(UNLISTED_MARKER);
        }
      }
    }

    for (const businessId of [namedNull, namedPresent]) {
      for (const [message, name, price] of NAMED_CATALOGUE_CASES) {
        const turn = await handleAIFrontDeskTurn({ businessId, message });
        expect(turn.reply, `${businessId} :: ${message}`).toContain(name);
        expect(turn.reply, `${businessId} :: ${message}`).toContain(`KES ${price}`);
        expect(turn.reply, `${businessId} :: ${message}`).not.toContain(UNLISTED_MARKER);
      }

      const family = await handleAIFrontDeskTurn({ businessId, message: "How much is Bamburi cement?" });
      expect(family.reply, businessId).toContain("Bamburi Cement 32.5");
      expect(family.reply, businessId).toContain("Bamburi Cement 42.5");
      expect(family.reply, businessId).not.toContain(UNLISTED_MARKER);
    }

    // A category-level request is a catalogue question, never an unlisted product, in both states.
    // Listing the family still needs either category metadata or the category noun inside the
    // configured product names, which is the catalogue-grounding path this remediation does not
    // change; a null-category catalogue without cement in its names answers neutrally instead.
    for (const businessId of ALL_BUSINESSES) {
      for (const message of ["cement", "How much is cement for construction?", "Do you have cement for construction?"]) {
        const turn = await handleAIFrontDeskTurn({ businessId, conversationId: `${businessId}-cat-${message}`, message });
        expect(turn.reply, `${businessId} :: ${message}`).not.toContain(UNLISTED_MARKER);
        expect(turn.reply, `${businessId} :: ${message}`).not.toMatch(/is not a configured product/i);
        expect(turn.cartSummary, `${businessId} :: ${message}`).toBeFalsy();
      }
    }

    for (const businessId of [namedNull, namedPresent, gradedPresent]) {
      const familyMember = businessId.startsWith("biz_nullable_named") ? "Bamburi Cement 32.5" : "Bamburi 32.5";
      for (const message of ["cement", "How much is cement for construction?", "Do you have cement for construction?"]) {
        const turn = await handleAIFrontDeskTurn({ businessId, conversationId: `${businessId}-cat-${message}`, message });
        expect(turn.reply, `${businessId} :: ${message}`).toContain(familyMember);
      }
    }

    const neutral = await handleAIFrontDeskTurn({ businessId: gradedNull, conversationId: "graded-null-cat", message: "cement" });
    expect(neutral.reply).not.toContain(UNLISTED_MARKER);
    expect(neutral.cartSummary).toBeFalsy();

    for (const businessId of ALL_BUSINESSES) {
      expect(await unavailableInsights(businessId), businessId).toEqual([]);
    }
  });

  it("keeps facility and non-product questions neutral with and without category metadata", async () => {
    for (const businessId of ALL_BUSINESSES) {
      for (const message of FACILITY_CASES) {
        const turn = await handleAIFrontDeskTurn({ businessId, conversationId: `${businessId}-facility-${message}`, message });
        expect(isUnlistedReply(turn.reply), `${businessId} :: ${message} -> ${turn.reply}`).toBe(false);
        expect(turn.reply, `${businessId} :: ${message}`).not.toMatch(/is not a configured product/i);
        expect(turn.cartSummary, `${businessId} :: ${message}`).toBeFalsy();
      }
      expect(await unavailableInsights(businessId), businessId).toEqual([]);
    }
  });

  it("keeps filler + quantity/grade conversational with and without category metadata", async () => {
    for (const businessId of ALL_BUSINESSES) {
      for (const message of FILLER_CASES) {
        const noCart = await handleAIFrontDeskTurn({ businessId, conversationId: `${businessId}-filler-${message}`, message });
        expect(isUnlistedReply(noCart.reply), `${businessId} :: ${message} -> ${noCart.reply}`).toBe(false);
        expect(noCart.cartSummary, `${businessId} :: ${message}`).toBeFalsy();
      }

      for (const message of FILLER_CASES) {
        const conversationId = `${businessId}-live-${message}`;
        await handleAIFrontDeskTurn({ businessId, conversationId, message: "I need 5 bags of Bamburi 32.5." });
        const turn = await handleAIFrontDeskTurn({ businessId, conversationId, message });
        expect(isUnlistedReply(turn.reply), `${businessId} :: ${message} -> ${turn.reply}`).toBe(false);
        for (const line of turn.cartSummary?.lineItems || []) {
          expect(line.name, `${businessId} :: ${message}`).toBe("Bamburi 32.5");
        }
      }

      const insights = await unavailableInsights(businessId);
      expect(insights.map((insight) => insight.subject.toLowerCase()).join(" | "), businessId).not.toMatch(
        /\b(actually|maybe|instead|exactly|please|yes|just|again)\b/,
      );
      expect(insights, businessId).toEqual([]);
    }
  });

  it("keeps the live-cart correction sequence intact in both category states", async () => {
    for (const [present, absent] of GRADED_PAIRS) {
      for (const businessId of [present, absent]) {
        const conversationId = `${businessId}-correction`;
        const first = await handleAIFrontDeskTurn({ businessId, conversationId, message: "I need 5 bags of Bamburi 32.5." });
        expect(first.cartSummary?.lineItems, businessId).toEqual([
          expect.objectContaining({ name: "Bamburi 32.5", quantity: 5, unitPriceKES: 750 }),
        ]);

        const second = await handleAIFrontDeskTurn({ businessId, conversationId, message: "Actually 20 bags." });
        expect(isUnlistedReply(second.reply), `${businessId} -> ${second.reply}`).toBe(false);
        expect(second.cartSummary?.lineItems, businessId).toEqual([
          expect.objectContaining({ name: "Bamburi 32.5", quantity: 20, unitPriceKES: 750 }),
        ]);
        expect(second.cartSummary?.totalKES, businessId).toBe(15000);
      }
    }
    for (const businessId of ALL_BUSINESSES) {
      expect(await unavailableInsights(businessId), businessId).toEqual([]);
    }
  });

  it("keeps active-product re-pinning and genuine ambiguity intact in both category states", async () => {
    for (const [present, absent] of GRADED_PAIRS) {
      for (const businessId of [present, absent]) {
        const pinned = `${businessId}-pinned`;
        await handleAIFrontDeskTurn({ businessId, conversationId: pinned, message: "How much is Bamburi 32.5?" });
        await handleAIFrontDeskTurn({ businessId, conversationId: pinned, message: "How much is Bamburi 42.5?" });
        await handleAIFrontDeskTurn({ businessId, conversationId: pinned, message: "How much is Bamburi 32.5?" });
        const chosen = await handleAIFrontDeskTurn({ businessId, conversationId: pinned, message: "Give me that one." });
        expect(chosen.cartSummary?.lineItems, businessId).toEqual([
          expect.objectContaining({ name: "Bamburi 32.5", quantity: 1, unitPriceKES: 750 }),
        ]);
        expect(chosen.reply.toLowerCase(), businessId).not.toContain("which item");

        const ambiguous = `${businessId}-ambiguous`;
        await handleAIFrontDeskTurn({ businessId, conversationId: ambiguous, message: "How much is Bamburi 32.5?" });
        await handleAIFrontDeskTurn({ businessId, conversationId: ambiguous, message: "How much is Bamburi 42.5?" });
        const ask = await handleAIFrontDeskTurn({ businessId, conversationId: ambiguous, message: "Give me that one." });
        expect(ask.cartSummary, businessId).toBeFalsy();
        expect(ask.reply.toLowerCase(), businessId).toMatch(/which item|which grade/);
      }
    }
  });

  it("keeps delivery continuation and bare delivery references intact in both category states", async () => {
    for (const [present, absent] of GRADED_PAIRS) {
      for (const businessId of [present, absent]) {
        const delivery = `${businessId}-delivery`;
        await handleAIFrontDeskTurn({ businessId, conversationId: delivery, message: "How much is Bamburi 32.5?" });
        await handleAIFrontDeskTurn({ businessId, conversationId: delivery, message: "How much is Bamburi 42.5?" });
        await handleAIFrontDeskTurn({ businessId, conversationId: delivery, message: "How much is Bamburi 32.5?" });
        await handleAIFrontDeskTurn({ businessId, conversationId: delivery, message: "Do you deliver to Syokimau?" });
        const cart = await handleAIFrontDeskTurn({ businessId, conversationId: delivery, message: "I need 20 bags delivered there." });
        expect(cart.cartSummary?.lineItems, businessId).toEqual([
          expect.objectContaining({ name: "Bamburi 32.5", quantity: 20, unitPriceKES: 750 }),
        ]);
        expect(cart.reply, businessId).toContain("Syokimau");
        expect(cart.cartSummary?.deliveryFeeKES, businessId).toBe(500);
        expect(cart.cartSummary?.totalKES, businessId).toBe(15500);
        expect(cart.reply, businessId).toContain("KES 500");
        expect(cart.reply, businessId).toContain("2–3 hours");
        expect(cart.reply, businessId).not.toContain("Bamburi 42.5");

        for (const phrase of ["same place", "same area", "there", "huko"]) {
          const conversationId = `${businessId}-bare-${phrase.replace(/\s+/g, "-")}`;
          await handleAIFrontDeskTurn({ businessId, conversationId, message: "Do you deliver to Syokimau?" });
          const bare = await handleAIFrontDeskTurn({ businessId, conversationId, message: phrase });
          expect(bare.reply.toLowerCase(), `${businessId} :: ${phrase}`).toContain("syokimau");
          expect(bare.reply, `${businessId} :: ${phrase}`).toContain("KES 500");
          expect(bare.reply, `${businessId} :: ${phrase}`).not.toContain(UNLISTED_MARKER);
          expect(bare.cartSummary, `${businessId} :: ${phrase}`).toBeFalsy();
        }
      }
    }
  });

  it("identifies the unlisted item inside a mixed order in both category states", async () => {
    const auditMessage = "I need 5 bags of Bamburi 32.5 and 2 bags of Savannah cement.";
    for (const [present, absent] of GRADED_PAIRS) {
      for (const businessId of [present, absent]) {
        const turn = await handleAIFrontDeskTurn({
          businessId,
          conversationId: `${businessId}-mixed`,
          message: auditMessage,
        });
        expect(turn.cartSummary?.lineItems, businessId).toEqual([
          expect.objectContaining({ name: "Bamburi 32.5", quantity: 5, unitPriceKES: 750 }),
        ]);
        expect(turn.reply, businessId).toContain("5 × Bamburi 32.5");
        // The unlisted item is named as "savannah cement" with and without category metadata.
        expect(turn.reply.toLowerCase(), businessId).toContain("savannah cement");
        expect(turn.reply, businessId).toMatch(/not included in this cart|don't have/i);
        expect(turn.reply, businessId).not.toMatch(/2 × Bamburi|10 × Bamburi/);
        expect(turn.cartSummary?.subtotalKES, businessId).toBe(3750);

        const insights = await unavailableInsights(businessId);
        expect(insights.map((insight) => insight.subject.toLowerCase()).join(" "), businessId).toContain("savannah");
      }
    }

    // Same order shape against the catalogue whose names carry the category noun.
    for (const [present, absent] of NAMED_PAIRS) {
      for (const businessId of [present, absent]) {
        const turn = await handleAIFrontDeskTurn({
          businessId,
          conversationId: `${businessId}-mixed`,
          message: "I need 5 bags of Bamburi Cement 32.5 and 2 bags of Savannah cement.",
        });
        expect(turn.cartSummary?.lineItems, businessId).toEqual([
          expect.objectContaining({ name: "Bamburi Cement 32.5", quantity: 5, unitPriceKES: 750 }),
        ]);
        expect(turn.reply.toLowerCase(), businessId).toContain("savannah cement");
        expect(turn.reply, businessId).toMatch(/not included in this cart|don't have/i);
        expect(turn.reply, businessId).not.toContain(UNLISTED_MARKER);
      }
    }
  });
});

describe("AI grounding — unlisted-product evidence is category-metadata independent", () => {
  const withCategory: CatalogueProduct[] = [
    { id: "p32", name: "Bamburi 32.5", category: "Cement", basePriceKES: 750, isActive: true },
    { id: "p42", name: "Bamburi 42.5", category: "Cement", basePriceKES: 850, isActive: true },
  ];
  const withoutCategory: CatalogueProduct[] = withCategory.map((product) => ({ ...product, category: null }));

  type Frame = "price" | "availability" | "order" | "bare";
  type Case = [string, string, Frame];

  /** Genuine product phrases: the same verdict in both states. */
  const productCases: Case[] = [
    ["Do you have Savannah cement?", "savannah cement", "availability"],
    ["Rhino cement", "rhino cement", "bare"],
    ["Mombasa Cement", "mombasa cement", "bare"],
    ["Ndovu cement", "ndovu cement", "bare"],
    ["Twiga cement", "twiga cement", "bare"],
    ["50kg Savannah cement", "50kg savannah cement", "bare"],
    ["How much is Savannah cement?", "savannah cement", "price"],
    ["I want 10 bags of Savannah cement.", "10 bags of savannah cement", "order"],
    ["How much is Savannah 32.5?", "savannah 32.5", "price"],
    ["Savannah 42.5", "savannah 42.5", "bare"],
    ["Dangote 32.5", "dangote 32.5", "bare"],
    ["bamboo 32.5", "bamboo 32.5", "bare"],
    ["I want 10 bags of Savannah.", "10 bags of savannah", "order"],
    ["42.5 Dangote", "dangote", "bare"],
    ["How much is the pizza?", "pizza", "price"],
  ];

  /** Facilities, conversation and category-level text: still not products, with or without metadata. */
  const nonProductCases: Case[] = [
    ["Do you have wifi?", "wifi", "availability"],
    ["Do you have parking?", "parking", "availability"],
    ["Do you have a website?", "a website", "availability"],
    ["Do you have a physical address?", "a physical address", "availability"],
    ["Do you have a shop in Karen?", "a shop in karen", "availability"],
    ["Do you have a branch in Nairobi?", "a branch in nairobi", "availability"],
    ["Do you sell in Karen?", "in karen", "availability"],
    ["Do you have an account with Equity?", "an account with equity", "availability"],
    ["How much is cement for construction?", "cement for construction", "price"],
    ["I need cement for my site", "cement for my site", "order"],
    // Unknown tokens are not products merely because the catalogue does not carry them (§12).
    ["wifi", "wifi", "bare"],
    ["parking", "parking", "bare"],
    ["website", "website", "bare"],
    ["Nairobi", "nairobi", "bare"],
    ["Karen", "karen", "bare"],
    ["Equity", "equity", "bare"],
    ["address", "address", "bare"],
    ["shop", "shop", "bare"],
    ["branch", "branch", "bare"],
    ["Do you have Nairobi?", "a nairobi", "availability"],
    ["Do you have Karen?", "a karen", "availability"],
    ["Actually 20 bags.", "20 bags", "bare"],
    ["Maybe 42.5.", "42.5", "bare"],
    ["Please 3 pieces.", "3 pieces", "bare"],
    ["Yes 3 pieces.", "3 pieces", "bare"],
    ["Just 20 bags.", "20 bags", "bare"],
    ["Again 3 pieces.", "3 pieces", "bare"],
  ];

  const cases: Case[] = [...productCases, ...nonProductCases];

  const plausible = (message: string, candidate: string, frame: Frame, products: CatalogueProduct[]) =>
    detectUnlistedProductRequest({ message, candidate, frame, products }).plausible;

  it("returns the same plausibility and tokens whether or not category is configured", () => {
    for (const [message, candidate, frame] of cases) {
      const present = detectUnlistedProductRequest({ message, candidate, frame, products: withCategory });
      const absent = detectUnlistedProductRequest({ message, candidate, frame, products: withoutCategory });
      expect(absent.plausible, `${message} (category null) -> ${absent.tokens.join(",")}`).toBe(present.plausible);
      expect(absent.tokens, message).toEqual(present.tokens);
    }
  });

  it("separates genuine product phrases from facilities, conversation and category text in both states", () => {
    for (const products of [withCategory, withoutCategory]) {
      const label = products === withCategory ? "category=Cement" : "category=null";
      for (const [message, candidate, frame] of productCases) {
        expect(plausible(message, candidate, frame, products), `${label} :: ${message}`).toBe(true);
      }
      for (const [message, candidate, frame] of nonProductCases) {
        expect(plausible(message, candidate, frame, products), `${label} :: ${message}`).toBe(false);
      }
    }
  });
});
