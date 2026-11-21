/**
 * MJENGO OS paid journey against real Prisma + PostgreSQL (R-MJ-08).
 *
 *   owner signs in (session) → unpaid workspace APIs answer 402 → POST /api/checkout (real route)
 *   creates the PENDING KES 2,000 payment → a correctly HMAC-signed `charge.success` reaches the real
 *   Paystack webhook route → MjengoSubscription + MjengoEntitlement rows are written atomically →
 *   the workspace APIs answer 200 → another tenant is refused → a replayed or concurrent delivery
 *   never extends the 30-day window twice → `refund.processed` suspends the workspace again.
 *
 * Only the two Paystack HTTP calls (initialize / verify) are replaced, so no network request and no
 * payment is ever made. Signature verification, payment evidence checks, settlement, entitlement
 * derivation, tenant checks and every database write are the production code paths.
 * Runs only when PRISMA_TEST_DATABASE_URL is set (Release Validation PG18 job).
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";

const mock = vi.hoisted(() => ({
  session: null as null | { userId: string; role: string; email: string },
  initializeTransaction: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: async () => mock.session };
});
vi.mock("@/lib/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paystack")>();
  return { ...actual, initializeTransaction: mock.initializeTransaction, verifyTransaction: mock.verifyTransaction };
});

import { POST as checkout } from "@/app/api/checkout/route";
import { POST as webhook } from "@/app/api/paystack/webhook/route";
import { GET as brandingGet, POST as brandingPost } from "@/app/api/mjengo/branding/route";
import { GET as journalGet } from "@/app/api/mjengo/journal/route";
import { MJENGO_PLAN_DURATION_DAYS, MJENGO_PLAN_KEY, MJENGO_PLAN_PRICE_KES } from "@/lib/mjengo/entitlement";

const p = realPrismaConfigured ? sharedPrisma() : (null as any);
const SECRET = `sk_test_journey_${randomUUID().replace(/-/g, "")}`; // per-run, test-only, never a provider key
const BASE = "http://localhost:3000";
const DAY = 86_400_000;

const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");
function deliver(event: Record<string, unknown>, signature?: string) {
  const body = JSON.stringify(event);
  return webhook(new Request(`${BASE}/api/paystack/webhook`, {
    method: "POST", body, headers: { "content-type": "application/json", "x-paystack-signature": signature ?? sign(body) },
  }));
}
const chargeSuccess = (reference: string, id: number) => ({ id: `evt-${uid()}`, event: "charge.success", data: { reference, id } });
const providerSuccess = (reference: string, amount: number, id: number) =>
  ({ id, status: "success", reference, amount, currency: "KES", paid_at: new Date().toISOString() });

const asOwner = (user: { id: string; email: string }) => { mock.session = { userId: user.id, role: "CUSTOMER", email: user.email }; };
const sameOrigin = { "content-type": "application/json", origin: BASE, host: "localhost:3000", "sec-fetch-site": "same-origin" };
const getBranding = (businessId: string) => brandingGet(new Request(`${BASE}/api/mjengo/branding?businessId=${encodeURIComponent(businessId)}`));
const postBranding = (businessId: string, business_name: string) =>
  brandingPost(new Request(`${BASE}/api/mjengo/branding`, { method: "POST", headers: sameOrigin, body: JSON.stringify({ businessId, business_name }) }));
const getJournal = (businessId: string) => journalGet(new Request(`${BASE}/api/mjengo/journal?businessId=${encodeURIComponent(businessId)}`));
// Exactly what components/CheckoutForm.tsx sends (the MJENGO settings page hands it the server-resolved planId).
const startCheckout = (businessId: string, planId: string) =>
  checkout(new Request(`${BASE}/api/checkout`, { method: "POST", headers: sameOrigin, body: JSON.stringify({ businessId, planId }) }));

describe.skipIf(!realPrismaConfigured)("real PostgreSQL: MJENGO OS public → auth → payment → entitlement → workspace", () => {
  const env = { PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY, MJENGO_OS_DISABLED: process.env.MJENGO_OS_DISABLED, DATABASE_URL: process.env.DATABASE_URL };
  let a: { owner: any; business: any };
  let b: { owner: any; business: any };
  let plan: any;

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    delete process.env.MJENGO_OS_DISABLED;
    // The branding route refuses with 503 when no DATABASE_URL is configured; the suite talks to the
    // PRISMA_TEST_DATABASE_URL database through the mocked client, so expose the same URL.
    process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.PRISMA_TEST_DATABASE_URL;
    // The canonical plan row (prisma/seed.ts). Created only when absent; an existing row is never
    // modified, so a mispriced plan makes this suite fail instead of being silently corrected.
    plan = await p.planConfig.upsert({
      where: { key: MJENGO_PLAN_KEY },
      update: {},
      create: { key: MJENGO_PLAN_KEY, name: "MJENGO OS — Business Management — KES 2,000/month", priceKES: MJENGO_PLAN_PRICE_KES, durationDays: MJENGO_PLAN_DURATION_DAYS },
    });
    a = await seedBusiness(p);
    b = await seedBusiness(p);
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    mock.session = null;
    if (p) await p.$disconnect();
  });
  beforeEach(() => {
    mock.initializeTransaction.mockReset();
    mock.verifyTransaction.mockReset();
    mock.initializeTransaction.mockImplementation(async ({ reference }: { reference: string }) =>
      ({ authorization_url: `https://checkout.paystack.test/${reference}`, access_code: "test", reference }));
  });

  const mjengoRows = async (businessId: string) => ({
    subscription: await p.mjengoSubscription.findUnique({ where: { businessId } }),
    entitlement: await p.mjengoEntitlement.findUnique({ where: { businessId } }),
  });

  it("server plan terms are KES 2,000 / 30 days and independent of POS (KES 499)", () => {
    expect(plan.priceKES).toBe(2000);
    expect(plan.durationDays).toBe(30);
    expect(plan.isActive).toBe(true);
  });

  it("anonymous callers get 401 and learn nothing about the workspace", async () => {
    mock.session = null;
    expect((await getBranding(a.business.id)).status).toBe(401);
    expect((await getJournal(a.business.id)).status).toBe(401);
    expect((await postBranding(a.business.id, "Hijack")).status).toBe(401);
  });

  it("an authenticated owner without MJENGO OS is refused with 402 (purchase is the next step)", async () => {
    asOwner(a.owner);
    const journal = await getJournal(a.business.id);
    expect(journal.status).toBe(402);
    expect((await journal.json()).code).toBe("MJENGO_ENTITLEMENT_REQUIRED");
    expect((await postBranding(a.business.id, "Unpaid rename")).status).toBe(402);
    expect((await p.business.findUnique({ where: { id: a.business.id }, select: { name: true } })).name).toBe("Choma Place");
    expect(await mjengoRows(a.business.id)).toEqual({ subscription: null, entitlement: null });
  });

  it("another tenant cannot start checkout for, or read, a business it does not own", async () => {
    asOwner(b.owner);
    expect((await startCheckout(a.business.id, plan.id)).status).toBe(403);
    expect((await getBranding(a.business.id)).status).toBe(403);
    expect((await getJournal(a.business.id)).status).toBe(403);
    expect(await p.payment.count({ where: { businessId: a.business.id } })).toBe(0);
    expect(mock.initializeTransaction).not.toHaveBeenCalled();
  });

  let reference = "";
  let paymentId = "";

  it("checkout creates exactly one PENDING KES 2,000 payment for the MJENGO plan (no money moves)", async () => {
    asOwner(a.owner);
    const res = await startCheckout(a.business.id, plan.id);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.planKey).toBe(MJENGO_PLAN_KEY);
    reference = json.reference;
    const payment = await p.payment.findUnique({ where: { reference } });
    paymentId = payment.id;
    expect(payment).toMatchObject({ businessId: a.business.id, userId: a.owner.id, planId: plan.id, amount: 200_000, currency: "KES", status: "PENDING" });
    expect(mock.initializeTransaction).toHaveBeenCalledTimes(1);
    expect(mock.initializeTransaction.mock.calls[0][0]).toMatchObject({ amount: 200_000, currency: "KES", reference });
    // Still unpaid: a PENDING payment grants nothing.
    expect((await getJournal(a.business.id)).status).toBe(402);
  });

  it("an unsigned or wrongly signed charge.success is rejected and writes nothing", async () => {
    const event = chargeSuccess(reference, 7001);
    expect((await deliver(event, "0".repeat(128))).status).toBe(401);
    expect((await deliver(event, sign(JSON.stringify(event)).slice(0, 127) + "z")).status).toBe(401);
    expect(mock.verifyTransaction).not.toHaveBeenCalled();
    expect((await p.payment.findUnique({ where: { id: paymentId } })).status).toBe("PENDING");
    expect(await mjengoRows(a.business.id)).toEqual({ subscription: null, entitlement: null });
  });

  it("a signed event whose provider evidence does not match (wrong amount) activates nothing", async () => {
    mock.verifyTransaction.mockResolvedValue(providerSuccess(reference, 49_900, 7002)); // POS price, not MJENGO
    const res = await deliver(chargeSuccess(reference, 7002));
    expect(res.status).toBe(400);
    expect((await p.payment.findUnique({ where: { id: paymentId } })).status).toBe("PENDING");
    expect(await mjengoRows(a.business.id)).toEqual({ subscription: null, entitlement: null });
  });

  let firstExpiry = 0;

  it("a verified signed charge.success writes ACTIVE MjengoSubscription + MjengoEntitlement for 30 days", async () => {
    mock.verifyTransaction.mockResolvedValue(providerSuccess(reference, 200_000, 7003));
    const before = Date.now();
    const res = await deliver(chargeSuccess(reference, 7003));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("processed");
    expect((await p.payment.findUnique({ where: { id: paymentId } })).status).toBe("PAID");
    const { subscription, entitlement } = await mjengoRows(a.business.id);
    expect(subscription).toMatchObject({ status: "ACTIVE", planKey: MJENGO_PLAN_KEY, paymentId, userId: a.owner.id, paymentReference: reference });
    expect(entitlement).toMatchObject({ status: "ACTIVE", packageKey: MJENGO_PLAN_KEY });
    firstExpiry = new Date(subscription.expiresAt).getTime();
    expect(firstExpiry - before).toBeGreaterThanOrEqual(30 * DAY - 5_000);
    expect(firstExpiry - before).toBeLessThanOrEqual(30 * DAY + 60_000);
    // Independent identity: MJENGO did not write POS, ERP PRO or the page subscription.
    expect(await p.posSubscription.count({ where: { businessId: a.business.id } })).toBe(0);
    expect(await p.erpProSubscription.count({ where: { businessId: a.business.id } })).toBe(0);
    expect(await p.subscription.count({ where: { businessId: a.business.id } })).toBe(0);
  });

  it("the paid owner reaches the workspace APIs; tenant B is still refused and stays unpaid", async () => {
    asOwner(a.owner);
    const journal = await getJournal(a.business.id);
    expect(journal.status).toBe(200);
    expect((await journal.json()).ok).toBe(true);
    const renamed = await postBranding(a.business.id, "Choma Place Builders");
    expect(renamed.status).toBe(200);
    expect((await p.business.findUnique({ where: { id: a.business.id }, select: { name: true } })).name).toBe("Choma Place Builders");

    asOwner(b.owner);
    expect((await getJournal(a.business.id)).status).toBe(403);
    expect((await postBranding(a.business.id, "Cross tenant")).status).toBe(403);
    expect((await getJournal(b.business.id)).status).toBe(402); // A's payment never entitles B
    expect((await p.business.findUnique({ where: { id: a.business.id }, select: { name: true } })).name).toBe("Choma Place Builders");
  });

  it("replayed and concurrent deliveries for the same payment never extend the window twice", async () => {
    mock.verifyTransaction.mockResolvedValue(providerSuccess(reference, 200_000, 7003));
    const replay = chargeSuccess(reference, 7003);
    const results = await Promise.all([deliver(replay), deliver(chargeSuccess(reference, 7003)), deliver(chargeSuccess(reference, 7003))]);
    for (const r of results) expect(r.status).toBe(200);
    const again = await deliver(replay); // the exact same event id, after it was recorded
    expect((await again.json()).status).toBe("already_processed");
    const { subscription } = await mjengoRows(a.business.id);
    expect(new Date(subscription.expiresAt).getTime()).toBe(firstExpiry);
    expect(await p.mjengoSubscription.count({ where: { businessId: a.business.id } })).toBe(1);
    expect(await p.payment.count({ where: { businessId: a.business.id, status: "PAID" } })).toBe(1);
  });

  it("refund.processed for the full amount suspends MJENGO OS and the workspace is refused again", async () => {
    const refund = { id: `evt-${uid()}`, event: "refund.processed", data: { transaction_reference: reference, amount: 200_000, currency: "KES" } };
    const res = await deliver(refund);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("refund_processed");
    expect((await p.payment.findUnique({ where: { id: paymentId } })).status).toBe("REFUNDED");
    const { subscription, entitlement } = await mjengoRows(a.business.id);
    expect(subscription.status).toBe("SUSPENDED");
    expect(entitlement.status).toBe("SUSPENDED");
    asOwner(a.owner);
    expect((await getJournal(a.business.id)).status).toBe(403); // SUSPENDED → support, not a second checkout
    // A later provider "success" for refunded money cannot reactivate the workspace.
    mock.verifyTransaction.mockResolvedValue(providerSuccess(reference, 200_000, 7003));
    await deliver(chargeSuccess(reference, 7003));
    expect((await mjengoRows(a.business.id)).subscription.status).toBe("SUSPENDED");
    expect((await p.payment.findUnique({ where: { id: paymentId } })).status).toBe("REFUNDED");
  });
});
