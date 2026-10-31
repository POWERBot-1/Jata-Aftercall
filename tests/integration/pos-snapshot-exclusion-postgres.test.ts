import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import { finalizeReportSnapshot, getReportSnapshot } from "@/lib/pos/report-snapshots";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any, ownerId: string, businessId: string, otherBusinessId: string;

describe.skipIf(!realPrismaConfigured)("snapshot credit projection exclusion on PostgreSQL", () => {
  beforeAll(async () => {
    db = makeRealPrisma(); holder.client = db;
    ownerId = (await db.user.create({ data: { email: `snapshot-exclusion-${stamp}@example.test`, name: "Test", passwordHash: "not-a-real-login" } })).id;
    businessId = (await db.business.create({ data: { ownerId, slug: `snapshot-main-${stamp}`, name: "Test", category: "retail" } })).id;
    otherBusinessId = (await db.business.create({ data: { ownerId, slug: `snapshot-other-${stamp}`, name: "Other", category: "retail" } })).id;
  });
  afterAll(async () => {
    // Snapshot deletion is intentionally protected. Business deletion cascades through the trigger.
    if (businessId) await db.business.delete({ where: { id: businessId } });
    if (otherBusinessId) await db.business.delete({ where: { id: otherBusinessId } });
    if (ownerId) await db.user.delete({ where: { id: ownerId } });
    if (db) await db.$disconnect();
  });

  it("omits new projected balances while retaining the period credit rows", async () => {
    await db.posCreditEntry.createMany({ data: [
      { businessId, partyType: "CUSTOMER", partyId: "p1", direction: "DEBIT", amountKES: 100, createdAt: new Date("2005-01-01T12:00:00Z") },
      { businessId, partyType: "CUSTOMER", partyId: "p1", direction: "CREDIT", amountKES: 30, createdAt: new Date("2005-01-02T12:00:00Z") },
    ] });
    const snapshot = await finalizeReportSnapshot({ businessId, branchId: null, actorId: ownerId, from: "2005-01-02", to: "2005-01-02" });
    expect(snapshot.payload.periodLedger.creditProjection).toBeUndefined();
    expect(snapshot.payload.periodLedger.creditEntries).toEqual([expect.objectContaining({ partyId: "p1", direction: "CREDIT", amountKES: 30 })]);
    expect((await db.posReportSnapshot.findUnique({ where: { id: snapshot.id } })).payload).toEqual(snapshot.payload);
    expect(await getReportSnapshot(otherBusinessId, null, snapshot.id)).toBeNull();
  });

  it("hides legacy unverified projection without rewriting immutable historical data", async () => {
    const payload = { periodLedger: { creditProjection: { available: true, accounts: [{ openingKES: 100, closingKES: 70 }] }, creditEntries: [{ id: "existing" }] }, note: "original" };
    const row = await db.posReportSnapshot.create({ data: { businessId, scopeKey: "", periodStart: new Date("2004-01-01T00:00:00Z"), periodEnd: new Date("2004-01-02T00:00:00Z"), revision: 1, finalizedById: ownerId, payload } });
    const exposed = await getReportSnapshot(businessId, null, row.id);
    expect(exposed.payload.periodLedger.creditProjection).toBeUndefined();
    expect(exposed.payload.periodLedger.creditEntries).toEqual([{ id: "existing" }]);
    expect((await db.posReportSnapshot.findUnique({ where: { id: row.id } })).payload).toEqual(payload);
    await expect(db.posReportSnapshot.update({ where: { id: row.id }, data: { reason: "rewrite" } })).rejects.toThrow();
    expect(await getReportSnapshot(otherBusinessId, null, row.id)).toBeNull();
  });
});
