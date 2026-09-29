import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the parts of Prisma the referral entry point uses. The unique
// constraints that matter (referralCode, tokenHash) are enforced so duplicates cannot slip in.

const store = vi.hoisted(() => ({
  businesses: [] as Array<Record<string, any>>,
  referrals: [] as Array<Record<string, any>>,
  session: null as { userId: string; role: string } | null,
  failCreate: false,
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: async ({ where, select }: any) => {
        const row = where.referralCode
          ? store.businesses.find((b) => b.referralCode === where.referralCode)
          : store.businesses.find((b) => b.id === where.id);
        if (!row) return null;
        return select?.owner ? { ...row } : (({ owner, ...rest }) => rest)(row);
      },
      update: async ({ where, data }: any) => {
        const row = store.businesses.find((b) => b.id === where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(row, data);
        return { referralCode: row.referralCode };
      },
    },
    referral: {
      findUnique: async ({ where }: any) => store.referrals.find((r) => r.tokenHash === where.tokenHash) ?? null,
      create: async ({ data }: any) => {
        if (store.failCreate) throw new Error("db unavailable");
        const row = { id: `ref-${store.referrals.length + 1}`, ...data };
        store.referrals.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of store.referrals) {
          if (row.id !== where.id) continue;
          if (where.status && row.status !== where.status) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
  },
}));

vi.mock("@/lib/auth", () => ({ getSession: async () => store.session }));

import { GET } from "@/app/r/[code]/route";
import { generateReferralCode, hashReferralToken, REFERRAL_COOKIE_NAME } from "@/lib/referral";

function request(path: string, cookie?: string) {
  return new Request(`https://jata.test${path}`, cookie ? { headers: { cookie } } : undefined);
}

function seedBusiness(overrides: Record<string, any> = {}) {
  const code = overrides.referralCode ?? generateReferralCode();
  const business = {
    id: `biz-${store.businesses.length + 1}`,
    name: "Mary's Beauty Studio",
    ownerId: "user-a",
    isPublished: true,
    status: "ACTIVE",
    owner: { id: "user-a", email: "mary@example.test", phone: "0722123456" },
    referralCode: code,
    ...overrides,
  };
  store.businesses.push(business);
  return business;
}

function cookieToken(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`${REFERRAL_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

beforeEach(() => {
  store.businesses = [];
  store.referrals = [];
  store.session = null;
  store.failCreate = false;
});

describe("GET /r/[code] — self-service referral entry", () => {
  it("is reachable unauthenticated and persists attribution server-side", async () => {
    const business = seedBusiness();
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://jata.test/register?ref=${business.referralCode}`);
    const token = cookieToken(response);
    expect(token).toBeTruthy();

    expect(store.referrals).toHaveLength(1);
    const row = store.referrals[0];
    expect(row.status).toBe("PENDING");
    expect(row.code).toBe(business.referralCode);
    expect(row.referrerUserId).toBe("user-a");
    expect(row.referrerBusinessId).toBe(business.id);
    expect(row.referredUserId ?? null).toBeNull();
    expect(row.referredBusinessId ?? null).toBeNull();
    // Only the hash of the token is stored — the raw value cannot be replayed from the database.
    expect(row.tokenHash).toBe(hashReferralToken(token as string));
    expect(JSON.stringify(row)).not.toContain(token as string);
    // ~30 day attribution window
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
  });

  it("sets an httpOnly, lax, host-path cookie", async () => {
    const business = seedBusiness();
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    const header = response.headers.get("set-cookie") || "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Path=/");
  });

  it("does not reveal the referrer's private data in the redirect", async () => {
    const business = seedBusiness();
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    const location = response.headers.get("location") || "";
    expect(location).not.toContain("user-a");
    expect(location).not.toContain("mary@example.test");
    expect(location).not.toContain("0722123456");
    expect(location).not.toContain(business.id);
  });

  it("rejects an invalid or tampered code without attributing anything", async () => {
    seedBusiness();
    for (const code of ["abc", "NOT-A-CODE!", "", "1234567890123", generateReferralCode().toLowerCase() + "!"]) {
      const response = await GET(request(`/r/${encodeURIComponent(code)}`), { params: Promise.resolve({ code }) });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://jata.test/register");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(store.referrals).toHaveLength(0);
  });

  it("rejects a well-formed code that matches no business (nonexistent referrer)", async () => {
    const response = await GET(request(`/r/${generateReferralCode()}`), { params: Promise.resolve({ code: generateReferralCode() }) });
    expect(response.headers.get("location")).toBe("https://jata.test/register");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(0);
  });

  it("rejects an unpublished referrer", async () => {
    const business = seedBusiness({ isPublished: false });
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    expect(response.headers.get("location")).toBe("https://jata.test/register");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(0);
  });

  it("rejects a suspended referrer", async () => {
    const business = seedBusiness({ status: "SUSPENDED" });
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    expect(response.headers.get("location")).toBe("https://jata.test/register");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(0);
  });

  it("rejects a referrer business with no owner row", async () => {
    const business = seedBusiness({ ownerId: "", owner: null });
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(0);
  });

  it("does not attribute a visitor who is already signed in (self-referral / existing customer)", async () => {
    const business = seedBusiness();
    store.session = { userId: "user-a", role: "CUSTOMER" };
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    expect(response.headers.get("location")).toBe("https://jata.test/dashboard");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(0);
  });

  it("does not attribute a signed-in visitor who is a different tenant", async () => {
    const business = seedBusiness();
    store.session = { userId: "user-z", role: "CUSTOMER" };
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    expect(response.headers.get("location")).toBe("https://jata.test/dashboard");
    expect(store.referrals).toHaveLength(0);
  });

  it("ignores repeated opens of the same link (one attribution per browser)", async () => {
    const business = seedBusiness();
    const first = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    const token = cookieToken(first) as string;
    const second = await GET(request(`/r/${business.referralCode}`, `${REFERRAL_COOKIE_NAME}=${token}`), {
      params: Promise.resolve({ code: business.referralCode }),
    });
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(1);
  });

  it("keeps the first touch when a second, different referral link is opened later", async () => {
    const a = seedBusiness({ name: "A studio" });
    const b = seedBusiness({ name: "B studio" });

    const first = await GET(request(`/r/${a.referralCode}`), { params: Promise.resolve({ code: a.referralCode }) });
    const token = cookieToken(first) as string;
    const second = await GET(request(`/r/${b.referralCode}`, `${REFERRAL_COOKIE_NAME}=${token}`), {
      params: Promise.resolve({ code: b.referralCode }),
    });

    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0].referrerUserId).toBe("user-a");
    expect(store.referrals[0].referrerBusinessId).toBe(a.id);
    expect(store.referrals[0].code).toBe(a.referralCode);
    // The first-touch cookie is untouched, and the redirect carries no second referrer.
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(second.headers.get("location")).toBe("https://jata.test/register");
  });

  it("attributes a fresh browser that opens the second link (no cookie yet)", async () => {
    const b = seedBusiness({ name: "B studio" });
    const response = await GET(request(`/r/${b.referralCode}`), { params: Promise.resolve({ code: b.referralCode }) });
    expect(response.headers.get("location")).toBe(`https://jata.test/register?ref=${b.referralCode}`);
    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0].referrerBusinessId).toBe(b.id);
  });

  it("degrades to a plain redirect when attribution cannot be persisted", async () => {
    const business = seedBusiness();
    store.failCreate = true;
    const response = await GET(request(`/r/${business.referralCode}`), { params: Promise.resolve({ code: business.referralCode }) });
    expect(response.status).toBe(303);
    // Nothing was recorded, so no referral hint is carried forward.
    expect(response.headers.get("location")).toBe("https://jata.test/register");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.referrals).toHaveLength(0);
  });

  it("never returns a 500 for a garbage code", async () => {
    const response = await GET(request("/r/%20%20"), { params: Promise.resolve({ code: "   " }) });
    expect(response.status).toBe(303);
  });
});
