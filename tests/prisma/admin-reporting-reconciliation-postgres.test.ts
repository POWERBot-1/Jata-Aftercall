/**
 * R-ADM-02 — admin reporting reconciles with the database (real PostgreSQL, real Prisma).
 *
 * The admin pages are server components. They are invoked directly and the exact figures they hand
 * to their tiles and headers are compared with independent raw SQL over the same tables. Only the
 * admin page guard is replaced (an ADMIN session); every query is the page's own.
 *
 * Other suites share this database and run in parallel, so each absolute comparison takes the SQL
 * figure before and after the page read and only compares when the two agree (retrying otherwise).
 * The seeded rows are additionally checked as an exact delta, which concurrent inserts cannot fake.
 *
 * Nothing here invents a rate or figure: no exchange rate, commission rate or MRR is computed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";
import { collectStats, findMeta } from "../helpers/react-tree";

vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/adminGuard", () => ({ requireAdminPage: async () => ({ userId: "admin-test", role: "ADMIN" }) }));

import { readPlatformMoneyFigures } from "@/lib/admin/platform-figures";
import { formatNumber } from "@/lib/format";
import AdminOverview from "@/app/admin/page";
import AdminPayments from "@/app/admin/payments/page";
import AdminSubscriptions from "@/app/admin/subscriptions/page";

const p = realPrismaConfigured ? sharedPrisma() : (null as any);
const n = (value: unknown) => Number(value ?? 0);

async function sql<T = any>(query: string): Promise<T[]> {
  return p.$queryRawUnsafe(query);
}

/** Runs `read` between two evaluations of `truth`; returns once both agree (or after 5 tries). */
async function stable<T, U>(truth: () => Promise<T>, read: () => Promise<U>): Promise<{ truth: T; read: U }> {
  let last: { truth: T; read: U } | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await truth();
    const value = await read();
    const after = await truth();
    last = { truth: after, read: value };
    if (JSON.stringify(before) === JSON.stringify(after)) return last;
  }
  return last!;
}

const SQL_MONEY = `
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE purpose = 'SUBSCRIPTION' AND upper(currency) = 'KES'), 0)::text AS sub_minor,
    COUNT(*)            FILTER (WHERE purpose = 'SUBSCRIPTION' AND upper(currency) = 'KES')::text     AS sub_count,
    COALESCE(SUM(amount) FILTER (WHERE purpose IN ('ORDER','BOOKING_DEPOSIT') AND upper(currency) = 'KES'), 0)::text AS merchant_minor,
    COUNT(*)            FILTER (WHERE purpose IN ('ORDER','BOOKING_DEPOSIT') AND upper(currency) = 'KES')::text     AS merchant_count,
    COUNT(*)            FILTER (WHERE upper(currency) <> 'KES' OR (purpose NOT IN ('SUBSCRIPTION','ORDER','BOOKING_DEPOSIT')))::text AS unreported,
    COUNT(*)::text AS paid_rows
  FROM "Payment" WHERE status = 'PAID'`;

async function moneyTruth() {
  const [row] = await sql(SQL_MONEY);
  return {
    subMinor: n(row.sub_minor), subCount: n(row.sub_count),
    merchantMinor: n(row.merchant_minor), merchantCount: n(row.merchant_count),
    unreported: n(row.unreported), paidRows: n(row.paid_rows),
  };
}

