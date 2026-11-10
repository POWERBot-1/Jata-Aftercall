/**
 * Business Hub — route-level journey (§A–§E, acceptance tests 1–12).
 *
 * This suite calls the real route handlers — the code a browser reaches — against the in-memory
 * database, so the whole request pipeline is exercised: rate limit → origin check → body parse →
 * tenant derivation → role check → validation → server-side pricing → write → JSON contract.
 *
 * The point of the file is the refusals. A cross-tenant request, a duplicate stamp, a double
 * redemption and an expired promotion must each fail in a way the caller can act on, with nothing
 * written behind them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as any }));

vi.mock("@/lib/db", async () => {
  const { createBusinessHubFakeDb, businessHubSeed } = await import("@/tests/helpers/businessHubFakeDb");
  const fake = createBusinessHubFakeDb(businessHubSeed());
  (globalThis as any).__hubFake = fake;
  return { default: fake.db };
});

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
  requireSession: vi.fn(async () => mocks.session),
  createSession: vi.fn(async () => "token"),
  verifySession: vi.fn(async () => mocks.session),
  setSessionCookie: vi.fn(async () => undefined),
  clearSessionCookie: vi.fn(async () => undefined),
  hashPassword: vi.fn(async () => "hash"),
  verifyPassword: vi.fn(async () => true),
  getSessionFromToken: vi.fn(async () => mocks.session),
  getCurrentUser: vi.fn(async () => mocks.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

import { POST as createOrderRequest } from "@/app/api/public/order-request/route";
import { GET as readOrderRequest } from "@/app/api/public/order-request/route";
import { POST as createEnquiry } from "@/app/api/public/enquiry/route";
import { GET as readLoyaltyCard } from "@/app/api/public/loyalty/[code]/route";
import { GET as listOrderRequests } from "@/app/api/business/[businessId]/order-requests/route";
import { PATCH as patchOrderRequest } from "@/app/api/business/[businessId]/order-requests/[requestId]/route";
import { GET as listEnquiries } from "@/app/api/business/[businessId]/enquiries/route";
import { PATCH as patchEnquiry } from "@/app/api/business/[businessId]/enquiries/[enquiryId]/route";
import { GET as listPromotions, POST as createPromotion } from "@/app/api/business/[businessId]/promotions/route";
import { PATCH as patchPromotion, DELETE as deletePromotion } from "@/app/api/business/[businessId]/promotions/[promotionId]/route";
import { GET as readLoyalty, PUT as saveLoyaltyProgram, POST as enrolCard } from "@/app/api/business/[businessId]/loyalty/route";
import { POST as awardStamp } from "@/app/api/business/[businessId]/loyalty/cards/[cardId]/stamp/route";
import { POST as redeemReward } from "@/app/api/business/[businessId]/loyalty/cards/[cardId]/redeem/route";
import { GET as qrDownload } from "@/app/api/business/[businessId]/qr/route";

import { listLivePromotions } from "@/lib/business-hub/promotions";
import { inflateSync } from "node:zlib";

type FakeDb = import("@/tests/helpers/posFakeDb").FakeDb;
const fake = () => (globalThis as any).__hubFake as FakeDb;
const rows = (name: string) => fake().rows(name);

const OWNER_A = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const OWNER_B = { userId: "userB", email: "b@example.com", role: "CUSTOMER", name: "Owner B" };
const STAFF_A = { userId: "staffA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Staff" };

const ORIGIN = "https://jataaftercall.co.ke";

/** A request that looks like it came from the business's own page. */
function pageRequest(body: unknown, init: { ip?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "jataaftercall.co.ke",
    "x-forwarded-proto": "https",
  };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  headers["x-forwarded-for"] = init.ip ?? "197.248.1.1";
  return new Request(`${ORIGIN}/api/public/order-request`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as Request;
}

function ownerRequest(method: string, url: string, body?: unknown, session: any = OWNER_A) {
  mocks.session = session;
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json", host: "jataaftercall.co.ke" } : { host: "jataaftercall.co.ke" },
    body: body ? JSON.stringify(body) : undefined,
  }) as Request;
}

