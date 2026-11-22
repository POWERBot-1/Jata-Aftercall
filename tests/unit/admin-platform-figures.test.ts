/**
 * R-ADM-01 — admin money figures keep Jata revenue, merchant takings and foreign currency apart,
 * and a failed read is "Unavailable", never zero. The real-PostgreSQL reconciliation of the same
 * pages lives in tests/prisma/admin-reporting-reconciliation-postgres.test.ts.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPaidPayments, paymentPurposeLabel, renewalCounts } from "@/lib/admin/platform-figures";
import { collectStats } from "../helpers/react-tree";

const db = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/adminGuard", () => ({ requireAdminPage: async () => ({ userId: "admin", role: "ADMIN" }) }));
vi.mock("@/lib/db", () => {
  const reject = () => Promise.reject(new Error("database unavailable"));
  const ok = <T,>(value: T) => () => (db.fail ? reject() : Promise.resolve(value));
  return {
    default: {
      user: { count: () => Promise.resolve(3) },
      business: { count: () => Promise.resolve(2) },
      subscription: { count: () => Promise.resolve(1) },
      payment: {
        count: () => Promise.resolve(9),
        groupBy: ok([
          { purpose: "SUBSCRIPTION", currency: "KES", _count: { _all: 2 }, _sum: { amount: 350000 } },
          { purpose: "ORDER", currency: "KES", _count: { _all: 1 }, _sum: { amount: 250000 } },
        ]),
      },
      analyticsEvent: { groupBy: ok([{ eventType: "PAGE_VIEW", _count: { eventType: 7 } }]) },
    },
  };
});

import AdminOverview from "@/app/admin/page";

describe("classifyPaidPayments", () => {
  it("counts only KES plan subscriptions as Jata revenue", () => {
    const figures = classifyPaidPayments([
      { purpose: "SUBSCRIPTION", currency: "KES", count: 2, amountMinor: 350000 },
      { purpose: "ORDER", currency: "KES", count: 3, amountMinor: 250000 },
      { purpose: "BOOKING_DEPOSIT", currency: "KES", count: 1, amountMinor: 50000 },
    ]);
    expect(figures.subscriptionRevenueMinor).toBe(350000);
    expect(figures.subscriptionPayments).toBe(2);
    expect(figures.merchantTakingsMinor).toBe(300000);
    expect(figures.merchantPayments).toBe(4);
    expect(figures.totalPaidRows).toBe(6);
  });

  it("never converts or adds another currency, and never drops it", () => {
    const figures = classifyPaidPayments([
      { purpose: "SUBSCRIPTION", currency: "USD", count: 1, amountMinor: 1000 },
      { purpose: "SUBSCRIPTION", currency: "kes", count: 1, amountMinor: 200 },
    ]);
    expect(figures.subscriptionRevenueMinor).toBe(200); // lower-case KES is still KES
    expect(figures.otherCurrency).toEqual([{ currency: "USD", purpose: "SUBSCRIPTION", count: 1, amountMinor: 1000 }]);
    expect(figures.totalPaidRows).toBe(2);
  });

  it("reports unknown purposes as unclassified instead of guessing", () => {
    const figures = classifyPaidPayments([
      { purpose: "GIFT_CARD", currency: "KES", count: 4, amountMinor: 400 },
      { purpose: null, currency: "KES", count: 1, amountMinor: 1 },
    ]);
    expect(figures.subscriptionRevenueMinor).toBe(0);
    expect(figures.merchantTakingsMinor).toBe(0);
    expect(figures.unclassified).toEqual([
      { purpose: "GIFT_CARD", count: 4, amountMinor: 400 },
      { purpose: "(none)", count: 1, amountMinor: 1 },
    ]);
  });

  it("every PAID row lands in exactly one bucket", () => {
    const groups = [
      { purpose: "SUBSCRIPTION", currency: "KES", count: 5, amountMinor: 1 },
      { purpose: "ORDER", currency: "KES", count: 7, amountMinor: 1 },
      { purpose: "ORDER", currency: "UGX", count: 2, amountMinor: 1 },
      { purpose: "X", currency: "KES", count: 3, amountMinor: 1 },
    ];
    const f = classifyPaidPayments(groups);
    const bucketed = f.subscriptionPayments + f.merchantPayments
      + f.otherCurrency.reduce((s, r) => s + r.count, 0) + f.unclassified.reduce((s, r) => s + r.count, 0);
    expect(bucketed).toBe(f.totalPaidRows);
    expect(f.totalPaidRows).toBe(17);
  });

  it("labels purposes without relabelling unknown ones", () => {
    expect(paymentPurposeLabel("ORDER")).toBe("Customer order");
    expect(paymentPurposeLabel("SUBSCRIPTION")).toBe("Plan subscription");
    expect(paymentPurposeLabel("NEW_KIND")).toBe("NEW_KIND");
  });
});

describe("renewalCounts", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
  it("a lapsed or non-active subscription is never 'due within 14 days'", () => {
    const counts = renewalCounts([
      { status: "ACTIVE", expiresAt: days(3) },
      { status: "ACTIVE", expiresAt: days(14) },
      { status: "ACTIVE", expiresAt: days(15) },
      { status: "ACTIVE", expiresAt: days(-2) },
      { status: "EXPIRED", expiresAt: days(-2) },
      { status: "CANCELLED", expiresAt: days(5) },
      { status: "ACTIVE", expiresAt: null },
      { status: "EXPIRING", expiresAt: days(1) },
    ], now);
    expect(counts).toEqual({ dueSoon: 3, overdue: 1 });
  });
});

describe("admin overview page", () => {
  beforeEach(() => { db.fail = false; });

  it("labels PAID-status payment amounts separately without claiming settlement", async () => {
    const stats = collectStats(await AdminOverview());
    expect(stats["PAID subscription payment amount (KES)"]).toBe("3,500");
    expect(stats["PAID customer payments to businesses (KES)"]).toBe("2,500");
    expect(Object.keys(stats)).not.toContain("Settled revenue (KES)");
    expect(stats["Page views"]).toBe("7");
  });

  it("a failed money or analytics read is shown as Unavailable, never as 0", async () => {
    db.fail = true;
    const stats = collectStats(await AdminOverview());
    expect(stats["PAID subscription payment amount (KES)"]).toBe("Unavailable");
    expect(stats["PAID customer payments to businesses (KES)"]).toBe("Unavailable");
    expect(stats["Page views"]).toBe("Unavailable");
    expect(stats["WhatsApp taps"]).toBe("Unavailable");
  });

  it("admin ledgers read only displayed fields (no whole User rows)", () => {
    for (const file of ["app/admin/payments/page.tsx", "app/admin/subscriptions/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/include:\s*\{[^}]*user:\s*true/);
      expect(source, file).toMatch(/user:\s*\{\s*select:\s*\{\s*email:\s*true\s*\}\s*\}/);
    }
    expect(readFileSync("app/admin/page.tsx", "utf8")).not.toMatch(/aggregate\(\{\s*where:\s*\{\s*status:\s*"PAID"\s*\}/);
  });
});
