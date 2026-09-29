import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end wiring test for Stage 2 using the REAL route handlers, the REAL registration
 * service, the REAL referral storage functions and the REAL tenant guard — only Prisma and the
 * session helper are stubbed. This covers the wiring that unit tests cannot:
 *   GET /r/<code>  →  POST /api/auth/register  →  PATCH /api/business (payment boundary)
 */

const db = vi.hoisted(() => ({
  users: [] as Array<Record<string, any>>,
  businesses: [] as Array<Record<string, any>>,
  members: [] as Array<Record<string, any>>,
  referrals: [] as Array<Record<string, any>>,
  payments: [] as Array<Record<string, any>>,
  subscriptions: [] as Array<Record<string, any>>,
  audits: [] as Array<Record<string, any>>,
  session: null as null | { userId: string; email: string; role: string },
  failBusinessCreate: false,
}));

vi.mock("@/lib/db", () => {
  // Built inside the factory: vi.mock is hoisted above top-level consts, so the mock cannot
  // reference anything declared outside it except other vi.hoisted values.
  const findBusiness = (where: Record<string, any>) => {
    if (!where) return undefined;
    if (where.id) return db.businesses.find((b: any) => b.id === where.id);
    if (where.slug) return db.businesses.find((b: any) => b.slug === where.slug);
    if (where.referralCode) return db.businesses.find((b: any) => b.referralCode === where.referralCode);
    return undefined;
  };

  const client: any = {
    user: {
      findUnique: async ({ where }: any) =>
        (where.id ? db.users.find((u: any) => u.id === where.id) : db.users.find((u: any) => u.email === where.email)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `user-${db.users.length + 1}`, ...data };
        db.users.push(row);
        return row;
      },
    },
    business: {
      findUnique: async ({ where }: any) => {
        const row = findBusiness(where);
        if (!row) return null;
        return { ...row, owner: db.users.find((u: any) => u.id === row.ownerId) ?? null };
      },
      findMany: async ({ where }: any = {}) =>
        db.businesses.filter((b: any) => (where?.ownerId ? b.ownerId === where.ownerId : true)).map((b: any) => ({ ...b })),
      create: async ({ data }: any) => {
        if (db.failBusinessCreate) throw new Error("insert into Business failed: connection reset ECONNREFUSED");
        const { members, ...fields } = data;
        const id = fields.id ?? `biz-${db.businesses.length + 1}`;
        if (db.businesses.some((b: any) => b.id === id || b.slug === fields.slug)) {
          throw Object.assign(new Error("unique constraint failed"), { code: "P2002" });
        }
        const row = { ...fields, id };
        db.businesses.push(row);
        if (members?.create) {
          db.members.push({ id: `mem-${db.members.length + 1}`, businessId: id, userId: members.create.userId, role: members.create.role });
        }
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = findBusiness(where);
        if (!row) throw Object.assign(new Error("record not found"), { code: "P2025" });
        Object.assign(row, data);
        return { ...row };
      },
    },
    businessMember: {
      create: async ({ data }: any) => {
        const row = { id: `mem-${db.members.length + 1}`, ...data };
        db.members.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        db.members.filter((m: any) => (where?.userId ? m.userId === where.userId : true)).map((m: any) => ({ ...m })),
      findUnique: async ({ where }: any) =>
        db.members.find((m: any) => (where?.userId_businessId ? m.userId === where.userId_businessId.userId && m.businessId === where.userId_businessId.businessId : false)) ?? null,
      upsert: async ({ create }: any) => {
        const row = { id: `mem-${db.members.length + 1}`, ...create };
        db.members.push(row);
        return row;
      },
    },
    referral: {
      findUnique: async ({ where }: any) => db.referrals.find((r: any) => r.tokenHash === where.tokenHash) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `ref-${db.referrals.length + 1}`, ...data };
        db.referrals.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of db.referrals) {
          if (row.id !== where.id) continue;
          if (where.status && row.status !== where.status) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
      findMany: async () => db.referrals.map((r: any) => ({ ...r })),
    },
    payment: {
      findFirst: async ({ where }: any) => db.payments.find((p: any) => p.businessId === where.businessId && p.status === where.status) ?? null,
    },
    subscription: {
      findUnique: async ({ where }: any) => db.subscriptions.find((s: any) => s.businessId === where.businessId) ?? null,
    },
    auditEvent: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${db.audits.length + 1}`, ...data };
        db.audits.push(row);
        return row;
      },
    },
  };

  // Rolls the in-memory store back on failure, like a real transaction.
  client.$transaction = async (fn: any) => {
    const snapshot = {
      users: db.users.map((r: any) => ({ ...r })),
      businesses: db.businesses.map((r: any) => ({ ...r })),
      members: db.members.map((r: any) => ({ ...r })),
      referrals: db.referrals.map((r: any) => ({ ...r })),
    };
    try {
      return await fn(client);
    } catch (error) {
      db.users.splice(0, db.users.length, ...snapshot.users);
      db.businesses.splice(0, db.businesses.length, ...snapshot.businesses);
      db.members.splice(0, db.members.length, ...snapshot.members);
      db.referrals.splice(0, db.referrals.length, ...snapshot.referrals);
      throw error;
    }
  };

  return { default: client };
});

vi.mock("@/lib/auth", () => ({
  getSession: async () => db.session,
  setSessionCookie: async (payload: any) => {
    db.session = payload;
  },
  hashPassword: async (password: string) => `hashed:${password}`,
  verifyPassword: async (password: string, hash: string) => hash === `hashed:${password}`,
}));

import { GET as referralGet } from "@/app/r/[code]/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { PATCH as businessPatch } from "@/app/api/business/route";
import { REFERRAL_COOKIE_NAME, hashReferralToken } from "@/lib/referral";

const REFERRER = { name: "Mary Wanjiku", email: "mary@example.test", phone: "0722123456" };
const RECIPIENT = { name: "Jane Kamau", email: "jane@example.test", phone: "0733111222", password: "correct-horse", businessName: "Jane Salon" };

function seedReferrer(overrides: Record<string, any> = {}) {
  const owner = { id: "user-a", name: REFERRER.name, email: REFERRER.email, phone: REFERRER.phone, passwordHash: "hashed:x", role: "CUSTOMER" };
  db.users.push(owner);
  const business = {
    id: "biz-a",
    ownerId: "user-a",
    slug: "marys-beauty-studio",
    name: "Mary's Beauty Studio",
    category: "Salon",
    isPublished: true,
    status: "ACTIVE",
    referralCode: "M4RYC0DE7QPZ",
    ...overrides,
  };
  db.businesses.push(business);
  db.members.push({ id: "mem-1", userId: "user-a", businessId: "biz-a", role: "OWNER" });
  return business;
}

function openLink(code: string, cookie?: string) {
  return referralGet(new Request(`https://jata.test/r/${code}`, cookie ? { headers: { cookie } } : undefined), {
    params: Promise.resolve({ code }),
  });
}

function tokenFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(new RegExp(`${REFERRAL_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function register(body: Record<string, unknown>, cookie?: string) {
  return registerPost(
    new Request("https://jata.test/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

function publish(businessId: string, isPublished: boolean) {
  return businessPatch(
    new Request("https://jata.test/api/business", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId, isPublished }),
    }),
  );
}

beforeEach(() => {
  db.users = [];
  db.businesses = [];
  db.members = [];
  db.referrals = [];
  db.payments = [];
  db.subscriptions = [];
  db.audits = [];
  db.session = null;
  db.failBusinessCreate = false;
});

describe("referral lifecycle — real handlers, real referral storage", () => {
  it("runs link → registration → first business with an atomic referral record", async () => {
    const referrerBusiness = seedReferrer();

    // 1. Recipient opens the shared link while unauthenticated.
    const opened = await openLink(referrerBusiness.referralCode);
    expect(opened.status).toBe(303);
    const token = tokenFrom(opened) as string;
    expect(token).toBeTruthy();

    // 2. Recipient registers independently (no admin, no manual step).
    const registered = await register(RECIPIENT, `${REFERRAL_COOKIE_NAME}=${token}`);
    expect(registered.status).toBe(200);
    const body = await registered.json();
    expect(body.ok).toBe(true);
    expect(body.referral).toEqual({ recorded: true });

    // 3. The referral is attributed to the new user and their FIRST business, atomically.
    const referredBusiness = db.businesses.find((b) => b.ownerId === "user-2");
    expect(referredBusiness).toBeTruthy();
    expect(db.referrals).toEqual([
      expect.objectContaining({
        id: "ref-1",
        code: referrerBusiness.referralCode,
        referrerUserId: "user-a",
        referrerBusinessId: "biz-a",
        referredUserId: "user-2",
        referredBusinessId: referredBusiness?.id,
        status: "CONVERTED",
      }),
    ]);
    expect(db.referrals[0].convertedAt).toBeInstanceOf(Date);
    expect(db.referrals[0].tokenHash).toBe(hashReferralToken(token));
    expect(db.audits.map((a) => a.action)).toContain("REFERRAL_RECORDED");
    // Recipient owns their own page; nothing is shared with the referrer's tenant.
    expect(db.members).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: "user-2", businessId: referredBusiness?.id, role: "OWNER" })]),
    );
  });

  it("keeps the referred business unpublished until a verified payment exists", async () => {
    const referrerBusiness = seedReferrer();
    const opened = await openLink(referrerBusiness.referralCode);
    const token = tokenFrom(opened) as string;

    const registered = await register(RECIPIENT, `${REFERRAL_COOKIE_NAME}=${token}`);
    expect((await registered.json()).referral).toEqual({ recorded: true });
    const referredBusiness = db.businesses.find((b) => b.ownerId === "user-2")!;

    // Cross-flow: referral origin does not unlock publishing.
    const unpaid = await publish(referredBusiness.id, true);
    expect(unpaid.status).toBe(403);
    expect(db.businesses.find((b) => b.id === referredBusiness.id)!.isPublished).toBe(false);

    // Once a verified payment backs a valid subscription, publishing works exactly as before.
    db.payments.push({ id: "pay-1", businessId: referredBusiness.id, status: "PAID", amount: 14900 });
    db.subscriptions.push({
      id: "sub-1",
      businessId: referredBusiness.id,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 30 * 86400000),
      graceUntil: new Date(Date.now() + 33 * 86400000),
    });
    const paid = await publish(referredBusiness.id, true);
    expect(paid.status).toBe(200);
    expect(db.businesses.find((b) => b.id === referredBusiness.id)!.isPublished).toBe(true);
  });

  it("ignores a tampered attribution cookie", async () => {
    const referrerBusiness = seedReferrer();
    await openLink(referrerBusiness.referralCode);

    const registered = await register(RECIPIENT, `${REFERRAL_COOKIE_NAME}=tampered-token`);
    expect(registered.status).toBe(200);
    const body = await registered.json();
    expect(body.referral).toEqual({ recorded: false });
    expect(db.referrals).toHaveLength(1);
    expect(db.referrals[0].status).toBe("PENDING");
    expect(db.referrals[0].referredUserId).toBeUndefined();
  });

  it("records no referral for an ordinary registration", async () => {
    seedReferrer();
    const registered = await register(RECIPIENT);
    expect(registered.status).toBe(200);
    expect((await registered.json()).referral).toBeUndefined();
    expect(db.referrals).toHaveLength(0);
    expect(db.businesses.find((b) => b.ownerId === "user-2")).toBeTruthy();
  });

  it("refuses to credit a self-referral and still creates the account", async () => {
    const referrerBusiness = seedReferrer();
    const opened = await openLink(referrerBusiness.referralCode);
    const token = tokenFrom(opened) as string;

    // Same person, second account: a different email but the referrer's own phone number.
    const registered = await register({ ...RECIPIENT, email: "mary.alt@example.test", phone: REFERRER.phone }, `${REFERRAL_COOKIE_NAME}=${token}`);
    expect(registered.status).toBe(200);
    expect((await registered.json()).referral).toEqual({ recorded: false });
    expect(db.referrals[0]).toMatchObject({ status: "REJECTED", rejectReason: "self_referral" });
    expect(db.referrals[0].referredUserId).toBeUndefined();
    expect(db.users).toHaveLength(2);
  });

  it("creates no attribution for an unpublished referrer, and registers without one", async () => {
    const referrerBusiness = seedReferrer({ isPublished: false });
    const opened = await openLink(referrerBusiness.referralCode);
    expect(opened.headers.get("set-cookie")).toBeNull();

    const registered = await register(RECIPIENT);
    expect(registered.status).toBe(200);
    expect(db.referrals).toHaveLength(0);
  });

  it("leaves nothing behind when the business creation fails mid-transaction", async () => {
    const referrerBusiness = seedReferrer();
    const opened = await openLink(referrerBusiness.referralCode);
    const token = tokenFrom(opened) as string;

    db.failBusinessCreate = true;
    const registered = await register(RECIPIENT, `${REFERRAL_COOKIE_NAME}=${token}`);
    expect(registered.status).toBe(500);

    // Atomic rollback: no user, no business, and the attribution is still unconverted.
    expect(db.users).toHaveLength(1);
    expect(db.businesses).toHaveLength(1);
    expect(db.referrals[0].status).toBe("PENDING");
    expect(db.referrals[0].referredUserId).toBeUndefined();
    expect(db.session).toBeNull();
  });
});