// The limiter's buckets are module state for the whole file, so this counter is never reset:
// every submission in the journey must look like a different customer on a different connection.
let ipCounter = 0;
/** A fresh client IP per submission so the per-IP rate limiter never throttles the journey. */
function nextIp(): string {
  ipCounter += 1;
  return `197.248.${Math.floor(ipCounter / 254)}.${(ipCounter % 254) + 1}`;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://jataaftercall.co.ke");
  mocks.session = OWNER_A;
  fake().reset();
  mocks.session = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  mocks.session = null;
});

// ── A. Instant order requests ────────────────────────────────────────────────────────────────

describe("instant order requests", () => {
  it("accepts several products with quantities and prices every line server-side", async () => {
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "nyumbani-kitchen",
          requestKey: "key-1",
          customerName: "Jane Wanjiku",
          contactMethod: "WHATSAPP",
          contactValue: "0712 345 678",
          message: "Please deliver to Tom Mboya Street.",
          items: [
            { productId: "prod_a1", quantity: 2 },
            // On sale, so the server must charge 250, not the 300 list price.
            { productId: "prod_a2", quantity: 1 },
          ],
        },
        { ip: nextIp() },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.received).toBe(true);
    expect(data.reference).toMatch(/^JATA-REQ-\d{8}-[A-Z0-9]{6}$/);
    // 2 × 100 + 1 × 250 — proof the estimate came from the catalogue, not from the client.
    expect(data.estimatedTotalKES).toBe(450);
    expect(data.message).toMatch(/No payment has been taken/i);

    const stored = rows("orderRequest").find((row: any) => row.reference === data.reference);
    expect(stored.businessId).toBe("bizA");
    expect(stored.status).toBe("NEW");
    const items = rows("orderRequestItem").filter((row: any) => row.orderRequestId === stored.id);
    expect(items).toHaveLength(2);
    expect(items.find((item: any) => item.productId === "prod_a2").unitPriceKES).toBe(250);
  });

  it("refuses a product from another business and an inactive product", async () => {
    const foreign = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-f", customerName: "Peter", contactMethod: "PHONE", contactValue: "0723000000", items: [{ productId: "prod_b1", quantity: 1 }] },
        { ip: nextIp() },
      ),
    );
    expect(foreign.status).toBe(400);

    const inactive = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-i", customerName: "Peter", contactMethod: "PHONE", contactValue: "0723000000", items: [{ productId: "prod_a3", quantity: 1 }] },
        { ip: nextIp() },
      ),
    );
    expect(inactive.status).toBe(400);
    expect(rows("orderRequest")).toHaveLength(0);
  });

  it("ignores a client-supplied price (server pricing is authoritative)", async () => {
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "nyumbani-kitchen",
          requestKey: "key-price",
          customerName: "Cheat Attempt",
          contactMethod: "PHONE",
          contactValue: "0712000000",
          items: [{ productId: "prod_a1", quantity: 1, unitPriceKES: 1, priceKES: 1 }],
        },
        { ip: nextIp() },
      ),
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.estimatedTotalKES).toBe(100);
  });

  it("is idempotent on the request key — a double tap creates one request", async () => {
    const body = {
      slug: "nyumbani-kitchen",
      requestKey: "key-double",
      customerName: "Jane Wanjiku",
      contactMethod: "PHONE",
      contactValue: "0712000000",
      items: [{ productId: "prod_a1", quantity: 1 }],
    };
    const first = await createOrderRequest(pageRequest(body, { ip: nextIp() }));
    const second = await createOrderRequest(pageRequest(body, { ip: nextIp() }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).idempotent).toBe(true);
    expect(rows("orderRequest")).toHaveLength(1);
  });

  it("refuses a submission from a foreign origin", async () => {
    const response = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-origin", customerName: "Spam", contactMethod: "PHONE", contactValue: "0712000000", items: [{ productId: "prod_a1", quantity: 1 }] },
        { ip: nextIp(), origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("silently accepts a honeypot submission without writing anything", async () => {
    const response = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-bot", website: "http://spam.example", customerName: "Bot", contactMethod: "PHONE", contactValue: "0712000000", items: [{ productId: "prod_a1", quantity: 1 }] },
        { ip: nextIp() },
      ),
    );
    expect(response.status).toBe(202);
    expect(rows("orderRequest")).toHaveLength(0);
  });

  it("lets a customer read their own request back by reference, without owner notes", async () => {
    const created = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-read", customerName: "Jane Wanjiku", contactMethod: "PHONE", contactValue: "0712000000", items: [{ productId: "prod_a1", quantity: 3 }] },
        { ip: nextIp() },
      ),
    );
    const reference = (await created.json()).reference;

    const response = await readOrderRequest(new Request(`${ORIGIN}/api/public/order-request?ref=${reference}`) as Request);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.status).toBe("NEW");
    expect(data.items[0].quantity).toBe(3);
    // Owner-only fields must never reach a public caller.
    expect(JSON.stringify(data)).not.toContain("ownerNotes");
    expect(JSON.stringify(data)).not.toContain("0712000000");
  });
});

