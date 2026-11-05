/**
 * AI Front Desk 2.0 — entitlement reads and syncs must preserve the purchased tier (§41.3, §41.4).
 *
 * Regression pinned here: `syncAIPackageEntitlement` used to hardcode
 * `packageKey: "AI_BUSINESS_FRONT_DESK"` on every upsert, which would silently downgrade a
 * Standard/Pro/Voice customer's entitlement row to Starter the first time the status was
 * synced. The sync must persist the tier the billing state actually resolved.
 *
 * All database access is mocked; no production or local data is read or written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  entitlementRow: null as Record<string, unknown> | null,
  subscription: null as Record<string, unknown> | null,
  paidPayment: null as Record<string, unknown> | null,
  planById: {} as Record<string, Record<string, unknown>>,
  planByKey: {} as Record<string, Record<string, unknown>>,
  upserts: [] as Array<Record<string, any>>,
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => null) },
    aIPackageEntitlement: {
      findUnique: vi.fn(async () => mocks.entitlementRow),
      upsert: vi.fn(async (args: Record<string, any>) => {
        mocks.upserts.push(args);
        return args;
      }),
    },
    subscription: { findUnique: vi.fn(async () => mocks.subscription) },
    payment: { findFirst: vi.fn(async () => mocks.paidPayment) },
    planConfig: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; key?: string } }) =>
        where.key ? mocks.planByKey[where.key] ?? null : (where.id ? mocks.planById[where.id] ?? null : null),
      ),
    },
  },
}));

import { getAIPackageStatus, syncAIPackageEntitlement } from "@/lib/ai-entitlement";

const future = new Date(Date.now() + 20 * 86400000);

beforeEach(() => {
  mocks.entitlementRow = null;
  mocks.subscription = null;
  mocks.paidPayment = null;
  mocks.planById = {};
  mocks.planByKey = {};
  mocks.upserts = [];
});

describe("tier-preserving entitlement sync", () => {
  it("a Standard-tier subscription syncs packageKey AI_FRONT_DESK_STANDARD, never the Starter key", async () => {
    mocks.subscription = {
      status: "ACTIVE",
      planId: "plan_ai_front_desk_standard",
      expiresAt: future,
      plan: { key: "AI_FRONT_DESK_STANDARD" },
    };
    mocks.planById["plan_ai_front_desk_standard"] = { id: "plan_ai_front_desk_standard", key: "AI_FRONT_DESK_STANDARD" };
    mocks.paidPayment = { status: "PAID", planId: "plan_ai_front_desk_standard" };

    const status = await getAIPackageStatus("biz_standard_tier");
    expect(status.entitled).toBe(true);
    expect(status.packageKey).toBe("AI_FRONT_DESK_STANDARD");
    expect(status.priceKES).toBe(999);

    const synced = await syncAIPackageEntitlement("biz_standard_tier");
    expect(synced.verification).toBe("VERIFIED");
    expect(mocks.upserts).toHaveLength(1);
    expect(mocks.upserts[0].update.packageKey).toBe("AI_FRONT_DESK_STANDARD");
    expect(mocks.upserts[0].create.packageKey).toBe("AI_FRONT_DESK_STANDARD");
    expect(mocks.upserts[0].update.packageKey).not.toBe("AI_BUSINESS_FRONT_DESK");
  });

  it("a legacy Starter subscription keeps syncing the legacy key unchanged (Option A preservation)", async () => {
    mocks.subscription = {
      status: "ACTIVE",
      planId: "plan_ai_front_desk",
      expiresAt: future,
      plan: { key: "AI_BUSINESS_FRONT_DESK" },
    };
    mocks.planById["plan_ai_front_desk"] = { id: "plan_ai_front_desk", key: "AI_BUSINESS_FRONT_DESK" };
    mocks.paidPayment = { status: "PAID", planId: "plan_ai_front_desk" };

    const status = await getAIPackageStatus("biz_legacy_starter");
    expect(status.entitled).toBe(true);
    expect(status.packageKey).toBe("AI_BUSINESS_FRONT_DESK");
    expect(status.priceKES).toBe(499);

    await syncAIPackageEntitlement("biz_legacy_starter");
    expect(mocks.upserts[0].update.packageKey).toBe("AI_BUSINESS_FRONT_DESK");
  });

  it("an ACTIVE entitlement row alone reports its own tier price (Pro = 1,999)", async () => {
    mocks.entitlementRow = {
      status: "ACTIVE",
      packageKey: "AI_FRONT_DESK_PRO",
      expiresAt: future,
    };

    const status = await getAIPackageStatus("biz_pro_entitlement_row");
    expect(status.entitled).toBe(true);
    expect(status.packageKey).toBe("AI_FRONT_DESK_PRO");
    expect(status.priceKES).toBe(1999);
    expect(status.billingCycleDays).toBe(30);
  });

  it("a non-Front-Desk subscription is denied even when a stale entitlement row says ACTIVE", async () => {
    mocks.subscription = {
      status: "ACTIVE",
      planId: "plan_monthly",
      expiresAt: future,
      plan: { key: "MONTHLY" },
    };
    mocks.planById["plan_monthly"] = { id: "plan_monthly", key: "MONTHLY" };
    mocks.entitlementRow = { status: "ACTIVE", packageKey: "AI_FRONT_DESK_STANDARD", expiresAt: future };

    const status = await getAIPackageStatus("biz_plan_substitution");
    expect(status.entitled).toBe(false);
    expect(status.status).toBe("NONE");
  });

  it("an unavailable billing read never writes a guessed entitlement (fail-closed preserved)", async () => {
    // Make the subscription read throw to simulate a billing outage.
    const { vi: v } = await import("vitest");
    const db = await import("@/lib/db");
    (db.default.subscription.findUnique as ReturnType<typeof v.fn>).mockRejectedValueOnce(new Error("outage"));

    const synced = await syncAIPackageEntitlement("biz_billing_outage");
    expect(synced.verification).toBe("UNAVAILABLE");
    expect(synced.entitled).toBe(false);
    expect(mocks.upserts).toHaveLength(0);
  });
});
