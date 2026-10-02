/**
 * End-to-end journey (§66) — JATA AFTERCALL Interactive Business, against a REAL database.
 *
 * This is the acceptance gate for the package: a real owner registers, builds an interactive
 * site, pays KES 999, publishes it, and a real customer orders and books on the live URL.
 *
 * It drives the application's own route handlers (no parallel code path) with the real
 * Prisma client:
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/jata npx vitest run tests/e2e/interactive-business-journey.test.ts
 *
 * Without DATABASE_URL the file is skipped so the offline unit/integration suite is unaffected.
 * Payments settle through the app's existing test-settlement branch (active only when
 * NODE_ENV !== "production" and no PAYSTACK_SECRET_KEY is set) — the same function the
 * Paystack webhook calls, so the state machine, idempotency and entitlement sync are the real ones.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATABASE_URL = (process.env.DATABASE_URL || process.env.E2E_DATABASE_URL || "").trim();
const enabled = DATABASE_URL.length > 0;

const h = vi.hoisted(() => ({
  session: { current: null as null | { userId: string; role: string } },
}));

// Route handlers that issue a session call next/headers; the store is inert here because the
// journey authenticates by swapping the mocked session payload instead of reading a cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSession: async () => h.session.current };
});

import prisma from "@/lib/db";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { PATCH as businessPatch } from "@/app/api/business/route";
import { POST as checkoutPost } from "@/app/api/checkout/route";
import { GET as paymentVerifyGet } from "@/app/api/paystack/verify/route";
import { GET as experienceGet, PATCH as experiencePatch, POST as experiencePost } from "@/app/api/experience/route";
import { POST as publishPost } from "@/app/api/experience/publish/route";
import { POST as mediaPost } from "@/app/api/media/route";
import { POST as productPost } from "@/app/api/products/route";
import { POST as servicePost } from "@/app/api/services/route";
import { POST as storefrontCheckoutPost } from "@/app/api/storefront/checkout/route";
import { GET as storefrontBookingGet, POST as storefrontBookingPost } from "@/app/api/storefront/booking/route";
import { GET as ordersGet, PATCH as ordersPatch } from "@/app/api/orders/route";
import { GET as bookingsGet, PATCH as bookingsPatch } from "@/app/api/bookings/route";
import { verifyOrderPayment } from "@/lib/experience/payments";
import { syncInteractiveEntitlement } from "@/lib/experience/entitlement";
import { getBusinessUrl } from "@/lib/url";

const runId = Date.now().toString(36).slice(-6);
const ctx: Record<string, any> = {
  owner: null as null | { userId: string; email: string; businessId: string; slug: string },
  stranger: null as null | { userId: string; email: string; businessId: string; slug: string },
};

let ipCounter = 0;
function request(url: string, init: { method?: string; body?: unknown } = {}) {
  ipCounter += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.20.0.${ipCounter}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function call(handler: (req: Request) => Promise<Response>, url: string, init: { method?: string; body?: unknown } = {}) {
  const response = await handler(request(url, init));
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function futureDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function registerOwner(role: "paid" | "unpaid") {
  const email = `e2e.${role}.${runId}@jata.test`;
  const response = await call(registerPost, "https://jata.test/api/auth/register", {
    method: "POST",
    body: {
      name: role === "paid" ? "Amina Owner" : "Brian Stranger",
      email,
      phone: `07${(Date.now() % 100000000).toString().padStart(8, "0")}`,
      password: "Jata#2026E2E",
      businessName: role === "paid" ? `E2E Interactive ${runId}` : `E2E Unpaid ${runId}`,
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const userId = response.body?.user?.id as string;
  expect(userId).toBeTruthy();

  const business = await prisma.business.findFirst({ where: { ownerId: userId }, select: { id: true, slug: true } });
  expect(business).toBeTruthy();
  return { userId, email, businessId: business!.id, slug: business!.slug };
}

async function cleanup(ids: { userId: string; businessId: string }[]) {
  for (const { userId, businessId } of ids) {
    try {
      await prisma.analyticsEvent.deleteMany({ where: { businessId } });
      await prisma.notification.deleteMany({ where: { businessId } });
      await prisma.orderItem.deleteMany({ where: { order: { businessId } } });
      await prisma.order.deleteMany({ where: { businessId } });
      await prisma.payment.deleteMany({ where: { businessId } });
      await prisma.booking.deleteMany({ where: { businessId } });
      await prisma.productVariant.deleteMany({ where: { businessId } });
      await prisma.product.deleteMany({ where: { businessId } });
      await prisma.service.deleteMany({ where: { businessId } });
      await prisma.mediaAsset.deleteMany({ where: { businessId } });
      await prisma.experienceVersion.deleteMany({ where: { businessId } });
      await prisma.interactiveBusinessEntitlement.deleteMany({ where: { businessId } });
      await prisma.businessExperience.deleteMany({ where: { businessId } });
      await prisma.cartItem.deleteMany({ where: { businessId } });
      await prisma.cart.deleteMany({ where: { businessId } });
      await prisma.subscription.deleteMany({ where: { businessId } });
      await prisma.businessMember.deleteMany({ where: { businessId } });
      await prisma.business.deleteMany({ where: { id: businessId } });
      await prisma.auditEvent.deleteMany({ where: { actorId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // Cleanup is best-effort: never mask a real assertion failure.
    }
  }
}

const created: { userId: string; businessId: string }[] = [];

describe.skipIf(!enabled)("Interactive Business end-to-end journey (§66)", () => {
  beforeAll(async () => {
    await prisma.planConfig.upsert({
      where: { key: "INTERACTIVE_BUSINESS" },
      update: { priceKES: 999, durationDays: 30, isActive: true },
      create: { key: "INTERACTIVE_BUSINESS", name: "Interactive Business", priceKES: 999, durationDays: 30, isActive: true },
    });
  }, 120_000);

  afterAll(async () => {
    await cleanup(created);
    await prisma.$disconnect().catch(() => undefined);
  }, 120_000);

  it("1 — a real owner registers and gets a business", async () => {
    const owner = await registerOwner("paid");
    ctx.owner = owner;
    created.push({ userId: owner.userId, businessId: owner.businessId });
    h.session.current = { userId: owner.userId, role: "OWNER" };
    expect(owner.slug).toBeTruthy();
  }, 120_000);

  it("2 — the owner completes the business profile", async () => {
    const response = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: {
        businessId: ctx.owner.businessId,
        category: "Restaurant",
        phone: "0712345678",
        whatsapp: "0712345678",
        location: "Kimathi Street, Nairobi",
        description: "Fresh Swahili coastal dishes, made to order.",
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const business = await prisma.business.findUnique({ where: { id: ctx.owner.businessId } });
    expect(business?.phone).toBe("0712345678");
  }, 120_000);

  it("3 — the server prices the Interactive package at KES 999", async () => {
    const plan = await prisma.planConfig.findUnique({ where: { key: "INTERACTIVE_BUSINESS" } });
    expect(plan?.priceKES).toBe(999);

    const response = await call(checkoutPost, "https://jata.test/api/checkout", {
      method: "POST",
      body: { businessId: ctx.owner.businessId, planId: plan!.id },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const reference = response.body?.reference as string;
    expect(reference).toBeTruthy();

    const payment = await prisma.payment.findUnique({ where: { reference } });
    expect(payment?.amount).toBe(99900); // KES 999 in kobo — never taken from the browser
    expect(payment?.currency).toBe("KES");
    expect(payment?.status).toBe("PENDING");
    ctx.paymentReference = reference;
  }, 120_000);

  it("4 — publishing is refused while the package is unpaid", async () => {
    await call(experiencePost, "https://jata.test/api/experience", {
      method: "POST",
      body: { businessId: ctx.owner.businessId, categoryKey: "food" },
    });
    const response = await call(publishPost, "https://jata.test/api/experience/publish", {
      method: "POST",
      body: { businessId: ctx.owner.businessId },
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ published: false, requires: "PAYMENT" });
    const business = await prisma.business.findUnique({ where: { id: ctx.owner.businessId } });
    expect(business?.isPublished).toBe(false);
  }, 120_000);

  it("5 — the payment is verified and the entitlement activates", async () => {
    const response = await call(
      paymentVerifyGet,
      `https://jata.test/api/paystack/verify?reference=${encodeURIComponent(ctx.paymentReference)}&mock=success`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: "PAID" });

    const payment = await prisma.payment.findUnique({ where: { reference: ctx.paymentReference } });
    expect(payment?.status).toBe("PAID");
    const subscription = await prisma.subscription.findUnique({ where: { businessId: ctx.owner.businessId } });
    expect(["ACTIVE", "EXPIRING"]).toContain(subscription?.status);

    const entitlement = await syncInteractiveEntitlement(ctx.owner.businessId);
    expect(entitlement.status).toBe("ACTIVE");
    expect(entitlement.entitled).toBe(true);
  }, 120_000);

  it("6 — the owner configures the experience for their category", async () => {
    const response = await call(experienceGet, `https://jata.test/api/experience?businessId=${ctx.owner.businessId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body?.document?.categoryKey).toBe("food");
  }, 120_000);

  it("7 — an image is uploaded to the media library", async () => {
    const response = await call(mediaPost, "https://jata.test/api/media", {
      method: "POST",
      body: { businessId: ctx.owner.businessId, kind: "IMAGE", url: TINY_PNG, alt: "Chicken biryani" },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    ctx.imageUrl = response.body?.asset?.url || TINY_PNG;
    expect(ctx.imageUrl).toBeTruthy();
  }, 120_000);

  it("8 — a priced product is added", async () => {
    const response = await call(productPost, "https://jata.test/api/products", {
      method: "POST",
      body: {
        businessId: ctx.owner.businessId,
        name: "Chicken biryani",
        description: "Slow-cooked rice with coastal spices.",
        category: "Mains",
        basePriceKES: 850,
        quantity: 50,
        imageUrl: ctx.imageUrl,
        isActive: true,
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    ctx.productId = response.body?.product?.id;
    expect(ctx.productId).toBeTruthy();
  }, 120_000);

  it("9 — draft edits stay off the live site until published", async () => {
    const response = await call(experiencePatch, "https://jata.test/api/experience", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, brand: { tagline: "Coastal flavour, every day" } },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const experience = await prisma.businessExperience.findUnique({ where: { businessId: ctx.owner.businessId } });
    expect(experience?.publishedJson).toBeNull();
    expect(experience?.draftJson).toContain("Coastal flavour");
    expect(experience?.draftVersion).toBeGreaterThan(0);
  }, 120_000);

  it("10 — the site publishes once payment is verified", async () => {
    const response = await call(publishPost, "https://jata.test/api/experience/publish", {
      method: "POST",
      body: { businessId: ctx.owner.businessId },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const business = await prisma.business.findUnique({ where: { id: ctx.owner.businessId } });
    expect(business?.isPublished).toBe(true);
    const experience = await prisma.businessExperience.findUnique({ where: { businessId: ctx.owner.businessId } });
    expect(experience?.status).toBe("PUBLISHED");
    expect(experience?.publishedJson).toContain("Coastal flavour");
    const versions = await prisma.experienceVersion.count({ where: { businessId: ctx.owner.businessId } });
    expect(versions).toBeGreaterThan(0);

    ctx.publicUrl = getBusinessUrl(ctx.owner.slug);
    expect(ctx.publicUrl).toContain(`/b/${ctx.owner.slug}`);
  }, 120_000);

  it("11 — a customer's basket is priced by the server, not the browser", async () => {
    h.session.current = null; // a visitor, not the owner
    const response = await call(storefrontCheckoutPost, "https://jata.test/api/storefront/checkout", {
      method: "POST",
      body: {
        slug: ctx.owner.slug,
        items: [{ productId: ctx.productId, quantity: 2, trustedTotalKES: 1 }],
        customer: { name: "John Customer", phone: "0700111222" },
        fulfilment: "PICKUP",
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    // 2 × KES 850, pickup → no delivery fee. The client-supplied total is ignored.
    expect(response.body).toMatchObject({ subtotalKES: 1700, deliveryFeeKES: 0, totalKES: 1700 });
    ctx.orderId = response.body?.orderId;
    ctx.orderReference = response.body?.orderReference;
    ctx.orderPaymentReference = response.body?.paymentReference;
  }, 120_000);

  it("12 — the customer's payment confirms and fulfils the order", async () => {
    const result = await verifyOrderPayment(ctx.orderPaymentReference);
    expect(result.state).toBe("SUCCESS");

    const order = await prisma.order.findUnique({ where: { id: ctx.orderId } });
    expect(order?.paymentStatus).toBe("PAID");
    expect(order?.status).toBe("CONFIRMED");
    expect(order?.totalKES).toBe(1700);

    // Re-running the same confirmation is idempotent (§27).
    const again = await verifyOrderPayment(ctx.orderPaymentReference);
    expect(again.state).toBe("SUCCESS");
    expect((await prisma.payment.findMany({ where: { reference: ctx.orderPaymentReference } })).length).toBe(1);
  }, 120_000);

  it("13 — the owner receives the order and processes it", async () => {
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const board = await call(ordersGet, `https://jata.test/api/orders?businessId=${ctx.owner.businessId}`);
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const found = (board.body?.orders || []).find((order: any) => order.id === ctx.orderId);
    expect(found).toBeTruthy();
    expect(found.paymentStatus).toBe("PAID");

    const moved = await call(ordersPatch, "https://jata.test/api/orders", {
      method: "PATCH",
      body: { orderId: ctx.orderId, stage: "ACCEPTED" },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const order = await prisma.order.findUnique({ where: { id: ctx.orderId } });
    expect(order?.status).toBe("PROCESSING");

    const illegal = await call(ordersPatch, "https://jata.test/api/orders", {
      method: "PATCH",
      body: { orderId: ctx.orderId, stage: "NEW" },
    });
    expect(illegal.status).toBe(409);
  }, 120_000);

  it("14 — a customer books a service and the owner completes it", async () => {
    const serviceResponse = await call(servicePost, "https://jata.test/api/services", {
      method: "POST",
      body: {
        businessId: ctx.owner.businessId,
        title: "Chef's table tasting",
        description: "Six-course coastal tasting menu.",
        pricingType: "FIXED",
        priceFrom: 2500,
        priceToKES: 2500,
        durationMinutes: 60,
        depositKES: 0,
        bookingEnabled: true,
        isActive: true,
        availability: JSON.stringify({
          days: [0, 1, 2, 3, 4, 5, 6],
          slots: ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00"],
          slotMinutes: 60,
          capacity: 1,
        }),
      },
    });
    expect(serviceResponse.status, JSON.stringify(serviceResponse.body)).toBe(201);
    ctx.serviceId = serviceResponse.body?.service?.id;

    const date = futureDate(1);
    h.session.current = null;
    const slots = await call(
      storefrontBookingGet,
      `https://jata.test/api/storefront/booking?slug=${ctx.owner.slug}&serviceId=${ctx.serviceId}&date=${date}`,
    );
    expect(slots.status).toBe(200);
    expect(slots.body?.slots).toContain("11:00");

    const booking = await call(storefrontBookingPost, "https://jata.test/api/storefront/booking", {
      method: "POST",
      body: {
        slug: ctx.owner.slug,
        serviceId: ctx.serviceId,
        date,
        time: "11:00",
        customerName: "Grace Customer",
        customerPhone: "0700333444",
      },
    });
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    expect(booking.body?.booking?.status).toBe("CONFIRMED");
    ctx.bookingId = booking.body?.booking?.id;

    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const board = await call(bookingsGet, `https://jata.test/api/bookings?businessId=${ctx.owner.businessId}`);
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    expect((board.body?.bookings || []).some((entry: any) => entry.id === ctx.bookingId)).toBe(true);

    const completed = await call(bookingsPatch, "https://jata.test/api/bookings", {
      method: "PATCH",
      body: { bookingId: ctx.bookingId, status: "COMPLETED" },
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    const stored = await prisma.booking.findUnique({ where: { id: ctx.bookingId } });
    expect(stored?.status).toBe("COMPLETED");
  }, 120_000);

  it("15 — a second owner cannot touch the first business", async () => {
    const stranger = await registerOwner("unpaid");
    ctx.stranger = stranger;
    created.push({ userId: stranger.userId, businessId: stranger.businessId });
    h.session.current = { userId: stranger.userId, role: "OWNER" };

    const edit = await call(experiencePatch, "https://jata.test/api/experience", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, brand: { tagline: "Hijacked" } },
    });
    expect(edit.status).toBe(403);

    const orders = await call(ordersGet, `https://jata.test/api/orders?businessId=${ctx.owner.businessId}`);
    expect(orders.status).toBe(403);

    const publish = await call(publishPost, "https://jata.test/api/experience/publish", {
      method: "POST",
      body: { businessId: ctx.owner.businessId },
    });
    expect(publish.status).toBe(403);

    const experience = await prisma.businessExperience.findUnique({ where: { businessId: ctx.owner.businessId } });
    expect(experience?.draftJson).not.toContain("Hijacked");
  }, 120_000);

  it("16 — an unpaid business can build but never publish", async () => {
    const response = await call(experiencePost, "https://jata.test/api/experience", {
      method: "POST",
      body: { businessId: ctx.stranger.businessId, categoryKey: "salon" },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.stranger.businessId, phone: "0700000009", location: "Westlands, Nairobi" },
    });

    const product = await call(productPost, "https://jata.test/api/products", {
      method: "POST",
      body: { businessId: ctx.stranger.businessId, name: "Fade cut", basePriceKES: 700, isActive: true },
    });
    expect(product.status).toBe(201);

    const publish = await call(publishPost, "https://jata.test/api/experience/publish", {
      method: "POST",
      body: { businessId: ctx.stranger.businessId },
    });
    expect(publish.status).toBe(403);
    expect(publish.body).toMatchObject({ requires: "PAYMENT" });
    const business = await prisma.business.findUnique({ where: { id: ctx.stranger.businessId } });
    expect(business?.isPublished).toBe(false);
  }, 120_000);

  it("17 — a lapsed entitlement hides the site but never deletes the content", async () => {
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { businessId: ctx.owner.businessId },
      data: { status: "EXPIRED", expiresAt: past, graceUntil: past },
    });

    const entitlement = await syncInteractiveEntitlement(ctx.owner.businessId);
    expect(entitlement.status).toBe("EXPIRED");

    await call(experiencePatch, "https://jata.test/api/experience", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, brand: { tagline: "New season menu" } },
    });
    const republish = await call(publishPost, "https://jata.test/api/experience/publish", {
      method: "POST",
      body: { businessId: ctx.owner.businessId },
    });
    expect(republish.status).toBe(403);

    // Content survives: nothing is destroyed by a lapsed package (§9).
    expect(await prisma.product.count({ where: { businessId: ctx.owner.businessId } })).toBeGreaterThan(0);
    expect(await prisma.order.count({ where: { businessId: ctx.owner.businessId } })).toBeGreaterThan(0);
    const experience = await prisma.businessExperience.findUnique({ where: { businessId: ctx.owner.businessId } });
    expect(experience?.draftJson).toContain("New season menu");
    expect(experience?.publishedJson).not.toContain("New season menu");
  }, 120_000);
});

describe.skipIf(enabled)("Interactive Business end-to-end journey (§66)", () => {
  it("is skipped until DATABASE_URL is configured", () => {
    // Documented so the gate is visible in the suite output rather than silently missing.
    expect(enabled).toBe(false);
  });
});