// ── A2. Services: the catalogue an ordinary Business Page actually lists ──────────────────────
//
// The public page shows a business's `Service` rows under "Services and products", and that is
// the only catalogue most KES149 Business Page owners have — the `Product` catalogue belongs to
// the Interactive Business experience. Before this change a business with services but no
// products could not take an order request at all, so the capability was invisible in production.

describe("order requests for the services the page lists", () => {
  it("accepts a service line, priced from the service row, inventing no product id", async () => {
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "nyumbani-kitchen",
          requestKey: "key-service-1",
          customerName: "Peter Otieno",
          contactMethod: "PHONE",
          contactValue: "0712 999 111",
          items: [{ productId: "svc_a1", quantity: 2 }],
        },
        { ip: nextIp() },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    // 2 x 650, taken from the service row the page quoted — never from the client.
    expect(data.estimatedTotalKES).toBe(1300);

    const stored = rows("orderRequest").find((row: any) => row.reference === data.reference);
    const items = rows("orderRequestItem").filter((row: any) => row.orderRequestId === stored.id);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Pilau Combo");
    expect(items[0].unitPriceKES).toBe(650);
    expect(items[0].lineTotalKES).toBe(1300);
    // A service is not a catalogue product: the line stores no product id rather than borrowing one.
    expect(items[0].productId).toBeNull();
    expect(items[0].businessId).toBe("bizA");
  });

  it("accepts a quote-only service without claiming a price", async () => {
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "nyumbani-kitchen",
          requestKey: "key-service-2",
          customerName: "Grace Muthoni",
          contactMethod: "EMAIL",
          contactValue: "grace@example.com",
          items: [{ productId: "svc_a2", quantity: 1 }],
        },
        { ip: nextIp() },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.estimatedTotalKES).toBe(0);

    const stored = rows("orderRequest").find((row: any) => row.reference === data.reference);
    const items = rows("orderRequestItem").filter((row: any) => row.orderRequestId === stored.id);
    expect(items[0].name).toBe("Event catering");
    expect(items[0].unitPriceKES).toBe(0);
  });

  it("refuses a service the business has withdrawn, and writes nothing", async () => {
    const before = rows("orderRequest").length;
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "nyumbani-kitchen",
          requestKey: "key-service-3",
          customerName: "Samuel Kiptoo",
          contactMethod: "PHONE",
          contactValue: "0711 222 333",
          items: [{ productId: "svc_a3", quantity: 1 }],
        },
        { ip: nextIp() },
      ),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no longer available/i);
    expect(rows("orderRequest")).toHaveLength(before);
  });

  it("refuses another business's service — a service id is not a key into someone else's page", async () => {
    const before = rows("orderRequest").length;
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "nyumbani-kitchen",
          requestKey: "key-service-4",
          customerName: "Amina Hassan",
          contactMethod: "PHONE",
          contactValue: "0710 111 222",
          items: [{ productId: "svc_b1", quantity: 1 }],
        },
        { ip: nextIp() },
      ),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no longer available/i);
    expect(rows("orderRequest")).toHaveLength(before);
  });

  it("serves a business that has services but no catalogue products at all", async () => {
    const response = await createOrderRequest(
      pageRequest(
        {
          slug: "kibera-barbers",
          requestKey: "key-service-5",
          customerName: "Brian Kimani",
          contactMethod: "WHATSAPP",
          contactValue: "0722 333 444",
          // 300 from `priceFrom`, 200 parsed from the free-text "From KES 200" label.
          items: [
            { productId: "svc_c1", quantity: 1 },
            { productId: "svc_c2", quantity: 2 },
          ],
        },
        { ip: nextIp() },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.estimatedTotalKES).toBe(700);

    const stored = rows("orderRequest").find((row: any) => row.reference === data.reference);
    expect(stored.businessId).toBe("bizC");
  });
});

