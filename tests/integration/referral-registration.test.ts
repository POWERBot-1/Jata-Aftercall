import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {} }),
}));

vi.mock("@/lib/db", () => ({
  default: { $transaction: vi.fn() },
}));

import { registerOwner, type RegisterDeps } from "@/lib/registration";
import type { ReferralResolution, ReferrerSnapshot } from "@/lib/referral";

type Row = Record<string, any>;

const referrerA: ReferrerSnapshot = {
  businessId: "biz-a",
  businessName: "A Studio",
  ownerId: "user-a",
  ownerEmail: "a@example.test",
  ownerPhone: "0722000001",
  isPublished: true,
  status: "ACTIVE",
};

function memoryDb() {
  const users: Row[] = [];
  const businesses: Row[] = [];
  const members: Row[] = [];
  const referrals: Row[] = [];

  const tx = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) || null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `user-${users.length + 1}`, ...data };
        users.push(row);
        return row;
      },
    },
    business: {
      findUnique: async ({ where }: { where: { slug: string } }) => businesses.find((b) => b.slug === where.slug) || null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `biz-${businesses.length + 1}`, ...data };
        businesses.push(row);
        return row;
      },
    },
    businessMember: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `mem-${members.length + 1}`, ...data };
        members.push(row);
        return row;
      },
    },
    referral: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of referrals) {
          if (row.id !== where.id) continue;
          if (where.status && row.status !== where.status) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
  };

  const snapshot = () => ({
    users: users.map((r) => ({ ...r })),
    businesses: businesses.map((r) => ({ ...r })),
    members: members.map((r) => ({ ...r })),
    referrals: referrals.map((r) => ({ ...r })),
  });

  return {
    users,
    businesses,
    members,
    referrals,
    tx,
    transaction: async <T,>(fn: (client: typeof tx) => Promise<T>): Promise<T> => {
      const before = snapshot();
      try {
        return await fn(tx);
      } catch (error) {
        users.splice(0, users.length, ...before.users);
        businesses.splice(0, businesses.length, ...before.businesses);
        members.splice(0, members.length, ...before.members);
        referrals.splice(0, referrals.length, ...before.referrals);
        throw error;
      }
    },
  };
}

type Harness = {
  db: ReturnType<typeof memoryDb>;
  audits: Row[];
  sessions: Row[];
  claims: Row[];
  rejects: Row[];
  resolution: ReferralResolution | null;
  deps: () => Partial<RegisterDeps>;
};

function harness(attributionId = "ref-1", initialStatus = "PENDING", rowOverrides: Record<string, any> = {}): Harness {
  const db = memoryDb();
  const audits: Row[] = [];
  const sessions: Row[] = [];
  const claims: Row[] = [];
  const rejects: Row[] = [];
  db.referrals.push({ id: attributionId, code: "ABC123", referrerUserId: "user-a", referrerBusinessId: "biz-a", status: initialStatus, referredUserId: null, referredBusinessId: null, ...rowOverrides });

  const state = {
    db,
    audits,
    sessions,
    claims,
    rejects,
    resolution: null as ReferralResolution | null,
    deps: () =>
      ({
        hashPassword: async (password: string) => `hashed:${password}`,
        transaction: db.transaction,
        logAudit: async (params: Row) => {
          audits.push(params);
        },
        issueSession: async (payload: Row) => {
          sessions.push(payload);
        },
        adminEmails: [],
        referral: {
          resolve: async () => state.resolution,
          claim: async (tx: any, params: Row) => {
            claims.push(params);
            const result = await tx.referral.updateMany({
              where: { id: params.attributionId, status: "PENDING" },
              data: { status: "CONVERTED", referredUserId: params.referredUserId, referredBusinessId: params.referredBusinessId, convertedAt: new Date() },
            });
            return result.count === 1 ? { recorded: true } : { recorded: false, reason: "attribution_claimed" };
          },
          reject: async (tx: any, params: Row) => {
            rejects.push(params);
            await tx.referral.updateMany({ where: { id: params.attributionId, status: "PENDING" }, data: { status: "REJECTED", rejectReason: params.reason } });
          },
        },
      }) as unknown as Partial<RegisterDeps>,
  };
  return state;
}

