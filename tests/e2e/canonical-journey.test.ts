/**
 * Canonical customer journey — JATA AFTERCALL (KES 149/month) against a REAL database.
 *
 *   Create Business → Configure Business → Edit → Preview → Choose Plan → Pay →
 *   Verify Payment → Activate Subscription → Publish → Public Business Page
 *
 * It drives the application's own route handlers and page module with the real Prisma client
 * (no parallel code path), and it is the counterpart of the Interactive Business journey:
 *   - `tests/e2e/interactive-business-journey.test.ts` proves the KES 999 premium package;
 *   - this file proves the canonical AFTERCALL journey on the entry plan, the four-offering
 *     catalogue, the server-side payment-before-publication gate, tenant isolation of
 *     payment/subscription/publication, and that `/b/[slug]` is genuinely reachable for a
 *     guest after publication (and not reachable before it).
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/jata npx vitest run tests/e2e/canonical-journey.test.ts
 *
 * Without DATABASE_URL the file is skipped so the offline unit/integration suite is unaffected.
 * Payments settle through the app's existing test-settlement branch — active only when
 * NODE_ENV !== "production" and PAYSTACK_SECRET_KEY is unset — which is the same
 * `activateSubscriptionForPayment` function the Paystack webhook calls. No real money moves,
 * and the prerequisites are asserted below before any payment call is made.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATABASE_URL = (process.env.DATABASE_URL || process.env.E2E_DATABASE_URL || "").trim();
const enabled = DATABASE_URL.length > 0;

const h = vi.hoisted(() => ({
  session: { current: null as null | { userId: string; role: string } },
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
import { PATCH as businessPatch } from "@/app/api/business/route";
import { GET as servicesGet, POST as servicePost } from "@/app/api/services/route";
import { POST as checkoutPost } from "@/app/api/checkout/route";
import { GET as paymentVerifyGet } from "@/app/api/paystack/verify/route";
import { POST as publishPost } from "@/app/api/experience/publish/route";
import PublicBusinessPage from "@/app/b/[slug]/page";
import { CANONICAL_PLANS, planMatchesCanonical } from "@/lib/canonicalPlans";
import { SAFE_ERRORS } from "@/lib/safeError";
import { publicPageDecision, type PublicViewer } from "@/lib/publication";
import { getBusinessUrl } from "@/lib/url";

const runId = Date.now().toString(36).slice(-6);

type Owner = { userId: string; email: string; businessId: string; slug: string };
const ctx: Record<string, any> = {};
const created: { userId: string; businessId: string }[] = [];

let ipCounter = 0;
function request(url: string, init: { method?: string; body?: unknown } = {}) {
  ipCounter += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.30.0.${ipCounter}` };
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

async function registerOwner(label: string, businessName: string): Promise<Owner> {
  const email = `e2e.canonical.${label}.${runId}@jata.test`;
  const response = await call(registerPost, "https://jata.test/api/auth/register", {
    method: "POST",
    body: {
      name: label === "owner" ? "Amina Owner" : "Brian Second Owner",
      email,
      phone: `07${String((Date.now() + label.length) % 100000000).padStart(8, "0")}`,
      password: "Jata#2026E2E",
      businessName,
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const userId = response.body?.user?.id as string;
  expect(userId).toBeTruthy();
  const business = await prisma.business.findFirst({ where: { ownerId: userId }, select: { id: true, slug: true } });
  expect(business, "registration must create the owner's business").toBeTruthy();
  return { userId, email, businessId: business!.id, slug: business!.slug };
}

/** Render the real `/b/[slug]` server component exactly as a request would. */
async function renderPublicPage(slug: string): Promise<unknown> {
  return PublicBusinessPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  });
}

/** Shallow element-tree search — enough to prove the business data reached the page props. */
function treeContains(node: unknown, needle: string, depth = 0): boolean {
  if (depth > 16 || node == null) return false;
  if (typeof node === "string" || typeof node === "number") return String(node).includes(needle);
  if (Array.isArray(node)) return node.some((child) => treeContains(child, needle, depth + 1));
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    // A React element carries its data in `props`; the data objects it renders (the business
    // record, its services) are walked value-by-value so the assertion sees what the page
    // actually received, not what a screenshot would show after client hydration.
    const values = record.props && typeof record.props === "object" ? Object.values(record.props as Record<string, unknown>) : Object.values(record);
    return values.some((value) => treeContains(value, needle, depth + 1));
  }
  return false;
}