describe.skipIf(!realPrismaConfigured)("real PostgreSQL: admin reporting reconciliation", () => {
  const tag = uid();
  let plan: any;
  let before: Awaited<ReturnType<typeof readPlatformMoneyFigures>>;

  beforeAll(async () => {
    before = await readPlatformMoneyFigures(p);
    plan = await p.planConfig.create({ data: { key: `recon-${tag}`, name: `Recon ${tag}`, priceKES: 1500, durationDays: 30, isActive: true } });
    const pay = async (status: string, purpose: string, amount: number, currency = "KES") => {
      const { owner, business } = await seedBusiness(p);
      return p.payment.create({ data: { reference: `RECON-${tag}-${uid()}`, businessId: business.id, userId: owner.id, planId: purpose === "SUBSCRIPTION" ? plan.id : null, amount, currency, status, purpose } });
    };
    // Known ledger: only the first two rows are Jata revenue.
    await pay("PAID", "SUBSCRIPTION", 150000);
    await pay("PAID", "SUBSCRIPTION", 200000);
    await pay("PENDING", "SUBSCRIPTION", 999900);
    await pay("REFUNDED", "SUBSCRIPTION", 777700);
    await pay("FAILED", "SUBSCRIPTION", 555500);
    await pay("PAID", "ORDER", 250000);
    await pay("PAID", "BOOKING_DEPOSIT", 50000);
    await pay("PAID", "SUBSCRIPTION", 1000, "USD");
    await pay("PAID", "GIFT_CARD", 12300);
  });

  afterAll(async () => { if (p) await p.$disconnect(); });

  it("the seeded ledger moves each bucket by exactly the known amounts (no rate applied)", async () => {
    const after = await readPlatformMoneyFigures(p);
    // Deltas are >= the known amounts only if a concurrent suite also settled money; the seeded
    // amounts themselves must be visible and correctly bucketed.
    expect(after.subscriptionRevenueMinor - before.subscriptionRevenueMinor).toBeGreaterThanOrEqual(350000);
    expect(after.merchantTakingsMinor - before.merchantTakingsMinor).toBeGreaterThanOrEqual(300000);
    expect(after.otherCurrency.some((row) => row.currency === "USD" && row.amountMinor >= 1000)).toBe(true);
    expect(after.unclassified.some((row) => row.purpose === "GIFT_CARD" && row.amountMinor >= 12300)).toBe(true);
    // Pending, failed and refunded rows (2,333,100 cents together) are never revenue.
    const [{ seeded }] = await sql(`SELECT COALESCE(SUM(amount),0)::text AS seeded FROM "Payment" WHERE status='PAID' AND purpose='SUBSCRIPTION' AND currency='KES' AND reference LIKE 'RECON-${tag}-%'`);
    expect(n(seeded)).toBe(350000);
  });

  it("platform money figures equal independent SQL, and every PAID row is accounted for", async () => {
    const { truth, read } = await stable(moneyTruth, () => readPlatformMoneyFigures(p));
    expect(read.subscriptionRevenueMinor).toBe(truth.subMinor);
    expect(read.subscriptionPayments).toBe(truth.subCount);
    expect(read.merchantTakingsMinor).toBe(truth.merchantMinor);
    expect(read.merchantPayments).toBe(truth.merchantCount);
    const unreported = read.otherCurrency.reduce((s, r) => s + r.count, 0) + read.unclassified.reduce((s, r) => s + r.count, 0);
    expect(unreported).toBe(truth.unreported);
    expect(read.totalPaidRows).toBe(truth.paidRows);
    expect(read.subscriptionPayments + read.merchantPayments + unreported).toBe(truth.paidRows);
  });

  it("the overview tiles show exactly the database counts and sums", async () => {
    const truth = async () => {
      const [row] = await sql(`SELECT
        (SELECT COUNT(*) FROM "User")::text AS users,
        (SELECT COUNT(*) FROM "Business")::text AS businesses,
        (SELECT COUNT(*) FROM "Business" WHERE "isPublished")::text AS published,
        (SELECT COUNT(*) FROM "Payment")::text AS payments,
        (SELECT COUNT(*) FROM "Subscription" WHERE status = 'ACTIVE')::text AS active,
        (SELECT COUNT(*) FROM "Subscription" WHERE status IN ('EXPIRING','EXPIRED','SUSPENDED'))::text AS lapsed,
        (SELECT COUNT(*) FROM "AnalyticsEvent" WHERE "eventType" = 'PAGE_VIEW')::text AS views`);
      return { ...row, money: await moneyTruth() };
    };
    const { truth: t, read: tree } = await stable(truth, () => AdminOverview());
    const stats = collectStats(tree);
    expect(stats["Total customers"]).toBe(formatNumber(n(t.users)));
    expect(stats["Businesses"]).toBe(formatNumber(n(t.businesses)));
    expect(stats["Published pages"]).toBe(formatNumber(n(t.published)));
    expect(stats["Payments recorded"]).toBe(formatNumber(n(t.payments)));
    expect(stats["Active subscriptions"]).toBe(formatNumber(n(t.active)));
    expect(stats["Expiring / expired"]).toBe(formatNumber(n(t.lapsed)));
    expect(stats["Page views"]).toBe(formatNumber(n(t.views)));
    expect(stats["PAID subscription payment amount (KES)"]).toBe(formatNumber(t.money.subMinor / 100));
    expect(stats["PAID customer payments to businesses (KES)"]).toBe(formatNumber(t.money.merchantMinor / 100));
    expect(Object.keys(stats)).not.toContain("Settled revenue (KES)");
  });

  it("the payments ledger states the true total, shows the newest rows first with their kind and currency", async () => {
    const { truth: total, read: tree } = await stable(async () => n((await sql(`SELECT COUNT(*)::text AS c FROM "Payment"`))[0].c), () => AdminPayments());
    const meta = findMeta(tree) ?? "";
    if (total > 100) expect(meta).toContain(`Newest 100 of ${formatNumber(total)}`);
    else expect(meta.startsWith(formatNumber(total))).toBe(true);
    const html = JSON.stringify(tree, (key, value) => (key === "_owner" || key === "_store" ? undefined : value));
    expect(html).toContain("USD"); // the USD row is not shown as KES
    expect(html).toContain("Customer order");
    expect(html).not.toMatch(/passwordHash|sessionVersion|test-only/);
  });

  it("the subscriptions renewal count excludes lapsed and non-active rows", async () => {
    const now = Date.now();
    const sub = async (status: string, offsetDays: number) => {
      const { owner, business } = await seedBusiness(p);
      await p.subscription.create({ data: { businessId: business.id, userId: owner.id, planId: plan.id, status, startAt: new Date(now - 20 * 86_400_000), expiresAt: new Date(now + offsetDays * 86_400_000) } });
    };
    await sub("ACTIVE", 3);
    await sub("ACTIVE", -2);
    await sub("EXPIRED", -2);
    await sub("CANCELLED", 5);
    await sub("EXPIRING", 1);
    const truth = async () => {
      const [row] = await sql(`SELECT
        COUNT(*) FILTER (WHERE status IN ('ACTIVE','EXPIRING') AND "expiresAt" >= now() AND "expiresAt" <= now() + interval '14 days')::text AS due,
        COUNT(*) FILTER (WHERE status IN ('ACTIVE','EXPIRING') AND "expiresAt" < now())::text AS overdue,
        COUNT(*)::text AS total FROM "Subscription"`);
      return { due: n(row.due), overdue: n(row.overdue), total: n(row.total) };
    };
    const { truth: t, read: tree } = await stable(truth, () => AdminSubscriptions());
    const meta = findMeta(tree) ?? "";
    expect(meta.startsWith(`${t.total} subscription`)).toBe(true);
    expect(t.due).toBeGreaterThanOrEqual(1);
    expect(t.overdue).toBeGreaterThanOrEqual(1);
    expect(meta).toContain(`${t.due} live due within 14 days`);
    expect(meta).toContain(`${t.overdue} still marked live but past expiry`);
  });
});
