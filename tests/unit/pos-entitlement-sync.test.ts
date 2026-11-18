/**
 * R-ADM-03 — syncPosEntitlement runs on every POS request. It must keep the activation time of an
 * entitled business (the admin entitlement view reads it) and must not rewrite an unchanged row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  row: null as null | { status: string; activatedAt: Date | null; expiresAt: Date | null },
  upserts: [] as any[],
  expiresAt: new Date(Date.now() + 20 * 86_400_000),
}));

vi.mock("@/lib/team-access", () => ({ hasTeamFreeAccessForBusiness: async () => false, TEAM_FREE_ACCESS_LABEL: "Team" }));
vi.mock("@/lib/pricing", () => ({ getBusinessPosPlan: async () => ({ id: "plan-pos", key: "BUSINESS_POS", priceKES: 499, durationDays: 30 }) }));
vi.mock("@/lib/db", () => ({
  default: {
    posSubscription: { findUnique: async () => ({ status: "ACTIVE", planKey: "BUSINESS_POS", startAt: new Date(Date.now() - 86_400_000), expiresAt: db.expiresAt, graceUntil: null }) },
    posEntitlement: {
      findUnique: async () => (db.row ? { ...db.row } : null),
      upsert: async (args: any) => {
        db.upserts.push(args);
        db.row = { status: args.update.status, activatedAt: args.update.activatedAt, expiresAt: args.update.expiresAt };
        return db.row;
      },
    },
    payment: { findFirst: async () => ({ status: "PAID" }) },
    posConfiguration: { findUnique: async () => ({ status: "LIVE", publishedVersion: 1 }) },
  },
}));

import { syncPosEntitlement } from "@/lib/pos/entitlement";

describe("syncPosEntitlement (R-ADM-03)", () => {
  beforeEach(() => { db.row = null; db.upserts = []; });

  it("keeps the first activation time across later requests and does not rewrite an unchanged row", async () => {
    const first = await syncPosEntitlement("biz-1");
    expect(first.entitled).toBe(true);
    expect(db.upserts).toHaveLength(1);
    const activatedAt = db.row!.activatedAt!.getTime();

    await new Promise((resolve) => setTimeout(resolve, 15));
    await syncPosEntitlement("biz-1");
    await syncPosEntitlement("biz-1");
    expect(db.upserts).toHaveLength(1); // nothing changed, nothing written
    expect(db.row!.activatedAt!.getTime()).toBe(activatedAt);
  });

  it("writes again when the derived state really changes (new expiry), still keeping the activation time", async () => {
    await syncPosEntitlement("biz-1");
    const activatedAt = db.row!.activatedAt!.getTime();
    db.expiresAt = new Date(db.expiresAt.getTime() + 30 * 86_400_000); // renewed
    await syncPosEntitlement("biz-1");
    expect(db.upserts).toHaveLength(2);
    expect(db.row!.expiresAt!.getTime()).toBe(db.expiresAt.getTime());
    expect(db.row!.activatedAt!.getTime()).toBe(activatedAt);
  });
});