// ── B. Smart Customer Hub ────────────────────────────────────────────────────────────────────

describe("smart customer hub", () => {
  async function seedRequest() {
    const response = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-hub", customerName: "Jane Wanjiku", contactMethod: "WHATSAPP", contactValue: "0712345678", items: [{ productId: "prod_a1", quantity: 2 }] },
        { ip: nextIp() },
      ),
    );
    return rows("orderRequest")[0];
  }

  it("shows the request to its own business and moves it through the workflow", async () => {
    const record = await seedRequest();

    const list = await listOrderRequests(
      ownerRequest("GET", `${ORIGIN}/api/business/bizA/order-requests`) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    expect(list.status).toBe(200);
    expect((await list.json()).requests).toHaveLength(1);

    const reviewing = await patchOrderRequest(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/order-requests/${record.id}`, { status: "REVIEWING" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", requestId: record.id }) } as any,
    );
    expect(reviewing.status).toBe(200);
    expect((await reviewing.json()).request.status).toBe("REVIEWING");

    const confirmed = await patchOrderRequest(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/order-requests/${record.id}`, { status: "CONFIRMED", notes: "Called the customer." }) as Request,
      { params: Promise.resolve({ businessId: "bizA", requestId: record.id }) } as any,
    );
    expect(confirmed.status).toBe(200);

    const stored = rows("orderRequest").find((row: any) => row.id === record.id);
    expect(stored.status).toBe("CONFIRMED");
    expect(stored.ownerNotes).toBe("Called the customer.");
    expect(rows("businessHubActivity").some((row: any) => row.subjectId === record.id && row.kind === "STATUS_CHANGED")).toBe(true);
  });

  it("refuses an illegal status transition (COMPLETED is final)", async () => {
    const record = await seedRequest();
    const confirmed = await patchOrderRequest(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/order-requests/${record.id}`, { status: "CONFIRMED" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", requestId: record.id }) } as any,
    );
    expect(confirmed.status).toBe(200);

    const completed = await patchOrderRequest(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/order-requests/${record.id}`, { status: "COMPLETED" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", requestId: record.id }) } as any,
    );
    expect(completed.status).toBe(200);
    expect(rows("orderRequest")[0].status).toBe("COMPLETED");

    const reopened = await patchOrderRequest(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/order-requests/${record.id}`, { status: "NEW" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", requestId: record.id }) } as any,
    );
    expect(reopened.status).toBe(409);
    expect(rows("orderRequest")[0].status).toBe("COMPLETED");
  });

  it("records and manages a customer enquiry", async () => {
    const created = await createEnquiry(
      pageRequest({ slug: "nyumbani-kitchen", requestKey: "enq-1", customerName: "Peter Otieno", contactMethod: "EMAIL", contactValue: "peter@example.com", subject: "Catering", message: "Do you cater for 50 people?" }, { ip: nextIp() }),
    );
    expect(created.status).toBe(201);
    const record = rows("customerEnquiry")[0];

    const listed = await listEnquiries(ownerRequest("GET", `${ORIGIN}/api/business/bizA/enquiries`) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    expect((await listed.json()).enquiries).toHaveLength(1);

    const updated = await patchEnquiry(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/enquiries/${record.id}`, { status: "CONTACTED" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", enquiryId: record.id }) } as any,
    );
    expect(updated.status).toBe(200);
    expect(rows("customerEnquiry")[0].status).toBe("CONTACTED");
  });

  it("lets a staff member work the hub but refuses an anonymous caller", async () => {
    const record = await seedRequest();
    const staff = await listOrderRequests(ownerRequest("GET", `${ORIGIN}/api/business/bizA/order-requests`, undefined, STAFF_A) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    expect(staff.status).toBe(200);

    const anonymous = await listOrderRequests(ownerRequest("GET", `${ORIGIN}/api/business/bizA/order-requests`, undefined, null) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    expect(anonymous.status).toBe(401);
    expect(record.status).toBe("NEW");
  });
});

// ── Cross-tenant isolation (acceptance test 12) ──────────────────────────────────────────────

describe("tenant isolation", () => {
  it("business B cannot read, update or delete business A's records", async () => {
    const created = await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-iso", customerName: "Jane Wanjiku", contactMethod: "PHONE", contactValue: "0712000000", items: [{ productId: "prod_a1", quantity: 1 }] },
        { ip: nextIp() },
      ),
    );
    const record = rows("orderRequest")[0];
    expect(created.status).toBe(201);

    const read = await listOrderRequests(ownerRequest("GET", `${ORIGIN}/api/business/bizA/order-requests`, undefined, OWNER_B) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    expect(read.status).toBe(403);

    const update = await patchOrderRequest(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/order-requests/${record.id}`, { status: "CANCELLED" }, OWNER_B) as Request,
      { params: Promise.resolve({ businessId: "bizA", requestId: record.id }) } as any,
    );
    expect(update.status).toBe(403);
    expect(rows("orderRequest")[0].status).toBe("NEW");

    const promotion = await createPromotion(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/promotions`, { title: "A-only offer", startsAt: "2026-11-01T09:00", endsAt: "2026-12-01T09:00" }, OWNER_B) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    expect(promotion.status).toBe(403);
    expect(rows("promotion")).toHaveLength(0);

    const qr = await qrDownload(ownerRequest("GET", `${ORIGIN}/api/business/bizA/qr`, undefined, OWNER_B) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    expect(qr.status).toBe(403);
  });

  it("the hub API never returns another tenant's customers to its own owner", async () => {
    await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-a", customerName: "A customer", contactMethod: "PHONE", contactValue: "0712000000", items: [{ productId: "prod_a1", quantity: 1 }] },
        { ip: nextIp() },
      ),
    );
    await createOrderRequest(
      pageRequest(
        { slug: "mwangi-hardware", requestKey: "key-b", customerName: "B customer", contactMethod: "PHONE", contactValue: "0723000000", items: [{ productId: "prod_b1", quantity: 1 }] },
        { ip: nextIp() },
      ),
    );

    const list = await listOrderRequests(ownerRequest("GET", `${ORIGIN}/api/business/bizB/order-requests`, undefined, OWNER_B) as Request, {
      params: Promise.resolve({ businessId: "bizB" }),
    } as any);
    const data = await list.json();
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0].customerName).toBe("B customer");
    expect(JSON.stringify(data)).not.toContain("A customer");
  });
});

