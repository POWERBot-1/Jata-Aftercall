/**
 * In-memory database for the Business Hub suites.
 *
 * It builds on the POS fake (`posFakeDb`) — the same tenant-scoped `where` matcher, the same
 * atomic `increment`, the same `$transaction` pass-through — and adds only what the hub needs:
 * nested `items.create` on an order request and the two relations the hub reads back.
 *
 * The unique indexes enforced below mirror the real migration one-for-one, so the duplicate
 * guards the product relies on (one stamp per transaction reference, one payout per reward cycle,
 * one request per idempotency key) fail here exactly as PostgreSQL would.
 */

import { createFakeDb, registerUniqueIndexes, type FakeDb } from "./posFakeDb";

export type BusinessHubSeed = Record<string, Record<string, any>[]>;

/**
 * Seed for the Business Hub suites: two tenants that must never see each other's records.
 *
 * `bizA` (owner `userA`) runs the full hub — catalogue, promotions, loyalty. `bizB` (owner
 * `userB`) is the foreign business every isolation assertion points at.
 */
export function businessHubSeed(): BusinessHubSeed {
  const now = new Date("2026-11-06T09:00:00.000Z");
  const future = new Date("2026-12-31T09:00:00.000Z");
  return {
    user: [
      { id: "userA", name: "Owner A", email: "a@example.com", role: "CUSTOMER", sessionVersion: 0 },
      { id: "userB", name: "Owner B", email: "b@example.com", role: "CUSTOMER", sessionVersion: 0 },
      { id: "staffA", name: "Mary Staff", email: "mary@example.com", role: "CUSTOMER", sessionVersion: 0 },
    ],
    business: [
      {
        id: "bizA", ownerId: "userA", slug: "nyumbani-kitchen", name: "Nyumbani Kitchen",
        category: "Food & Restaurant", status: "ACTIVE", isPublished: true, theme: "clean",
        phone: "0712000000", whatsapp: "0712000000", location: "Nairobi",
      },
      {
        id: "bizB", ownerId: "userB", slug: "mwangi-hardware", name: "Mwangi Hardware",
        category: "Retail & General Shop", status: "ACTIVE", isPublished: true, theme: "clean",
        phone: "0723000000", whatsapp: "0723000000", location: "Kisumu",
      },
      {
        id: "bizC", ownerId: "userA", slug: "kibera-barbers", name: "Kibera Barbers",
        category: "Salon & Barber", status: "ACTIVE", isPublished: true, theme: "clean",
        phone: "0744000000", whatsapp: "0744000000", location: "Nairobi",
      },
    ],
    businessMember: [{ id: "mem_a", businessId: "bizA", userId: "staffA", role: "STAFF" }],
    product: [
      { id: "prod_a1", businessId: "bizA", name: "Chapati", description: "Two pieces", imageUrl: "/chapati.jpg", category: "Main", basePriceKES: 100, variantPriceKES: null, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null, stockStatus: "IN_STOCK", isActive: true, isFeatured: true, sortOrder: 0, quantity: null, minOrder: 1, maxOrder: 20, preOrderAllowed: false, deliveryEligible: true, createdAt: now, updatedAt: now },
      { id: "prod_a2", businessId: "bizA", name: "Pilau", description: "Full plate", imageUrl: null, category: "Main", basePriceKES: 300, variantPriceKES: null, salePriceKES: 250, salePriceStartsAt: new Date("2026-01-01T00:00:00.000Z"), salePriceEndsAt: future, stockStatus: "IN_STOCK", isActive: true, isFeatured: false, sortOrder: 1, quantity: null, minOrder: 1, maxOrder: 20, preOrderAllowed: false, deliveryEligible: true, createdAt: now, updatedAt: now },
      { id: "prod_a3", businessId: "bizA", name: "Secret Recipe", description: "Not listed", imageUrl: null, category: "Main", basePriceKES: 50, variantPriceKES: null, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null, stockStatus: "IN_STOCK", isActive: false, isFeatured: false, sortOrder: 2, quantity: null, minOrder: 1, maxOrder: 20, preOrderAllowed: false, deliveryEligible: true, createdAt: now, updatedAt: now },
      { id: "prod_b1", businessId: "bizB", name: "Cement 50kg", description: null, imageUrl: null, category: "Build", basePriceKES: 900, variantPriceKES: null, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null, stockStatus: "IN_STOCK", isActive: true, isFeatured: true, sortOrder: 0, quantity: null, minOrder: 1, maxOrder: 20, preOrderAllowed: false, deliveryEligible: true, createdAt: now, updatedAt: now },
    ],
    service: [
      { id: "svc_a1", businessId: "bizA", title: "Pilau Combo", description: "Sample menu entry", imageUrl: null, category: "Meals", priceFrom: 650, priceToKES: null, priceLabel: "KES 650", pricingType: "FIXED", isFeatured: true, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now },
      { id: "svc_a2", businessId: "bizA", title: "Event catering", description: "Priced on request", imageUrl: null, category: "Catering", priceFrom: null, priceToKES: null, priceLabel: null, pricingType: "QUOTE", isFeatured: false, isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
      { id: "svc_a3", businessId: "bizA", title: "Closed Sunday special", description: "Withdrawn", imageUrl: null, category: "Meals", priceFrom: 400, priceToKES: null, priceLabel: null, pricingType: "FIXED", isFeatured: false, isActive: false, sortOrder: 2, createdAt: now, updatedAt: now },
      { id: "svc_b1", businessId: "bizB", title: "Cement delivery", description: null, imageUrl: null, category: "Logistics", priceFrom: 1500, priceToKES: null, priceLabel: "From KES 1,500", pricingType: "FIXED", isFeatured: false, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now },
      { id: "svc_c1", businessId: "bizC", title: "Haircut", description: null, imageUrl: null, category: "Hair", priceFrom: 300, priceToKES: null, priceLabel: "KES 300", pricingType: "FIXED", isFeatured: false, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now },
      { id: "svc_c2", businessId: "bizC", title: "Beard trim", description: null, imageUrl: null, category: "Hair", priceFrom: null, priceToKES: null, priceLabel: "From KES 200", pricingType: "FIXED", isFeatured: false, isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
    ],
    subscription: [
      { id: "sub_a", businessId: "bizA", userId: "userA", planId: "plan_149", status: "ACTIVE", startAt: new Date("2026-01-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z"), graceUntil: null, createdAt: now, updatedAt: now },
      { id: "sub_b", businessId: "bizB", userId: "userB", planId: "plan_999", status: "ACTIVE", startAt: new Date("2026-01-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z"), graceUntil: null, createdAt: now, updatedAt: now },
    ],
    planConfig: [
      { id: "plan_149", key: "BUSINESS_PAGE_MONTHLY", name: "Business Page — Monthly", priceKES: 149, durationDays: 30, isActive: true },
      { id: "plan_999", key: "BUSINESS_PAGE_ANNUAL", name: "Business Page — Annual", priceKES: 999, durationDays: 365, isActive: true },
    ],
    payment: [],
    orderRequest: [],
    orderRequestItem: [],
    customerEnquiry: [],
    promotion: [],
    loyaltyProgram: [],
    loyaltyCard: [],
    loyaltyStampEvent: [],
    loyaltyRedemption: [],
    businessHubActivity: [],
    analyticsEvent: [],
    auditEvent: [],
  };
}

/**
 * Compound unique indexes from `prisma/migrations/20261128000000_business_hub_conversion`.
 * These are registered on the shared fake so an insert that would violate one raises `P2002`,
 * exactly as PostgreSQL does — the guard the product depends on is then actually exercised.
 */
const HUB_UNIQUE_INDEXES: Record<string, string[][]> = {
  orderRequest: [["businessId", "requestKey"]],
  customerEnquiry: [["businessId", "requestKey"]],
  loyaltyCard: [["code"]],
  loyaltyStampEvent: [["businessId", "transactionRef"]],
  loyaltyRedemption: [["cardId", "cycleIndex"]],
};

/**
 * Builds the hub database. `createFakeDb` owns the generic filtering; this wrapper adds the
 * nested item write and the two relation reads, then registers the hub's unique indexes.
 */
export function createBusinessHubFakeDb(seed: BusinessHubSeed = businessHubSeed()): FakeDb {
  const fake = createFakeDb(seed as Record<string, any>);

  // Prisma fills `@default(now())` / `@updatedAt` itself; the generic fake does not. Without these
  // timestamps the hub's ISO-serialising mappers throw on every read, so they are applied once
  // here — this is fake-DB plumbing, not product behaviour.
  for (const name of HUB_MODELS) {
    const model = fake.db[name];
    if (!model) continue;
    const create = model.create;
    model.create = async ({ data }: any = {}) => {
      const now = new Date();
      return create({ data: { ...data, createdAt: now, updatedAt: now } });
    };
    const update = model.update;
    model.update = async (args: any = {}) => update({ ...args, data: { ...args.data, updatedAt: new Date() } });
    const upsert = model.upsert;
    model.upsert = async (args: any = {}) => {
      const now = new Date();
      return upsert({
        ...args,
        create: { ...args.create, createdAt: now, updatedAt: now },
        update: { ...args.update, updatedAt: new Date() },
      });
    };
  }

  const orderRequest = fake.db.orderRequest;
  const attachItems = (row: any) => {
    if (!row) return row;
    return { ...row, items: fake.rows("orderRequestItem").filter((item: any) => item.orderRequestId === row.id) };
  };

  const createRequest = orderRequest.create;
  orderRequest.create = async ({ data }: any) => {
    const { items, ...rest } = data ?? {};
    const row = await createRequest({ data: rest });
    for (const item of items?.create ?? []) {
      await fake.db.orderRequestItem.create({ data: { ...item, orderRequestId: row.id } });
    }
    return attachItems(row);
  };
  const findManyRequests = orderRequest.findMany;
  orderRequest.findMany = async (args: any) => (await findManyRequests(args)).map(attachItems);
  const findFirstRequest = orderRequest.findFirst;
  orderRequest.findFirst = async (args: any) => attachItems(await findFirstRequest(args));
  const findUniqueRequest = orderRequest.findUnique;
  orderRequest.findUnique = async (args: any) => attachItems(await findUniqueRequest(args));

  // Loyalty cards are read back with their business for the public (code-only) lookup.
  const loyaltyCard = fake.db.loyaltyCard;
  const findUniqueCard = loyaltyCard.findUnique;
  loyaltyCard.findUnique = async (args: any) => {
    const row = await findUniqueCard(args);
    if (!row) return null;
    return { ...row, business: fake.rows("business").find((entry: any) => entry.id === row.businessId) ?? null };
  };

  // Register the hub's unique indexes so a duplicate insert raises P2002, as PostgreSQL would.
  registerUniqueIndexes(HUB_UNIQUE_INDEXES);

  return fake;
}

const HUB_MODELS = [
  "service",
  "orderRequest",
  "orderRequestItem",
  "customerEnquiry",
  "promotion",
  "loyaltyProgram",
  "loyaltyCard",
  "loyaltyStampEvent",
  "loyaltyRedemption",
  "businessHubActivity",
];

export type { FakeDb };
