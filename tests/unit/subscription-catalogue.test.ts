/**
 * The authenticated subscription page shows the complete JATA AFTERCALL catalogue.
 *
 * Requirements pinned here (2026-10-29):
 *   • All seven offers — Monthly, Annual, AI Front Desk, Website Studio, Business POS, JATA BOS
 *     PRO and JATA Autopilot — appear in the marketing order, each with its stored price, billing
 *     duration, a short description and a working action.
 *   • JATA BOS PRO (`ERP_PRO`) appears exactly once and is never sent through the business-page
 *     checkout; it links to its product page and its own workspace flow.
 *   • An offer appearing on the page is never presented as a subscription: only the plan the
 *     business actually holds is marked as current, and product status is read (never written)
 *     from the owner's own rows — no other tenant's data can leak onto this screen.
 *   • Viewing the catalogue writes nothing: no subscription is created, renewed or altered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  session: { userId: "user_owner", role: "OWNER" } as null | { userId: string; role: string },
  plans: [] as Array<Record<string, unknown>>,
  businesses: [] as Array<Record<string, unknown>>,
  payments: [] as Array<Record<string, unknown>>,
  posSub: null as null | { status: string; planKey?: string | null },
  erpSub: null as null | { status: string; planKey?: string | null },
  apSub: null as null | { status: string; planKey?: string | null },
  lastErpLookup: null as null | string,
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: { findMany: vi.fn(async () => state.businesses) },
    planConfig: { findMany: vi.fn(async () => state.plans) },
    payment: { findMany: vi.fn(async () => state.payments) },
    posSubscription: { findUnique: vi.fn(async ({ where }: { where: { businessId: string } }) => state.posSub) },
    erpSubscription: {
      findUnique: vi.fn(async ({ where }: { where: { businessId: string } }) => {
        state.lastErpLookup = where.businessId;
        return state.erpSub;
      }),
    },
    autopilotSubscription: { findUnique: vi.fn(async () => state.apSub) },
  },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  requireSession: vi.fn(async () => state.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

import SubscriptionPage from "@/app/dashboard/subscription/page";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const STORED_ROWS = [
  { id: "p1", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { id: "p2", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  { id: "p5", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { id: "p6", key: "ERP_PRO", name: "POS / ERP - PRO", priceKES: 3000, durationDays: 30, isActive: true },
  { id: "p7", key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30, isActive: true },
  { id: "p8", key: "JATA_AUTOPILOT_PRO", name: "JATA Autopilot Pro — KES 6,999/month", priceKES: 6999, durationDays: 30, isActive: true },
];

const REQUIRED_ORDER = ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS", "BUSINESS_POS", "ERP_PRO", "JATA_AUTOPILOT"];

const render = async () =>
  renderToStaticMarkup(await SubscriptionPage({ searchParams: Promise.resolve({ businessId: "biz_owned" }) } as any));

/** Catalogue cards only — `data-plan` articles in the complete-catalogue section. */
const catalogueCards = (html: string) => {
  const start = html.indexOf('id="catalogue"');
  const end = html.indexOf("Subscription status", start);
  const section = html.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/<article[^>]*data-plan="([A-Z_]+)"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => ({
    key: match[1],
    inner: match[2],
  }));
};

describe("subscription page: the complete catalogue", () => {
  it("shows all seven offers exactly once each, in the marketing order, with prices and periods", async () => {
    state.session = { userId: "user_owner", role: "OWNER" };
    state.plans = STORED_ROWS;
    state.businesses = [
      {
        id: "biz_owned",
        name: "Biashara Ltd",
        slug: "biashara-ltd",
        category: "Retail",
        subscription: { status: "ACTIVE", planId: "p1", expiresAt: new Date("2026-11-30T00:00:00Z"), plan: { name: "Monthly — KES 149/month" } },
      },
    ];
    state.payments = [];
    state.posSub = null;
    state.erpSub = null;
    state.apSub = null;

    const html = await render();
    const cards = catalogueCards(html);

    expect(cards.map((card) => card.key)).toEqual(REQUIRED_ORDER);
    const erp = cards.find((card) => card.key === "ERP_PRO")!;
    expect(erp.inner).toContain("JATA BOS PRO");
    expect(erp.inner).toContain("Business Operating System Pro");
    expect(erp.inner).toContain("KES 3,000");
    expect(erp.inner).toContain("per 30 days");

    expect(cards.find((card) => card.key === "MONTHLY")!.inner).toContain("KES 149");
    expect(cards.find((card) => card.key === "ANNUAL")!.inner).toContain("per year");
    expect(cards.find((card) => card.key === "BUSINESS_POS")!.inner).toContain("KES 499");
    expect(cards.find((card) => card.key === "JATA_AUTOPILOT")!.inner).toContain("KES 2,499");
    expect(cards.find((card) => card.key === "AI_BUSINESS_FRONT_DESK")!.inner).toContain("KES 499");
    expect(cards.find((card) => card.key === "INTERACTIVE_BUSINESS")!.inner).toContain("KES 999");
    // No Autopilot Pro/Enterprise tier leaks into the customer catalogue.
    expect(html).not.toContain("Autopilot Pro");
    expect(html).not.toContain("Autopilot Enterprise");
  });

  it("gives every offer a working action, and keeps BOS PRO out of the business-page checkout", async () => {
    const html = await render();
    const cards = catalogueCards(html);
    const erp = cards.find((card) => card.key === "ERP_PRO")!.inner;

    for (const card of cards) {
      expect(card.inner, card.key).toContain("View details");
    }
    expect(erp).toContain('href="/products/erp-pro"');
    expect(erp).toContain('href="/dashboard/erp"');
    expect(erp).not.toContain("/checkout");
    expect(cards.find((card) => card.key === "BUSINESS_POS")!.inner).toContain('href="/dashboard/pos"');
    expect(cards.find((card) => card.key === "JATA_AUTOPILOT")!.inner).toContain('href="/dashboard/autopilot"');
    // The payable section still offers checkout only for the four page plans.
    expect(html).toContain('href="/checkout?businessId=biz_owned&amp;planId=p1"');
  });

  it("distinguishes ordinary subscriptions from separate products", async () => {
    const html = await render();
    const cards = catalogueCards(html);
    expect(cards.find((card) => card.key === "MONTHLY")!.inner).toMatch(/ordinary subscription/);
    expect(cards.find((card) => card.key === "ERP_PRO")!.inner).toMatch(/Separate product · bought in its own workspace/);
    expect(cards.find((card) => card.key === "BUSINESS_POS")!.inner).toMatch(/Separate product/);
    expect(html).toContain("an offer here is not a subscription");
  });
});