// ── Subscription regression (acceptance test 13) ─────────────────────────────────────────────

describe("subscription regression", () => {
  it("leaves plans, subscriptions, payments and entitlements untouched through a full journey", async () => {
    const before = {
      plans: rows("planConfig").map((row: any) => ({ ...row })),
      subscriptions: rows("subscription").map((row: any) => ({ ...row })),
      payments: rows("payment").map((row: any) => ({ ...row })),
    };

    // A customer orders, an owner answers, a promotion runs, a stamp is awarded and redeemed.
    await createOrderRequest(
      pageRequest(
        { slug: "nyumbani-kitchen", requestKey: "key-sub", customerName: "Jane Wanjiku", contactMethod: "PHONE", contactValue: "0712000000", items: [{ productId: "prod_a1", quantity: 2 }] },
        { ip: nextIp() },
      ),
    );
    await createEnquiry(
      pageRequest({ slug: "nyumbani-kitchen", requestKey: "enq-sub", customerName: "Peter", contactMethod: "PHONE", contactValue: "0722000000", message: "Do you deliver?" }, { ip: nextIp() }),
    );
    await createPromotion(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/promotions`, { title: "Combo Friday", startsAt: "2026-11-01T09:00", endsAt: "2026-12-01T09:00" }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    await saveLoyaltyProgram(
      ownerRequest("PUT", `${ORIGIN}/api/business/bizA/loyalty`, { stampGoal: 2, maxStampsPerVisit: 1, rewardDescription: "Free chapati", isEnabled: true }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    const card = (await (
      await enrolCard(
        ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty`, { customerName: "Jane Wanjiku", contactMethod: "PHONE", contactValue: "0712345678" }) as Request,
        { params: Promise.resolve({ businessId: "bizA" }) } as any,
      )
    ).json()).card;
    // Two verified transactions fill the card; one stamp is not enough to pay out.
    for (const reference of ["sub-1", "sub-2"]) {
      await awardStamp(
        ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/stamp`, { transactionRef: reference }) as Request,
        { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
      );
    }
    await redeemReward(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/redeem`, {}) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );

    expect(rows("planConfig")).toEqual(before.plans);
    expect(rows("subscription")).toEqual(before.subscriptions);
    expect(rows("payment")).toEqual(before.payments);
    // The KES149 monthly and KES999 annual plans are still exactly those prices.
    const prices = rows("planConfig").map((row: any) => row.priceKES).sort((a: number, b: number) => a - b);
    expect(prices).toEqual([149, 999]);
    // And the hub wrote only hub tables.
    expect(rows("orderRequest")).toHaveLength(1);
    expect(rows("loyaltyRedemption")).toHaveLength(1);
  });
});

