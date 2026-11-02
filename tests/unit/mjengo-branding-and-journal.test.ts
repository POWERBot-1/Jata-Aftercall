/**
 * MJENGO OS boundary tests: branding validation, CSRF/origin, tenant isolation, authentication.
 *
 * These call the real route handlers (`app/api/mjengo/*`) with the real `lib/mjengo/*` modules and
 * a stubbed `lib/db`/`lib/auth`, because the two things that actually fail in production are
 * (a) a route that forgets to check who is asking and (b) a route that trusts a client-supplied
 * tenant id. Both are exercised here. PostgreSQL-level enforcement is a separate, blocked suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as any,
  business: { id: "bizA", name: "A Hardware", slug: "a-hardware" } as any,
  updates: [] as any[],
  journals: [] as any[],
  lines: [] as any[],
  created: [] as any[],
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertBusinessOwnership: vi.fn(async (businessId: string, session: any) => {
      // The real function consults the database; the rule under test is that the route passes the
      // session's own business scope and refuses anything else.
      if (!session) throw new actual.TenantError("Sign in to continue.", 401);
      if (businessId !== "bizA" || session.userId !== "userA") {
        throw new actual.TenantError("You do not have access to this business.", 403);
      }
    }),
  };
});

vi.mock("@/lib/db", () => {
  const db: any = {
    business: {
      findUnique: async ({ where }: any) => (where.id === "bizA" ? { ...state.business } : null),
      update: async ({ where, data }: any) => {
        state.updates.push({ where, data });
        state.business = { ...state.business, ...data };
        return { ...state.business, id: where.id };
      },
    },
    erpJournal: { findMany: async () => state.journals },
    erpJournalLine: { findMany: async () => state.lines },
    $queryRawUnsafe: async () => [],
  };
  return { default: db, prisma: db };
});

// The journal route delegates to the real accounting module; it needs a working post inside our
// double, so only `postJournal` is replaced — the route's validation still runs for real.
vi.mock("@/lib/erp/accounting", () => ({
  postJournal: vi.fn(async (_client: any, input: any) => {
    state.created.push(input);
    return { id: "j1", journalNumber: "JV-000001", status: "POSTED", ...input };
  }),
}));

import { GET as brandingGet, POST as brandingPost } from "@/app/api/mjengo/branding/route";
import { GET as journalGet, POST as journalPost } from "@/app/api/mjengo/journal/route";

const origin = "https://jata.test";

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "jata.test", origin, ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
  state.business = { id: "bizA", name: "A Hardware", slug: "a-hardware" };
  state.updates = [];
  state.journals = [];
  state.lines = [];
  state.created = [];
  process.env.DATABASE_URL = "postgresql://stub/stub";
  (globalThis as any).__rateLimitBucketsClear?.();
});

describe("mjengo: branding route — authentication and tenancy", () => {
  it("refuses an unauthenticated read", async () => {
    state.session = null;
    const response = await brandingGet(new Request(`${origin}/api/mjengo/branding?businessId=bizA`));
    expect(response.status).toBe(401);
  });

  it("refuses a business the session does not own", async () => {
    const response = await brandingGet(new Request(`${origin}/api/mjengo/branding?businessId=bizB`));
    expect(response.status).toBe(403);
  });

  it("returns the tenant's own business name", async () => {
    const response = await brandingGet(new Request(`${origin}/api/mjengo/branding?businessId=bizA`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ businessId: "bizA", business_name: "A Hardware" });
  });
});

describe("mjengo: branding route — validation", () => {
  const cases: Array<[string, string, string]> = [
    ["<img src=x onerror=alert(1)>", "tag", "HTML tag"],
    ["<script>alert(1)</script>", "tag", "script tag"],
    ["javascript:alert(1)", "javascript:", "javascript URL"],
    ["Shop onerror=alert(1)", "onerror", "event handler"],
    ["a", "short", "too short"],
  ];

  it.each(cases)("rejects %s", async (payload) => {
    const response = await brandingPost(jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: payload }));
    expect(response.status).toBe(400);
    // Nothing was written when the payload is rejected.
    expect(state.updates).toEqual([]);
  });

  it("accepts a plain-text name and stores exactly that text", async () => {
    const response = await brandingPost(
      jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: "Sunrise Hardware & Supplies" }),
    );
    expect(response.status).toBe(200);
    expect(state.updates[0].data.name).toBe("Sunrise Hardware & Supplies");
  });

  it("trims and caps at 200 characters instead of storing an unbounded string", async () => {
    const long = "N".repeat(500);
    const response = await brandingPost(jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: `  ${long}  ` }));
    expect(response.status).toBe(200);
    expect(state.updates[0].data.name.length).toBe(200);
  });

  it("strips control characters", async () => {
    await brandingPost(jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: "A\u0000B\u0007C Store" }));
    expect(state.updates[0].data.name).toBe("ABC Store");
  });

  it("refuses a cross-tenant write even with a valid session", async () => {
    const response = await brandingPost(jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizB", business_name: "Stolen Name" }));
    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });
});

describe("mjengo: origin / CSRF boundary", () => {
  it("refuses a mutation from a foreign origin even with a valid session cookie", async () => {
    const response = await brandingPost(
      jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: "Foreign Write" }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("refuses a javascript: origin and a malformed forwarded protocol", async () => {
    const badOrigin = await brandingPost(
      jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: "X Store" }, { origin: "javascript:alert(1)" }),
    );
    expect(badOrigin.status).toBe(403);
    const badProto = await brandingPost(
      jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: "X Store" }, { "x-forwarded-proto": "file" }),
    );
    expect(badProto.status).toBe(403);
  });

  it("allows a same-origin request", async () => {
    const response = await brandingPost(jsonRequest(`${origin}/api/mjengo/branding`, { businessId: "bizA", business_name: "Same Origin Store" }));
    expect(response.status).toBe(200);
  });
});

describe("mjengo: journal route", () => {
  const valid = {
    businessId: "bizA",
    description: "Stock purchase",
    lines: [
      { accountCode: "1200", debitCents: 100000 },
      { accountCode: "4100", creditCents: 100000 },
    ],
  };

  it("requires a session", async () => {
    state.session = null;
    expect((await journalPost(jsonRequest(`${origin}/api/mjengo/journal`, valid))).status).toBe(401);
  });

  it("refuses a cross-tenant journal", async () => {
    const response = await journalPost(jsonRequest(`${origin}/api/mjengo/journal`, { ...valid, businessId: "bizB" }));
    expect(response.status).toBe(403);
    expect(state.created).toEqual([]);
  });

  it("refuses foreign-origin posting", async () => {
    const response = await journalPost(jsonRequest(`${origin}/api/mjengo/journal`, valid, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(state.created).toEqual([]);
  });

  it("refuses amount abuse: floats, negatives, both-sides and zero lines", async () => {
    const bad = [
      { ...valid, lines: [{ accountCode: "1200", debitCents: 1.5 }, { accountCode: "4100", creditCents: 1 }] },
      { ...valid, lines: [{ accountCode: "1200", debitCents: -100 }, { accountCode: "4100", creditCents: -100 }] },
      { ...valid, lines: [{ accountCode: "1200", debitCents: 100, creditCents: 100 }, { accountCode: "4100", creditCents: 100 }] },
      { ...valid, lines: [{ accountCode: "1200", debitCents: 0 }, { accountCode: "4100", creditCents: 0 }] },
      { ...valid, lines: [{ accountCode: "1200", debitCents: 100 }] },
    ];
    for (const body of bad) {
      const response = await journalPost(jsonRequest(`${origin}/api/mjengo/journal`, body));
      expect(response.status).toBe(400);
    }
    expect(state.created).toEqual([]);
  });

  it("passes a valid journal to the accounting module unchanged", async () => {
    const response = await journalPost(jsonRequest(`${origin}/api/mjengo/journal`, valid));
    expect(response.status).toBe(201);
    expect(state.created[0]).toMatchObject({ businessId: "bizA", actorId: "userA", description: "Stock purchase" });
  });

  it("reports empty and unbalanced posted journals, and orphaned lines", async () => {
    state.journals = [
      { id: "j_empty", status: "POSTED", businessId: "bizA" },
      { id: "j_unbalanced", status: "POSTED", businessId: "bizA" },
      { id: "j_ok", status: "POSTED", businessId: "bizA" },
    ];
    state.lines = [
      { id: "l1", journalId: "j_unbalanced", businessId: "bizA", debitCents: 100, creditCents: 0 },
      { id: "l2", journalId: "j_unbalanced", businessId: "bizA", debitCents: 0, creditCents: 90 },
      { id: "l3", journalId: "j_ok", businessId: "bizA", debitCents: 100, creditCents: 0 },
      { id: "l4", journalId: "j_ok", businessId: "bizA", debitCents: 0, creditCents: 100 },
      { id: "l5", journalId: "j_missing", businessId: "bizA", debitCents: 5, creditCents: 0 },
    ];
    const response = await journalGet(new Request(`${origin}/api/mjengo/journal?businessId=bizA`));
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.empty).toEqual(["j_empty"]);
    expect(body.unbalanced).toEqual(["j_unbalanced"]);
    expect(body.orphaned).toEqual(["l5"]);
  });

  it("refuses an unauthenticated integrity read", async () => {
    state.session = null;
    expect((await journalGet(new Request(`${origin}/api/mjengo/journal?businessId=bizA`))).status).toBe(401);
  });
});