describe("subscription status is truthful and tenant-scoped", () => {
  it("marks only the held plan as current; every other offer reads Not active", async () => {
    state.plans = STORED_ROWS;
    state.businesses = [
      {
        id: "biz_owned",
        name: "Biashara Ltd",
        slug: "biashara-ltd",
        category: "Retail",
        subscription: { status: "ACTIVE", planId: "p1", expiresAt: new Date("2026-11-30T00:00:00Z"), plan: { name: "Monthly — KES 149/month" } },
      },
    ];
    state.erpSub = null;
    state.posSub = null;
    state.apSub = null;

    const html = await render();
    const cards = catalogueCards(html);
    const current = cards.filter((card) => card.inner.includes("Your current plan"));
    expect(current.map((card) => card.key)).toEqual(["MONTHLY"]);
    for (const card of cards.filter((entry) => entry.key !== "MONTHLY")) {
      expect(card.inner, card.key).toContain("Not active");
      expect(card.inner, card.key).toContain("nothing is subscribed just by seeing this offer");
    }
  });

  it("shows a product's status only from the owner's own row, read-only", async () => {
    state.plans = STORED_ROWS;
    state.businesses = [
      {
        id: "biz_owned",
        name: "Biashara Ltd",
        slug: "biashara-ltd",
        category: "Retail",
        subscription: { status: "ACTIVE", planId: "p1", expiresAt: new Date("2026-11-30T00:00:00Z"), plan: { name: "Monthly — KES 149/month" } },
      },
    ];
    state.erpSub = { status: "ACTIVE", planKey: "ERP_PRO" };
    state.posSub = { status: "EXPIRED", planKey: "BUSINESS_POS" };
    state.apSub = null;

    const html = await render();
    const cards = catalogueCards(html);

    expect(cards.find((card) => card.key === "ERP_PRO")!.inner).toContain("Active");
    expect(cards.find((card) => card.key === "ERP_PRO")!.inner).toContain("Recorded for Biashara Ltd");
    expect(cards.find((card) => card.key === "BUSINESS_POS")!.inner).toContain("Expired");
    // The lookup is scoped to the owner's selected business and nothing else.
    expect(state.lastErpLookup).toBe("biz_owned");
    // A row for one product never implies another product is held.
    expect(cards.find((card) => card.key === "JATA_AUTOPILOT")!.inner).toContain("Not active");
  });

  it("fabricates no status when nothing is known", async () => {
    state.plans = STORED_ROWS;
    state.businesses = [];
    state.erpSub = null;

    const html = await render();
    const cards = catalogueCards(html);
    expect(cards.map((card) => card.key)).toEqual(REQUIRED_ORDER);
    for (const card of cards) {
      expect(card.inner, card.key).toContain("Not active");
      expect(card.inner, card.key).toContain("Create or select a business to see its status");
      expect(card.inner, card.key).not.toContain("Your current plan");
      expect(card.inner, card.key).not.toContain("Recorded for");
    }
  });

  it("never writes: viewing the catalogue creates, updates or deletes nothing", () => {
    const source = read("app/dashboard/subscription/page.tsx");
    expect(source).not.toMatch(/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
    expect(source).toContain("ownerFilter");
    expect(source).toContain("ownerId: session.userId");
  });
});