async function cleanup(ids: { userId: string; businessId: string }[]) {
  for (const { userId, businessId } of ids) {
    try {
      await prisma.analyticsEvent.deleteMany({ where: { businessId } });
      await prisma.referral.deleteMany({ where: { OR: [{ referrerBusinessId: businessId }, { referredBusinessId: businessId }] } });
      await prisma.payment.deleteMany({ where: { businessId } });
      await prisma.service.deleteMany({ where: { businessId } });
      await prisma.subscription.deleteMany({ where: { businessId } });
      await prisma.businessMember.deleteMany({ where: { businessId } });
      await prisma.business.deleteMany({ where: { id: businessId } });
      await prisma.auditEvent.deleteMany({ where: { actorId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // Best-effort cleanup: never mask a real assertion failure.
    }
  }
}

describe.skipIf(!enabled)("canonical JATA AFTERCALL journey (real database)", () => {
  beforeAll(async () => {
    // Prerequisites before any payment call: an isolated test database, the app's test-settlement
    // branch active (never production, never a live Paystack key), and a disposable tenant.
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(process.env.PAYSTACK_SECRET_KEY || "").toBe("");
    expect(DATABASE_URL).not.toContain("prod");
  }, 120_000);

  afterAll(async () => {
    await cleanup(created);
    await prisma.$disconnect().catch(() => undefined);
  }, 120_000);

  it("1 — a real owner registers and a business row exists", async () => {
    const owner = await registerOwner("owner", `E2E Canonical ${runId}`);
    ctx.owner = owner;
    created.push({ userId: owner.userId, businessId: owner.businessId });
    h.session.current = { userId: owner.userId, role: "OWNER" };
    expect(owner.slug).toBeTruthy();
    expect(await prisma.businessMember.count({ where: { businessId: owner.businessId, role: "OWNER" } })).toBeGreaterThan(0);
  }, 120_000);

  it("2 — the owner configures the business profile and services", async () => {
    const configured = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: {
        businessId: ctx.owner.businessId,
        category: "Beauty",
        phone: "0712345678",
        whatsapp: "0712345678",
        location: "Kimathi Street, Nairobi",
        description: "Braids, nails and beauty, walk-ins welcome.",
        theme: "clean",
      },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);

    const service = await call(servicePost, "https://jata.test/api/services", {
      method: "POST",
      body: { businessId: ctx.owner.businessId, title: "Braiding", priceLabel: "From KES 1,500" },
    });
    expect(service.status, JSON.stringify(service.body)).toBe(201);

    const stored = await prisma.business.findUnique({ where: { id: ctx.owner.businessId } });
    expect(stored).toMatchObject({ category: "Beauty", phone: "0712345678", location: "Kimathi Street, Nairobi" });
    expect(await prisma.service.count({ where: { businessId: ctx.owner.businessId } })).toBe(1);
  }, 120_000);

  it("3 — the owner edits the profile and the change is persisted", async () => {
    const edited = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, name: `E2E Canonical ${runId} Studio`, description: "Edited description." },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const stored = await prisma.business.findUnique({ where: { id: ctx.owner.businessId } });
    expect(stored?.name).toBe(`E2E Canonical ${runId} Studio`);
    expect(stored?.description).toBe("Edited description.");
  }, 120_000);

  it("4 — preview: the owner sees the unpublished page, guests and other owners do not", async () => {
    const stored = await prisma.business.findUnique({
      where: { id: ctx.owner.businessId },
      include: { members: { select: { userId: true, role: true } } },
    });
    const access = {
      isPublished: stored!.isPublished,
      ownerId: stored!.ownerId,
      ownerMemberIds: stored!.members.filter((member) => member.role === "OWNER").map((member) => member.userId),
    };

    // The owner is previewing, not publishing: the DB row is still a draft.
    expect(stored!.isPublished).toBe(false);
    expect(publicPageDecision({ business: access, viewer: { userId: ctx.owner.userId, role: "OWNER" } as PublicViewer })).toBe("preview");
    const ownerRender = await renderPublicPage(ctx.owner.slug);
    expect(treeContains(ownerRender, `E2E Canonical ${runId} Studio`)).toBe(true);

    // A signed-out visitor gets nothing (and the page component itself refuses, not just the
    // pure decision helper).
    expect(publicPageDecision({ business: access, viewer: null })).toBe("not_found");
    h.session.current = null;
    await expect(renderPublicPage(ctx.owner.slug)).rejects.toThrow();
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
  }, 120_000);

  it("5 — the database catalogue exposes the four canonical offerings, both new plans active", async () => {
    const rows = await prisma.planConfig.findMany({ orderBy: { key: "asc" } });
    for (const plan of CANONICAL_PLANS) {
      const row = rows.find((entry) => entry.key === plan.key);
      expect(row, `PlanConfig row missing for ${plan.key}`).toBeTruthy();
      expect(row!.priceKES).toBe(plan.priceKES);
      expect(row!.durationDays).toBe(plan.durationDays);
      expect(row!.isActive, `${plan.key} must be active`).toBe(true);
      expect(planMatchesCanonical(row!), `${plan.key} must match the canonical offering`).toBe(true);
    }
    const monthly = rows.find((entry) => entry.key === "MONTHLY")!;
    expect(monthly.priceKES).toBe(149);
    ctx.monthlyPlanId = monthly.id;
    ctx.monthlyPlan = monthly;
  }, 120_000);

  it("6 — choosing a plan: checkout is server-priced for every offering and tenant-scoped", async () => {
    const stranger = await registerOwner("stranger", `E2E Second ${runId}`);
    ctx.stranger = stranger;
    created.push({ userId: stranger.userId, businessId: stranger.businessId });

    // The canonical journey uses the Monthly offering (KES 149 / 30 days) on the owner's business.
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const chosen = await call(checkoutPost, "https://jata.test/api/checkout", {
      method: "POST",
      body: { businessId: ctx.owner.businessId, planId: ctx.monthlyPlanId, amount: 1, priceKES: 1 },
    });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
    ctx.paymentReference = chosen.body?.reference as string;
    expect(ctx.paymentReference).toBeTruthy();

    const payment = await prisma.payment.findUnique({ where: { reference: ctx.paymentReference } });
    expect(payment?.amount).toBe(14900); // KES 149 in kobo — a browser-supplied amount is ignored
    expect(payment?.currency).toBe("KES");
    expect(payment?.status).toBe("PENDING");
    expect(payment?.businessId).toBe(ctx.owner.businessId);
    expect(payment?.userId).toBe(ctx.owner.userId);

    // Every canonical offering flows through the same checkout architecture, priced server-side.
    const expectedAmounts: Record<string, number> = {
      ANNUAL: 99900,
      MONTHLY: 14900,
      AI_BUSINESS_FRONT_DESK: 49900,
      INTERACTIVE_BUSINESS: 99900,
    };
    for (const canonical of CANONICAL_PLANS) {
      const plan = await prisma.planConfig.findUnique({ where: { key: canonical.key } });
      expect(plan, canonical.key).toBeTruthy();
      const attempt = await call(checkoutPost, "https://jata.test/api/checkout", {
        method: "POST",
        body: { businessId: stranger.businessId, planId: plan!.id, amount: 7 },
      });
      expect(attempt.status, `${canonical.key}: ${JSON.stringify(attempt.body)}`).toBe(200);
      const attemptPayment = await prisma.payment.findUnique({ where: { reference: attempt.body?.reference } });
      expect(attemptPayment?.amount, canonical.key).toBe(expectedAmounts[canonical.key]);
    }

    // Cross-tenant checkout is rejected: a user may only pay for their own business.
    h.session.current = { userId: stranger.userId, role: "OWNER" };
    const stolen = await call(checkoutPost, "https://jata.test/api/checkout", {
      method: "POST",
      body: { businessId: ctx.owner.businessId, planId: ctx.monthlyPlanId },
    });
    expect(stolen.status).toBe(403);
  }, 120_000);

  it("7 — no unpaid publication: the server gate refuses the owner, a direct API call and the studio", async () => {
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const direct = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, isPublished: true },
    });
    expect(direct.status).toBe(403);
    // The refusal is the documented safe message — no internals, no tenant detail.
    expect(direct.body?.error).toBe(SAFE_ERRORS.publishPaymentRequired);

    const studio = await call(publishPost, "https://jata.test/api/experience/publish", {
      method: "POST",
      body: { businessId: ctx.owner.businessId },
    });
    expect(studio.status).toBe(403);
    expect(studio.body).toMatchObject({ published: false, requires: "PAYMENT" });

    // No session at all: still refused, and the row is untouched.
    h.session.current = null;
    const anonymous = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, isPublished: true },
    });
    expect(anonymous.status).toBe(401);

    expect((await prisma.business.findUnique({ where: { id: ctx.owner.businessId } }))?.isPublished).toBe(false);
    await expect(renderPublicPage(ctx.owner.slug)).rejects.toThrow();
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
  }, 120_000);

  it("8 — paying and verifying activates the subscription for the right tenant", async () => {
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const verified = await call(
      paymentVerifyGet,
      `https://jata.test/api/paystack/verify?reference=${encodeURIComponent(ctx.paymentReference)}&mock=success`,
    );
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE" });

    const payment = await prisma.payment.findUnique({ where: { reference: ctx.paymentReference } });
    expect(payment?.status).toBe("PAID");

    const subscription = await prisma.subscription.findUnique({ where: { businessId: ctx.owner.businessId }, include: { plan: true } });
    expect(subscription?.status).toBe("ACTIVE");
    expect(subscription?.userId).toBe(ctx.owner.userId);
    expect(subscription?.plan.key).toBe("MONTHLY");
    const days = subscription?.expiresAt ? (subscription.expiresAt.getTime() - Date.now()) / 86400000 : 0;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    // Re-verifying is idempotent: one payment, one subscription, no double extension.
    const again = await call(
      paymentVerifyGet,
      `https://jata.test/api/paystack/verify?reference=${encodeURIComponent(ctx.paymentReference)}&mock=success`,
    );
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "PAID" });
    expect(await prisma.subscription.count({ where: { businessId: ctx.owner.businessId } })).toBe(1);
  }, 120_000);

  it("9 — payment and subscription ownership: another tenant cannot read them", async () => {
    h.session.current = { userId: ctx.stranger.userId, role: "OWNER" };
    const foreignPayment = await call(
      paymentVerifyGet,
      `https://jata.test/api/paystack/verify?reference=${encodeURIComponent(ctx.paymentReference)}`,
    );
    expect(foreignPayment.status).toBe(403);

    // The stranger cannot publish the owner's business either.
    const foreignPublish = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, isPublished: true },
    });
    expect(foreignPublish.status).toBe(403);
    expect((await prisma.business.findUnique({ where: { id: ctx.owner.businessId } }))?.isPublished).toBe(false);
  }, 120_000);

  it("10 — publish: a paid owner publishes and the public /b/[slug] page becomes reachable", async () => {
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const published = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, isPublished: true },
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect((await prisma.business.findUnique({ where: { id: ctx.owner.businessId } }))?.isPublished).toBe(true);

    // A signed-out visitor now gets the real page, with the owner's content in it.
    h.session.current = null;
    const guestRender = await renderPublicPage(ctx.owner.slug);
    expect(treeContains(guestRender, `E2E Canonical ${runId} Studio`)).toBe(true);
    expect(treeContains(guestRender, "Braiding")).toBe(true);
    expect(getBusinessUrl(ctx.owner.slug)).toContain(`/b/${ctx.owner.slug}`);

    // The services API agrees: the catalogue of a published business is public.
    const publicServices = await call(servicesGet, `https://jata.test/api/services?businessId=${ctx.owner.businessId}`);
    expect(publicServices.status).toBe(200);
    expect((publicServices.body?.services || []).map((service: any) => service.title)).toContain("Braiding");

    // The storefront reads agree: the business is public and its services are exposed.
    const stored = await prisma.business.findUnique({
      where: { id: ctx.owner.businessId },
      include: { members: { select: { userId: true, role: true } } },
    });
    expect(
      publicPageDecision({
        business: {
          isPublished: stored!.isPublished,
          ownerId: stored!.ownerId,
          ownerMemberIds: stored!.members.filter((member) => member.role === "OWNER").map((member) => member.userId),
        },
        viewer: null,
      }),
    ).toBe("public");
  }, 120_000);

  it("11 — unpublish hides the page again, republish brings it back (no owner lock-out)", async () => {
    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const hidden = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, isPublished: false },
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
    h.session.current = null;
    await expect(renderPublicPage(ctx.owner.slug)).rejects.toThrow();

    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
    const back = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.owner.businessId, isPublished: true },
    });
    expect(back.status).toBe(200);
    h.session.current = null;
    expect(await renderPublicPage(ctx.owner.slug)).toBeTruthy();
  }, 120_000);

  it("12 — an unpaid second business can build but not publish", async () => {
    h.session.current = { userId: ctx.stranger.userId, role: "OWNER" };
    const edit = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.stranger.businessId, location: "Westlands, Nairobi" },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    const publish = await call(businessPatch, "https://jata.test/api/business", {
      method: "PATCH",
      body: { businessId: ctx.stranger.businessId, isPublished: true },
    });
    expect(publish.status).toBe(403);
    expect((await prisma.business.findUnique({ where: { id: ctx.stranger.businessId } }))?.isPublished).toBe(false);
    h.session.current = null;
    await expect(renderPublicPage(ctx.stranger.slug)).rejects.toThrow();

    // The publication gate covers the API too: a draft business's services are not readable.
    const draftServices = await call(servicesGet, `https://jata.test/api/services?businessId=${ctx.stranger.businessId}`);
    expect(draftServices.status).toBe(404);
  }, 120_000);
});

describe.skipIf(enabled)("canonical JATA AFTERCALL journey (real database)", () => {
  it("is skipped until DATABASE_URL is configured", () => {
    expect(enabled).toBe(false);
  });
});
