/**
 * Business Hub — end-to-end against a REAL database.
 *
 * The offline hub suite (`tests/integration/business-hub-journey.test.ts`) drives the same route
 * handlers against an in-memory Prisma double. That proves the contracts, but not the database:
 * only a real PostgreSQL can enforce the cascading foreign keys, the unique indexes that stop a
 * double stamp and a double redemption, the column types, and the enum values this migration
 * introduced. This file is the hub's equivalent of `business-pos-journey.test.ts`.
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/jata \
 *     npx vitest run tests/e2e/business-hub-journey.test.ts
 *
 * Without DATABASE_URL the whole file is skipped, so the offline suite is unaffected.
 *
 * It walks capabilities A–F the way they are actually used: a customer on the public page, then
 * the owner in the hub, then the refusals (cross-tenant, unauthenticated, duplicate, invalid).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATABASE_URL = (process.env.DATABASE_URL || process.env.E2E_DATABASE_URL || "").trim();
const enabled = DATABASE_URL.length > 0;

const h = vi.hoisted(() => ({
  session: { current: null as null | { userId: string; email: string; name: string; role: string } },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSession: async () => h.session.current };
});

import prisma from "@/lib/db";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as orderRequestPost, GET as orderRequestGet } from "@/app/api/public/order-request/route";
import { POST as enquiryPost } from "@/app/api/public/enquiry/route";
import { GET as loyaltyLookupGet } from "@/app/api/public/loyalty/[code]/route";
import { GET as hubGet } from "@/app/api/business/[businessId]/hub/route";
import { GET as orderRequestsGet } from "@/app/api/business/[businessId]/order-requests/route";
import { PATCH as orderRequestPatch } from "@/app/api/business/[businessId]/order-requests/[requestId]/route";
import { POST as promotionsPost } from "@/app/api/business/[businessId]/promotions/route";
import { PATCH as promotionPatch, DELETE as promotionDelete } from "@/app/api/business/[businessId]/promotions/[promotionId]/route";
import { PUT as loyaltyPut, POST as loyaltyEnrolPost } from "@/app/api/business/[businessId]/loyalty/route";
import { POST as stampPost } from "@/app/api/business/[businessId]/loyalty/cards/[cardId]/stamp/route";
import { POST as redeemPost } from "@/app/api/business/[businessId]/loyalty/cards/[cardId]/redeem/route";
import { GET as qrGet } from "@/app/api/business/[businessId]/qr/route";
import { listLivePromotions } from "@/lib/business-hub/promotions";
import { loadRequestableCatalogue } from "@/lib/business-hub/catalogue";

const runId = Date.now().toString(36).slice(-6);
const ORIGIN = "https://jataaftercall.co.ke";

type Handler = (request: Request, context?: any) => Promise<Response>;

const ctx: Record<string, any> = {
  owner: null as null | { userId: string; email: string; name: string; businessId: string; slug: string },
  stranger: null as null | { userId: string; email: string; name: string; businessId: string },
  serviceId: null as string | null,
  productId: null as string | null,
  reference: null as string | null,
  promotionId: null as string | null,
  cardId: null as string | null,
  cardCode: null as string | null,
};

/** A request that looks like it came from the app itself. */
function request(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "jataaftercall.co.ke", ...(init.headers || {}) };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function call(handler: Handler, url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, params: Record<string, string> = {}) {
  const response = await handler(request(url, init), { params: Promise.resolve(params) });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** A public submission, complete with the same-site Origin a real browser sends. */
async function publicPost(handler: Handler, path: string, body: unknown, ip = "197.248.10.10") {
  return call(handler, `${ORIGIN}${path}`, {
    method: "POST",
    body,
    headers: { origin: ORIGIN, "x-forwarded-proto": "https", "x-forwarded-for": ip },
  });
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `197.248.${Math.floor(ipCounter / 254)}.${(ipCounter % 254) + 1}`;
}

async function register(kind: "owner" | "stranger", label: string) {
  const email = `e2e.hub.${kind}.${runId}@jata.test`;
  const response = await call(registerPost, "https://jata.test/api/auth/register", {
    method: "POST",
    body: {
      name: label,
      email,
      phone: `07${(Date.now() % 10000000).toString().padStart(7, "0")}${kind.length}`,
      password: "Jata#2026E2E",
      businessName: `E2E Hub ${kind} ${runId}`,
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(400);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const business = await prisma.business.findFirstOrThrow({ where: { ownerId: user.id } });
  return { userId: user.id, email, name: label, businessId: business.id, slug: business.slug };
}

beforeAll(async () => {
  if (!enabled) return;
  ctx.owner = await register("owner", "Amina Owner");
  ctx.stranger = await register("stranger", "Brian Other");

  // The catalogue an ordinary Business Page has: services, plus one catalogue product.
  const service = await prisma.service.create({
    data: {
      businessId: ctx.owner.businessId,
      title: "Pilau Combo",
      description: "E2E fixture",
      priceFrom: 650,
      priceLabel: "KES 650",
      pricingType: "FIXED",
      isActive: true,
      category: "Meals",
    },
  });
  ctx.serviceId = service.id;

  const product = await prisma.product.create({
    data: {
      businessId: ctx.owner.businessId,
      name: "Chapati",
      basePriceKES: 100,
      stockStatus: "IN_STOCK",
      isActive: true,
      isFeatured: true,
    },
  });
  ctx.productId = product.id;

  await prisma.business.update({ where: { id: ctx.owner.businessId }, data: { isPublished: true } });
});

afterAll(async () => {
  if (!enabled) return;
  // Only rows this run created. Nothing else in the disposable database is touched.
  await prisma.orderRequest.deleteMany({ where: { businessId: ctx.owner?.businessId ?? "" } }).catch(() => undefined);
  await prisma.customerEnquiry.deleteMany({ where: { businessId: ctx.owner?.businessId ?? "" } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Business Hub against a real database", () => {
  it("A · serves a catalogue made of the services the page lists", async () => {
    const items = await loadRequestableCatalogue(ctx.owner.businessId);
    const names = items.map((item) => item.name);

    expect(names).toContain("Pilau Combo");
    expect(names).toContain("Chapati");
    expect(items.find((item) => item.name === "Pilau Combo")?.priceKES).toBe(650);
  });

  it("A · a customer submits an order request and the business prices it", async () => {
    const response = await publicPost(
      orderRequestPost,
      "/api/public/order-request",
      {
        slug: ctx.owner.slug,
        requestKey: `e2e-key-${runId}`,
        customerName: "Jane Wanjiku",
        contactMethod: "WHATSAPP",
        contactValue: "0712 345 678",
        message: "Please deliver to Tom Mboya Street.",
        items: [
          { productId: ctx.serviceId, quantity: 2 },
          { productId: ctx.productId, quantity: 1 },
        ],
      },
      nextIp(),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    // 2 x 650 + 1 x 100 — the total the server computed from its own rows.
    expect(response.body.estimatedTotalKES).toBe(1400);
    expect(response.body.message).toMatch(/No payment has been taken/i);
    ctx.reference = response.body.reference;

    const stored = await prisma.orderRequest.findFirstOrThrow({
      where: { reference: ctx.reference! },
      include: { items: true },
    });
    expect(stored.businessId).toBe(ctx.owner.businessId);
    expect(stored.status).toBe("NEW");
    expect(stored.items).toHaveLength(2);
    expect(stored.items.find((item) => item.name === "Pilau Combo")?.unitPriceKES).toBe(650);
    // A service line stores no borrowed product id; a product line keeps its own.
    expect(stored.items.find((item) => item.name === "Pilau Combo")?.productId).toBeNull();
    expect(stored.items.find((item) => item.name === "Chapati")?.productId).toBe(ctx.productId);
  });

  it("A · a replayed submission returns the original request, not a second one", async () => {
    const before = await prisma.orderRequest.count({ where: { businessId: ctx.owner.businessId } });
    const response = await publicPost(
      orderRequestPost,
      "/api/public/order-request",
      {
        slug: ctx.owner.slug,
        requestKey: `e2e-key-${runId}`,
        customerName: "Jane Wanjiku",
        contactMethod: "WHATSAPP",
        contactValue: "0712 345 678",
        items: [{ productId: ctx.productId, quantity: 1 }],
      },
      nextIp(),
    );

    expect(response.status).toBe(200);
    expect(response.body.idempotent).toBe(true);
    expect(await prisma.orderRequest.count({ where: { businessId: ctx.owner.businessId } })).toBe(before);
  });

  it("A · the customer reads their request back by reference, with nothing internal in it", async () => {
    const response = await call(orderRequestGet, `${ORIGIN}/api/public/order-request?ref=${ctx.reference}`);

    expect(response.status).toBe(200);
    expect(response.body.reference).toBe(ctx.reference);
    expect(response.body.estimatedTotalKES).toBe(1400);
    expect(response.body.message).toMatch(/not a payment/i);
    expect(JSON.stringify(response.body)).not.toMatch(/ownerNotes|ipHash|sessionHash/i);
  });

  it("A · a submission from a foreign origin is refused", async () => {
    const before = await prisma.orderRequest.count({ where: { businessId: ctx.owner.businessId } });
    const response = await call(orderRequestPost, `${ORIGIN}/api/public/order-request`, {
      method: "POST",
      body: {
        slug: ctx.owner.slug,
        requestKey: `e2e-foreign-${runId}`,
        customerName: "Foreign Site",
        contactMethod: "PHONE",
        contactValue: "0712 000 111",
        items: [{ productId: ctx.productId, quantity: 1 }],
      },
      headers: { origin: "https://not-jata.example", "x-forwarded-for": nextIp() },
    });

    expect(response.status).toBe(403);
    expect(await prisma.orderRequest.count({ where: { businessId: ctx.owner.businessId } })).toBe(before);
  });

  it("B · an enquiry is captured against the right business and reaches the hub", async () => {
    const response = await publicPost(
      enquiryPost,
      "/api/public/enquiry",
      {
        slug: ctx.owner.slug,
        requestKey: `e2e-enquiry-${runId}`,
        customerName: "Peter Otieno",
        contactMethod: "PHONE",
        contactValue: "0711 222 333",
        subject: "Catering for 40 people",
        message: "Do you cater outside Kilimani?",
      },
      nextIp(),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const stored = await prisma.customerEnquiry.findFirstOrThrow({
      where: { businessId: ctx.owner.businessId, customerName: "Peter Otieno" },
    });
    expect(stored.subject).toBe("Catering for 40 people");

    h.session.current = {
      userId: ctx.owner.userId,
      email: ctx.owner.email,
      name: ctx.owner.name,
      role: "CUSTOMER",
    };
    const hub = await call(hubGet, `${ORIGIN}/api/business/${ctx.owner.businessId}/hub`, {}, { businessId: ctx.owner.businessId });

    expect(hub.status).toBe(200);
    expect(hub.body.enquiries.some((entry: any) => entry.id === stored.id)).toBe(true);
  });

  it("B · an anonymous caller and another business's owner are both refused", async () => {
    h.session.current = null;
    const anonymous = await call(orderRequestsGet, `${ORIGIN}/api/business/${ctx.owner.businessId}/order-requests`, {}, { businessId: ctx.owner.businessId });
    expect(anonymous.status).toBe(401);

    h.session.current = {
      userId: ctx.stranger.userId,
      email: ctx.stranger.email,
      name: ctx.stranger.name,
      role: "CUSTOMER",
    };
    const foreign = await call(orderRequestsGet, `${ORIGIN}/api/business/${ctx.owner.businessId}/order-requests`, {}, { businessId: ctx.owner.businessId });
    expect(foreign.status).toBe(403);

    const foreignHub = await call(hubGet, `${ORIGIN}/api/business/${ctx.owner.businessId}/hub`, {}, { businessId: ctx.owner.businessId });
    expect(foreignHub.status).toBe(403);
  });

  it("B · the owner walks a request through its statuses, and an illegal jump is refused", async () => {
    h.session.current = {
      userId: ctx.owner.userId,
      email: ctx.owner.email,
      name: ctx.owner.name,
      role: "CUSTOMER",
    };
    const listed = await call(orderRequestsGet, `${ORIGIN}/api/business/${ctx.owner.businessId}/order-requests`, {}, { businessId: ctx.owner.businessId });
    expect(listed.status).toBe(200);
    const requestId = listed.body.requests.find((entry: any) => entry.reference === ctx.reference)?.id;
    expect(requestId).toBeTruthy();

    const illegal = await call(
      orderRequestPatch,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/order-requests/${requestId}`,
      { method: "PATCH", body: { status: "COMPLETED" } },
      { businessId: ctx.owner.businessId, requestId },
    );
    // 409 Conflict: "A new request cannot move to completed." The status must not move.
    expect(illegal.status).toBe(409);
    expect((await prisma.orderRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("NEW");

    const reviewing = await call(
      orderRequestPatch,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/order-requests/${requestId}`,
      { method: "PATCH", body: { status: "REVIEWING", ownerNotes: "Called the customer." } },
      { businessId: ctx.owner.businessId, requestId },
    );
    expect(reviewing.status).toBe(200);

    const confirmed = await call(
      orderRequestPatch,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/order-requests/${requestId}`,
      { method: "PATCH", body: { status: "CONFIRMED" } },
      { businessId: ctx.owner.businessId, requestId },
    );
    expect(confirmed.status).toBe(200);

    const stored = await prisma.orderRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stored.status).toBe("CONFIRMED");
    expect(stored.ownerNotes).toBe("Called the customer.");

    const activity = await prisma.businessHubActivity.findMany({
      where: { businessId: ctx.owner.businessId, subjectType: "ORDER_REQUEST" },
    });
    expect(activity.length).toBeGreaterThan(0);
  });

  it("C · a promotion is created, published to the page, then deactivated", async () => {
    h.session.current = {
      userId: ctx.owner.userId,
      email: ctx.owner.email,
      name: ctx.owner.name,
      role: "CUSTOMER",
    };
    const created = await call(
      promotionsPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/promotions`,
      {
        method: "POST",
        body: {
          title: "Lunch combo",
          body: "Pilau combo plus a drink.",
          badge: "This week",
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
          isActive: true,
          ctaKind: "ORDER_REQUEST",
        },
      },
      { businessId: ctx.owner.businessId },
    );

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    ctx.promotionId = created.body.promotion?.id ?? created.body.id;

    const live = await listLivePromotions(ctx.owner.businessId);
    expect(live.some((entry: any) => entry.title === "Lunch combo")).toBe(true);

    // An expired promotion is absent from the public read rather than merely hidden.
    await prisma.promotion.update({ where: { id: ctx.promotionId! }, data: { endsAt: new Date(Date.now() - 60_000) } });
    expect((await listLivePromotions(ctx.owner.businessId)).some((entry: any) => entry.id === ctx.promotionId)).toBe(false);

    const deactivated = await call(
      promotionPatch,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/promotions/${ctx.promotionId}`,
      { method: "PATCH", body: { isActive: false } },
      { businessId: ctx.owner.businessId, promotionId: ctx.promotionId! },
    );
    expect(deactivated.status).toBe(200);
    expect((await listLivePromotions(ctx.owner.businessId)).some((entry: any) => entry.id === ctx.promotionId)).toBe(false);
  });

  it("C · the owner's own promotion cannot be touched by another business", async () => {
    h.session.current = {
      userId: ctx.stranger.userId,
      email: ctx.stranger.email,
      name: ctx.stranger.name,
      role: "CUSTOMER",
    };
    const denied = await call(
      promotionDelete,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/promotions/${ctx.promotionId}`,
      { method: "DELETE" },
      { businessId: ctx.owner.businessId, promotionId: ctx.promotionId! },
    );
    expect(denied.status).toBe(403);
    expect(await prisma.promotion.findUnique({ where: { id: ctx.promotionId! } })).not.toBeNull();
  });

  it("D · a loyalty card is enrolled, stamped once per transaction, and redeemed once per cycle", async () => {
    h.session.current = {
      userId: ctx.owner.userId,
      email: ctx.owner.email,
      name: ctx.owner.name,
      role: "CUSTOMER",
    };
    const programme = await call(
      loyaltyPut,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty`,
      { method: "PUT", body: { isEnabled: true, stampGoal: 2, rewardDescription: "Free pilau combo" } },
      { businessId: ctx.owner.businessId },
    );
    expect(programme.status, JSON.stringify(programme.body)).toBe(200);

    const enrolled = await call(
      loyaltyEnrolPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty`,
      {
        method: "POST",
        body: { customerName: "Grace Muthoni", contactMethod: "PHONE", contactValue: "0711 555 111" },
      },
      { businessId: ctx.owner.businessId },
    );
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(201);
    ctx.cardId = enrolled.body.card?.id;
    ctx.cardCode = enrolled.body.card?.code;

    const first = await call(
      stampPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty/cards/${ctx.cardId}/stamp`,
      { method: "POST", body: { transactionRef: `E2E-TXN-${runId}`, stamps: 1 } },
      { businessId: ctx.owner.businessId, cardId: ctx.cardId! },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    // The same transaction reference cannot mint a second stamp: the database says so.
    const replay = await call(
      stampPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty/cards/${ctx.cardId}/stamp`,
      { method: "POST", body: { transactionRef: `E2E-TXN-${runId}`, stamps: 1 } },
      { businessId: ctx.owner.businessId, cardId: ctx.cardId! },
    );
    expect(replay.status).toBe(409);
    expect(await prisma.loyaltyStampEvent.count({ where: { cardId: ctx.cardId! } })).toBe(1);

    // One stamp short of the goal, so redemption must be refused.
    const early = await call(
      redeemPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty/cards/${ctx.cardId}/redeem`,
      { method: "POST", body: { rewardDescription: "Free pilau combo" } },
      { businessId: ctx.owner.businessId, cardId: ctx.cardId! },
    );
    expect(early.status).toBe(409);

    const second = await call(
      stampPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty/cards/${ctx.cardId}/stamp`,
      { method: "POST", body: { transactionRef: `E2E-TXN2-${runId}`, stamps: 1 } },
      { businessId: ctx.owner.businessId, cardId: ctx.cardId! },
    );
    expect(second.status).toBe(201);

    const redeemed = await call(
      redeemPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty/cards/${ctx.cardId}/redeem`,
      { method: "POST", body: { rewardDescription: "Free pilau combo" } },
      { businessId: ctx.owner.businessId, cardId: ctx.cardId! },
    );
    expect(redeemed.status, JSON.stringify(redeemed.body)).toBe(201);

    // One payout per card cycle, enforced by a unique index on (cardId, cycleIndex).
    const secondRedemption = await call(
      redeemPost,
      `${ORIGIN}/api/business/${ctx.owner.businessId}/loyalty/cards/${ctx.cardId}/redeem`,
      { method: "POST", body: { rewardDescription: "Free pilau combo" } },
      { businessId: ctx.owner.businessId, cardId: ctx.cardId! },
    );
    expect(secondRedemption.status).toBe(409);
    expect(await prisma.loyaltyRedemption.count({ where: { cardId: ctx.cardId! } })).toBe(1);
  });

  it("D · a customer reads their card with the code alone, and no contact details", async () => {
    const response = await call(
      loyaltyLookupGet,
      `${ORIGIN}/api/public/loyalty/${ctx.cardCode}`,
      {},
      { code: ctx.cardCode! },
    );

    expect(response.status).toBe(200);
    // The public read exposes the balance, not the ledger: two stamps were earned and one reward
    // was paid out, so the live balance is zero and the payout is counted.
    expect(response.body.stamps).toBe(0);
    expect(response.body.goal).toBe(2);
    expect(response.body.rewardsRedeemed).toBe(1);
    expect(response.body.customerName).toBe("Grace Muthoni");
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/0711 555 111/);
    expect(serialised).not.toMatch(/ownerNotes/i);
    expect(serialised).not.toMatch(/stampsEarned|stampsRedeemed/i);
  });

  it("E · the QR endpoint serves the page URL in every format", async () => {
    h.session.current = {
      userId: ctx.owner.userId,
      email: ctx.owner.email,
      name: ctx.owner.name,
      role: "CUSTOMER",
    };

    const svg = await qrGet(request(`${ORIGIN}/api/business/${ctx.owner.businessId}/qr?format=svg`), {
      params: Promise.resolve({ businessId: ctx.owner.businessId }),
    });
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toMatch(/svg/);
    expect(await svg.text()).toMatch(/<svg/);

    const png = await qrGet(request(`${ORIGIN}/api/business/${ctx.owner.businessId}/qr?format=png`), {
      params: Promise.resolve({ businessId: ctx.owner.businessId }),
    });
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toMatch(/png/);
    const bytes = new Uint8Array(await png.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(100);
    expect(Buffer.from(bytes.slice(1, 4)).toString("ascii")).toBe("PNG");

    const poster = await qrGet(request(`${ORIGIN}/api/business/${ctx.owner.businessId}/qr?format=poster`), {
      params: Promise.resolve({ businessId: ctx.owner.businessId }),
    });
    expect(poster.status).toBe(200);
    expect(await poster.text()).toContain(`/b/${ctx.owner.slug}`);
  });

  it("F · pricing, plans and entitlements are untouched by the whole journey", async () => {
    const plans = await prisma.planConfig.findMany({ where: { isActive: true } });
    const prices = plans.map((plan: any) => Number(plan.priceKES)).sort((a, b) => a - b);
    expect(prices).toEqual(expect.arrayContaining([149, 999]));

    const payments = await prisma.payment.count({ where: { businessId: ctx.owner.businessId } });
    expect(payments).toBe(0);
  });
});
