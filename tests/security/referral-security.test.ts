import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  businesses: [] as Array<Record<string, any>>,
  referrals: [] as Array<Record<string, any>>,
  referralCreates: 0,
  events: [] as Array<Record<string, any>>,
  registerCalls: [] as Array<Record<string, any>>,
  registerResult: { ok: true, user: { id: "user-new", email: "new@example.test" }, business: { id: "biz-new", slug: "new-biz" }, referral: { recorded: false, reason: "self_referral" } } as any,
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: async ({ where, select }: any) => {
        const row = where.referralCode
          ? store.businesses.find((b) => b.referralCode === where.referralCode)
          : store.businesses.find((b) => b.id === where.id);
        if (!row) return null;
        return select === undefined ? row : { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = store.businesses.find((b) => b.id === where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        if (data.referralCode && store.businesses.some((b) => b.referralCode === data.referralCode)) {
          throw Object.assign(new Error("unique violation"), { code: "P2002" });
        }
        Object.assign(row, data);
        return { ...row };
      },
    },
    referral: {
      findUnique: async ({ where }: any) => store.referrals.find((r) => r.tokenHash === where.tokenHash) ?? null,
      create: async ({ data }: any) => {
        store.referralCreates += 1;
        const row = { id: `ref-${store.referrals.length + 1}`, ...data };
        store.referrals.push(row);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/analytics", () => ({
  EVENT_TYPES: ["PAGE_VIEW", "WHATSAPP_CLICK", "CALL_CLICK", "DIRECTION_CLICK", "SHARE_CLICK", "SERVICE_CLICK"],
  recordEvent: async (params: any) => {
    store.events.push(params);
    return { id: "event" };
  },
}));

vi.mock("@/lib/registration", () => ({
  isRegisterFailure: (result: any) => result.ok === false,
  registerOwner: async (input: any) => {
    store.registerCalls.push(input);
    return store.registerResult;
  },
}));

import {
  ensureReferralCode,
  generateReferralCode,
  hashReferralToken,
  issueReferralToken,
  resolveReferralForRegistration,
} from "@/lib/referral";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as analyticsPost } from "@/app/api/analytics/event/route";

function seedBusiness(overrides: Record<string, any> = {}) {
  const business = {
    id: `biz-${store.businesses.length + 1}`,
    name: "Mary's Beauty Studio",
    ownerId: "user-a",
    isPublished: true,
    status: "ACTIVE",
    referralCode: generateReferralCode(),
    owner: { id: "user-a", email: "mary@example.test", phone: "0722123456" },
    ...overrides,
  };
  store.businesses.push(business);
  return business;
}

function seedAttribution(overrides: Record<string, any> = {}) {
  const token = issueReferralToken();
  const row = {
    id: `ref-${store.referrals.length + 1}`,
    code: "ABC123",
    referrerUserId: "user-a",
    referrerBusinessId: "biz-1",
    referredUserId: null,
    referredBusinessId: null,
    status: "PENDING",
    tokenHash: hashReferralToken(token),
    rejectReason: null,
    expiresAt: new Date(Date.now() + 7 * 86400000),
    convertedAt: null,
    ...overrides,
  };
  store.referrals.push(row);
  return { row, token };
}

beforeEach(() => {
  store.businesses = [];
  store.referrals = [];
  store.referralCreates = 0;
  store.events = [];
  store.registerCalls = [];
});