const valid = { name: "Jane Wanjiru", email: "jane@example.test", phone: "0733111222", password: "correct-horse", businessName: "Jane Salon" };

describe("registration with referral attribution", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("records the referral in the same transaction as the recipient's first business", async () => {
    h.resolution = { decision: "convert", attributionId: "ref-1", referrer: referrerA };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, h.deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral).toEqual({ recorded: true });

    // The claim ran inside the transaction, against the business created in that same transaction.
    expect(h.claims).toHaveLength(1);
    expect(h.claims[0]).toMatchObject({ attributionId: "ref-1", referredUserId: h.db.users[0].id, referredBusinessId: h.db.businesses[0].id });

    expect(h.db.referrals[0]).toMatchObject({
      id: "ref-1",
      status: "CONVERTED",
      referredUserId: h.db.users[0].id,
      referredBusinessId: h.db.businesses[0].id,
    });
    expect(h.db.referrals[0].convertedAt).toBeInstanceOf(Date);
    expect(h.audits.map((a) => a.action)).toContain("REFERRAL_RECORDED");
  });

  it("leaves an ordinary, non-referred registration untouched", async () => {
    const result = await registerOwner(valid, h.deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral).toBeUndefined();
    expect(h.claims).toHaveLength(0);
    expect(h.rejects).toHaveLength(0);
    expect(h.db.referrals[0].status).toBe("PENDING");
    expect(h.db.users).toHaveLength(1);
    expect(h.db.businesses).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).not.toContain("REFERRAL_RECORDED");
  });

  it("ignores an empty referral hint (no code and no token)", async () => {
    const result = await registerOwner({ ...valid, referral: { code: null, token: null } }, h.deps());
    expect(result.ok).toBe(true);
    expect(h.claims).toHaveLength(0);
  });

  it("does not record a self-referral and still creates the account", async () => {
    h.resolution = { decision: "convert", attributionId: "ref-1", referrer: { ...referrerA, ownerEmail: "jane@example.test" } };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, h.deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral?.recorded).toBe(false);
    expect(h.claims).toHaveLength(0);
    expect(h.rejects).toEqual([{ attributionId: "ref-1", reason: "self_referral" }]);
    expect(h.db.referrals[0].status).toBe("REJECTED");
    expect(h.db.referrals[0].rejectReason).toBe("self_referral");
    expect(h.db.referrals[0].referredUserId).toBeNull();
    expect(h.db.users).toHaveLength(1);
    expect(h.db.businesses).toHaveLength(1);
  });

  it("detects a self-referral by phone when the email differs", async () => {
    h.resolution = { decision: "convert", attributionId: "ref-1", referrer: { ...referrerA, ownerPhone: "0733111222" } };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123" } }, h.deps());
    expect(result.ok).toBe(true);
    expect(h.claims).toHaveLength(0);
    expect(h.db.referrals[0].status).toBe("REJECTED");
  });

  it("records why an ineligible referrer was not credited, without blocking registration", async () => {
    h.resolution = { decision: "reject", reason: "referrer_unpublished", attributionId: "ref-1" };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, h.deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral?.recorded).toBe(false);
    expect(result.referral?.reason).toBe("referrer_unpublished");
    expect(h.claims).toHaveLength(0);
    expect(h.rejects).toEqual([{ attributionId: "ref-1", reason: "referrer_unpublished" }]);
    expect(h.db.referrals[0]).toMatchObject({ status: "REJECTED", rejectReason: "referrer_unpublished" });
    expect(h.db.users).toHaveLength(1);
    expect(h.db.businesses).toHaveLength(1);
  });

  it("reports a skipped attribution without failing the signup", async () => {
    h.resolution = { decision: "skip", reason: "no_attribution" };
    const result = await registerOwner({ ...valid, referral: { token: "tok" } }, h.deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral?.recorded).toBe(false);
    expect(h.claims).toHaveLength(0);
    expect(h.db.referrals[0].status).toBe("PENDING");
  });

  it("survives an unexpected referral failure without blocking registration", async () => {
    const deps = h.deps() as RegisterDeps;
    deps.referral = { ...deps.referral!, resolve: async () => { throw new Error("referral store unavailable"); } };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral).toBeUndefined();
    expect(h.db.users).toHaveLength(1);
    expect(h.db.businesses).toHaveLength(1);
  });

  it("rolls the whole thing back when the first business cannot be created", async () => {
    h.resolution = { decision: "convert", attributionId: "ref-1", referrer: referrerA };
    (h.db.tx.business as any).create = async () => {
      throw new Error("insert into Business failed: connection reset");
    };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, h.deps());

    expect(result.ok).toBe(false);
    expect(h.claims).toHaveLength(0);
    // Atomic: no user, no business, and no converted referral left behind.
    expect(h.db.users).toHaveLength(0);
    expect(h.db.businesses).toHaveLength(0);
    expect(h.db.referrals[0].status).toBe("PENDING");
    expect(h.sessions).toHaveLength(0);
  });

  it("does not double-credit when another claim already converted the attribution", async () => {
    const h2 = harness("ref-9", "CONVERTED");
    h2.resolution = { decision: "convert", attributionId: "ref-9", referrer: referrerA };
    const result = await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, h2.deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referral?.recorded).toBe(false);
    expect(result.referral?.reason).toBe("attribution_claimed");
    expect(h2.db.referrals[0].status).toBe("CONVERTED");
    expect(h2.db.users).toHaveLength(1);
  });

  it("creates the referred business unpublished so the payment gate still applies", async () => {
    h.resolution = { decision: "convert", attributionId: "ref-1", referrer: referrerA };
    await registerOwner({ ...valid, referral: { code: "ABC123", token: "tok" } }, h.deps());
    expect(h.db.businesses[0].isPublished).toBe(false);
    expect(h.db.businesses[0].status).toBe("PENDING");
    expect(h.db.businesses[0].ownerId).toBe(h.db.users[0].id);
  });
});