// ── C. Promotional Spotlight ─────────────────────────────────────────────────────────────────

describe("promotional spotlight", () => {
  it("publishes a promotion, then stops presenting it as live once it expires", async () => {
    vi.setSystemTime(new Date("2026-11-05T10:00:00.000Z"));
    const created = await createPromotion(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/promotions`, {
        title: "Weekend combo",
        subtitle: "Two plates for KES 900",
        startsAt: "2026-11-01T09:00",
        endsAt: "2026-11-08T18:00",
        ctaKind: "ORDER_REQUEST",
        ctaLabel: "Order now",
      }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    expect(created.status).toBe(201);
    const promotion = rows("promotion")[0];
    // "2026-11-01T09:00" Nairobi is UTC+3, so 06:00Z.
    expect(promotion.startsAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");

    const live = await listLivePromotions("bizA", new Date("2026-11-05T10:00:00.000Z"));
    expect(live).toHaveLength(1);
    expect(live[0].isLive).toBe(true);

    // One minute past the end time: expired, and absent from the public list.
    vi.setSystemTime(new Date("2026-11-08T15:01:00.000Z"));
    const afterEnd = await listLivePromotions("bizA");
    expect(afterEnd).toHaveLength(0);
    const all = await listPromotions(ownerRequest("GET", `${ORIGIN}/api/business/bizA/promotions`) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    const body = await all.json();
    expect(body.promotions[0].state).toBe("EXPIRED");
    expect(body.promotions[0].isLive).toBe(false);
  });

  it("pauses a promotion without deleting it, and reports it as paused", async () => {
    vi.setSystemTime(new Date("2026-11-05T10:00:00.000Z"));
    const created = await createPromotion(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/promotions`, { title: "Pausable", startsAt: "2026-11-01T09:00", endsAt: "2026-12-01T09:00" }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    const id = (await created.json()).promotion.id;

    const paused = await patchPromotion(
      ownerRequest("PATCH", `${ORIGIN}/api/business/bizA/promotions/${id}`, { isActive: false }) as Request,
      { params: Promise.resolve({ businessId: "bizA", promotionId: id }) } as any,
    );
    expect(paused.status).toBe(200);
    expect((await listLivePromotions("bizA")).length).toBe(0);

    const deleted = await deletePromotion(ownerRequest("DELETE", `${ORIGIN}/api/business/bizA/promotions/${id}`) as Request, {
      params: Promise.resolve({ businessId: "bizA", promotionId: id }),
    } as any);
    expect(deleted.status).toBe(200);
    expect(rows("promotion")).toHaveLength(0);
  });

  it("refuses an inverted window and a title that is too short", async () => {
    const inverted = await createPromotion(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/promotions`, { title: "Bad window", startsAt: "2026-12-01T09:00", endsAt: "2026-11-01T09:00" }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    expect(inverted.status).toBe(400);

    const short = await createPromotion(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/promotions`, { title: "ab", startsAt: "2026-11-01T09:00", endsAt: "2026-12-01T09:00" }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    expect(short.status).toBe(400);
    expect(rows("promotion")).toHaveLength(0);
  });
});

// ── D. Digital loyalty card ──────────────────────────────────────────────────────────────────

describe("digital loyalty card", () => {
  async function seedCard(goal = 3) {
    await saveLoyaltyProgram(
      ownerRequest("PUT", `${ORIGIN}/api/business/bizA/loyalty`, { stampGoal: goal, maxStampsPerVisit: 1, rewardDescription: "Free chapati", isEnabled: true }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    const response = await enrolCard(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty`, { customerName: "Jane Wanjiku", contactMethod: "PHONE", contactValue: "0712345678" }) as Request,
      { params: Promise.resolve({ businessId: "bizA" }) } as any,
    );
    return (await response.json()).card;
  }

  it("awards a stamp only after owner verification, and never twice for one transaction", async () => {
    const card = await seedCard();

    const first = await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/stamp`, { transactionRef: "receipt-1042" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );
    expect(first.status).toBe(201);
    expect(rows("loyaltyCard")[0].stampsEarned).toBe(1);

    const replay = await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/stamp`, { transactionRef: " receipt-1042 " }) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );
    expect(replay.status).toBe(409);
    expect(rows("loyaltyCard")[0].stampsEarned).toBe(1);
    expect(rows("loyaltyStampEvent")).toHaveLength(1);
    expect((await replay.json()).error).toMatch(/already stamped/i);
  });

  it("separates transactions by business, so the same receipt can exist in another shop", async () => {
    await saveLoyaltyProgram(
      ownerRequest("PUT", `${ORIGIN}/api/business/bizB/loyalty`, { stampGoal: 5, maxStampsPerVisit: 1, rewardDescription: "Free gloves", isEnabled: true }, OWNER_B) as Request,
      { params: Promise.resolve({ businessId: "bizB" }) } as any,
    );
    const cardB = await (
      await enrolCard(
        ownerRequest("POST", `${ORIGIN}/api/business/bizB/loyalty`, { customerName: "Peter Otieno", contactMethod: "PHONE", contactValue: "0723111111" }, OWNER_B) as Request,
        { params: Promise.resolve({ businessId: "bizB" }) } as any,
      )
    ).json();

    const cardA = await seedCard();
    await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${cardA.id}/stamp`, { transactionRef: "receipt-1042" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: cardA.id }) } as any,
    );
    const other = await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizB/loyalty/cards/${cardB.card.id}/stamp`, { transactionRef: "receipt-1042" }, OWNER_B) as Request,
      { params: Promise.resolve({ businessId: "bizB", cardId: cardB.card.id }) } as any,
    );
    expect(other.status).toBe(201);
  });

  it("redeems a full card once and refuses a second payout for the same stamps", async () => {
    const card = await seedCard(2);
    for (const reference of ["r-1", "r-2"]) {
      await awardStamp(
        ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/stamp`, { transactionRef: reference }) as Request,
        { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
      );
    }

    const redeemed = await redeemReward(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/redeem`, {}) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );
    expect(redeemed.status).toBe(201);
    expect(rows("loyaltyCard")[0].stampsRedeemed).toBe(2);

    const again = await redeemReward(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/redeem`, {}) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );
    expect(again.status).toBe(409);
    expect(rows("loyaltyRedemption")).toHaveLength(1);
  });

  it("refuses redemption before the card is full", async () => {
    const card = await seedCard(3);
    await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/stamp`, { transactionRef: "r-1" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );
    const early = await redeemReward(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/redeem`, {}) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );
    expect(early.status).toBe(409);
    expect((await early.json()).error).toMatch(/more stamp/i);
  });

  it("lets a customer read progress with their card code — and nothing else about them", async () => {
    const card = await seedCard(4);
    await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizA/loyalty/cards/${card.id}/stamp`, { transactionRef: "r-1" }) as Request,
      { params: Promise.resolve({ businessId: "bizA", cardId: card.id }) } as any,
    );

    const response = await readLoyaltyCard(new Request(`${ORIGIN}/api/public/loyalty/${card.code}`) as Request, {
      params: Promise.resolve({ code: card.code }),
    } as any);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stamps).toBe(1);
    expect(data.goal).toBe(4);
    expect(data.remaining).toBe(3);
    expect(data.rewardDescription).toBe("Free chapati");
    // The customer's contact value and any owner note must never be exposed by a code lookup.
    expect(JSON.stringify(data)).not.toContain("0712345678");
    expect(JSON.stringify(data)).not.toContain("ownerNotes");

    const missing = await readLoyaltyCard(new Request(`${ORIGIN}/api/public/loyalty/NOTACODE`) as Request, {
      params: Promise.resolve({ code: "NOTACODE" }),
    } as any);
    expect(missing.status).toBe(404);
  });

  it("refuses a stamp on a card from another business", async () => {
    const card = await seedCard();
    const response = await awardStamp(
      ownerRequest("POST", `${ORIGIN}/api/business/bizB/loyalty/cards/${card.id}/stamp`, { transactionRef: "r-x" }, OWNER_B) as Request,
      { params: Promise.resolve({ businessId: "bizB", cardId: card.id }) } as any,
    );
    expect(response.status).toBe(404);
    expect(rows("loyaltyStampEvent")).toHaveLength(0);
  });
});

// ── E. Business QR identity ──────────────────────────────────────────────────────────────────

describe("business QR identity", () => {
  it("serves a PNG that decodes to the business's public page URL", async () => {
    const response = await qrDownload(ownerRequest("GET", `${ORIGIN}/api/business/bizA/qr?format=png`) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG signature

    const { width, height, pixels } = decodePng(buffer);
    const jsQR = (await import("jsqr")).default;
    const decoded = jsQR(pixels, width, height);
    expect(decoded?.data).toBe("https://jataaftercall.co.ke/b/nyumbani-kitchen");
  });

  it("serves an SVG that embeds the same canonical URL and no private data", async () => {
    const response = await qrDownload(ownerRequest("GET", `${ORIGIN}/api/business/bizA/qr?format=poster`) as Request, {
      params: Promise.resolve({ businessId: "bizA" }),
    } as any);
    const svg = await response.text();
    expect(response.status).toBe(200);
    expect(svg).toContain("https://jataaftercall.co.ke/b/nyumbani-kitchen");
    expect(svg).toContain("Nyumbani Kitchen");
    // No dashboard link, no tenant id, no customer detail.
    expect(svg).not.toContain("/dashboard");
    expect(svg).not.toContain("bizA");
  });
});

/** Minimal PNG reader for the QR scan test: IHDR + concatenated IDAT, greyscale, filter 0. */
function decodePng(buffer: Buffer): { width: number; height: number; pixels: Uint8ClampedArray } {
  let position = 8;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position);
    const type = buffer.toString("ascii", position + 4, position + 8);
    const body = buffer.slice(position + 8, position + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === "IDAT") chunks.push(body);
    position += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = raw[y * (width + 1) + 1 + x];
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return { width, height, pixels };
}