describe("referral attribution is server-side only", () => {
  it("resolves a valid attribution token to the referrer recorded on the server", async () => {
    const business = seedBusiness();
    const { row, token } = seedAttribution({ referrerBusinessId: business.id, code: business.referralCode });
    const result = await resolveReferralForRegistration({ token });
    expect(result).toMatchObject({ decision: "convert", attributionId: row.id });
    if (result.decision !== "convert") return;
    expect(result.referrer.ownerId).toBe("user-a");
    expect(result.referrer.businessId).toBe(business.id);
  });

  it("ignores a tampered or forged token", async () => {
    seedBusiness();
    seedAttribution({ referrerBusinessId: "biz-1" });
    for (const token of ["tampered", "", "a".repeat(700), issueReferralToken()]) {
      const result = await resolveReferralForRegistration({ token });
      expect(result.decision).toBe("skip");
    }
  });

  it("ignores a token whose attribution was already converted (repeated attempt)", async () => {
    const business = seedBusiness();
    const { token } = seedAttribution({ referrerBusinessId: business.id, status: "CONVERTED", referredUserId: "user-b" });
    expect(await resolveReferralForRegistration({ token })).toEqual({ decision: "skip", reason: "attribution_invalid" });
  });

  it("ignores an expired attribution", async () => {
    const business = seedBusiness();
    const { token } = seedAttribution({ referrerBusinessId: business.id, expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveReferralForRegistration({ token })).toEqual({ decision: "skip", reason: "attribution_invalid" });
  });

  it("rejects an unpublished referrer even when the attribution is valid", async () => {
    const business = seedBusiness({ isPublished: false });
    const { token } = seedAttribution({ referrerBusinessId: business.id });
    expect(await resolveReferralForRegistration({ token })).toEqual({ decision: "reject", reason: "referrer_unpublished", attributionId: store.referrals[0].id });
  });

  it("rejects a suspended referrer even when the attribution is valid", async () => {
    const business = seedBusiness({ status: "SUSPENDED" });
    const { token } = seedAttribution({ referrerBusinessId: business.id });
    expect(await resolveReferralForRegistration({ token })).toEqual({ decision: "reject", reason: "referrer_suspended", attributionId: store.referrals[0].id });
  });

  it("rejects a referrer that no longer exists", async () => {
    const business = seedBusiness();
    const { token } = seedAttribution({ referrerBusinessId: business.id });
    store.businesses = [];
    expect(await resolveReferralForRegistration({ token })).toEqual({ decision: "reject", reason: "referrer_not_found", attributionId: store.referrals[0].id });
  });

  it("rejects a cross-tenant attribution (stored referrer is not the business owner)", async () => {
    const business = seedBusiness({ ownerId: "user-a" });
    const { token } = seedAttribution({ referrerBusinessId: business.id, referrerUserId: "user-attacker" });
    // The attacker's attribution must not be credited to another tenant's business.
    expect(await resolveReferralForRegistration({ token })).toEqual({ decision: "reject", reason: "referrer_mismatch", attributionId: store.referrals[0].id });
  });

  it("keeps the first touch when a token and a different code are presented together", async () => {
    const a = seedBusiness({ name: "A studio" });
    const b = seedBusiness({ name: "B studio" });
    const { row, token } = seedAttribution({ referrerBusinessId: a.id, code: a.referralCode });
    const result = await resolveReferralForRegistration({ token, code: b.referralCode });
    expect(result).toMatchObject({ decision: "convert", attributionId: row.id });
    if (result.decision !== "convert") return;
    expect(result.referrer.businessId).toBe(a.id);
    expect(store.referralCreates).toBe(0);
  });

  it("falls back to a submitted code only when no attribution exists, and still resolves server-side", async () => {
    const business = seedBusiness();
    const result = await resolveReferralForRegistration({ code: business.referralCode });
    expect(result.decision).toBe("convert");
    if (result.decision !== "convert") return;
    expect(result.referrer.ownerId).toBe("user-a");
    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0].status).toBe("PENDING");
  });

  it("rejects a submitted code for an ineligible referrer", async () => {
    const business = seedBusiness({ isPublished: false });
    const result = await resolveReferralForRegistration({ code: business.referralCode });
    expect(result).toEqual({ decision: "reject", reason: "referrer_unpublished", attributionId: null });
    expect(store.referrals).toHaveLength(0);
  });

  it("skips malformed or unknown codes", async () => {
    seedBusiness();
    expect(await resolveReferralForRegistration({ code: "nope" })).toEqual({ decision: "skip", reason: "no_attribution" });
    expect(await resolveReferralForRegistration({ code: generateReferralCode() })).toEqual({ decision: "reject", reason: "referrer_not_found", attributionId: null });
    expect(await resolveReferralForRegistration({})).toEqual({ decision: "skip", reason: "no_attribution" });
    expect(store.referrals).toHaveLength(0);
  });
});

describe("referral codes are only minted for eligible businesses", () => {
  it("mints and caches a code for an eligible business", async () => {
    const business = seedBusiness();
    const code = await ensureReferralCode(business.id);
    expect(code).toBe(business.referralCode);
    const again = await ensureReferralCode(business.id);
    expect(again).toBe(code);
  });

  it("never mints a code for an unpublished business", async () => {
    const business = seedBusiness({ isPublished: false, referralCode: null });
    expect(await ensureReferralCode(business.id)).toBeNull();
    expect(business.referralCode).toBeNull();
  });

  it("never mints a code for a suspended business", async () => {
    const business = seedBusiness({ status: "SUSPENDED", referralCode: null });
    expect(await ensureReferralCode(business.id)).toBeNull();
    expect(business.referralCode).toBeNull();
  });

  it("does not mint a code for a business that does not exist", async () => {
    expect(await ensureReferralCode("missing-biz")).toBeNull();
  });
});

describe("client-submitted analytics events cannot create a referral", () => {
  it("records only the whitelisted event and writes no referral row", async () => {
    const business = seedBusiness();
    const response = await analyticsPost(
      new Request("https://jata.test/api/analytics/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          eventType: "PAGE_VIEW",
          source: "https://jata.test/",
          referralCode: "FORGED123456",
          referrerUserId: "user-attacker",
          referral: { status: "CONVERTED" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(store.events).toHaveLength(1);
    expect(Object.keys(store.events[0]).sort()).toEqual(["businessId", "eventType", "ip", "source", "userAgent"]);
    expect(JSON.stringify(store.events[0])).not.toContain("FORGED123456");
    expect(store.referralCreates).toBe(0);
    expect(store.referrals).toHaveLength(0);
  });
});

describe("POST /api/auth/register — referral hints are untrusted input", () => {
  it("forwards the server-set cookie token and the submitted code, and never returns a reject reason", async () => {
    const token = issueReferralToken();
    const response = await registerPost(
      new Request("https://jata.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `jata_referral=${token}` },
        body: JSON.stringify({ name: "New Owner", email: "new@example.test", phone: "0733111222", password: "correct-horse", businessName: "New Biz", ref: "ABC123456789" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, user: { id: "user-new", email: "new@example.test" }, referral: { recorded: false } });

    expect(store.registerCalls).toHaveLength(1);
    expect(store.registerCalls[0].referral).toEqual({ code: "ABC123456789", token });
    // Internal reasons must never reach the browser.
    expect(JSON.stringify(body)).not.toContain("self_referral");
    expect(JSON.stringify(body)).not.toContain("token");
  });
});