describe("A → B → C referral chains", () => {
  it("credits only the direct referrer at each hop", async () => {
    // Hop 1: B is referred by A.
    const hop1 = harness("ref-ab");
    hop1.resolution = { decision: "convert", attributionId: "ref-ab", referrer: referrerA };
    const b = await registerOwner({ name: "B Owner", email: "b@example.test", phone: "0733000002", password: "correct-horse", businessName: "B Studio", referral: { code: "ABC123", token: "tok-b" } }, hop1.deps());
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.referral).toEqual({ recorded: true });
    const bUserId = hop1.db.users[0].id;
    const bBusinessId = hop1.db.businesses[0].id;

    // Hop 2: C is referred by B (B now owns a business of its own).
    const referrerB: ReferrerSnapshot = { businessId: bBusinessId, businessName: "B Studio", ownerId: bUserId, ownerEmail: "b@example.test", ownerPhone: "0733000002", isPublished: true, status: "ACTIVE" };
    const hop2 = harness("ref-bc", "PENDING", { referrerUserId: bUserId, referrerBusinessId: bBusinessId, code: "DEF456" });
    hop2.resolution = { decision: "convert", attributionId: "ref-bc", referrer: referrerB };
    const c = await registerOwner({ name: "C Owner", email: "c@example.test", phone: "0733000003", password: "correct-horse", businessName: "C Studio", referral: { code: "DEF456", token: "tok-c" } }, hop2.deps());
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    // Direct attribution only: C's referral names B, never the ancestor A.
    expect(hop2.db.referrals[0]).toMatchObject({
      id: "ref-bc",
      status: "CONVERTED",
      referrerUserId: bUserId,
      referrerBusinessId: bBusinessId,
      referredUserId: hop2.db.users[0].id,
    });
    expect(hop2.db.referrals[0].referrerUserId).not.toBe("user-a");
    // No ancestor credit is written into the first hop either.
    expect(hop1.db.referrals[0]).toMatchObject({ id: "ref-ab", referrerUserId: "user-a", referredUserId: bUserId });
    expect(hop1.db.referrals).toHaveLength(1);
    expect(hop2.db.referrals).toHaveLength(1);
  });
});
