/**
 * JATA Autopilot activation — server contract for all three plans.
 *
 * Reproduces the reported failure by exercising the real `POST /api/checkout` handler, the real
 * tenant/authorisation code and the real verified-payment settlement path against an in-memory
 * database (no Postgres is available in this sandbox, and no provider call is made: the Paystack
 * initialiser is replaced with a mock so nothing can be charged).
 *
 * Covered: correct plan identifier per tier, authoritative server pricing/duration, sign-in and
 * tenant enforcement, invalid-plan rejection, provider/network/config failure feedback, duplicate
 * and concurrent click protection, and verified-payment-only activation scoped to one tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

/**
 * Everything the fake database needs lives inside `vi.hoisted`, because `vi.mock` factories are
 * hoisted above the module's own top-level constants.
 */
const hoisted = vi.hoisted(() => {
  const state = {
    session: null as null | { userId: string; email: string; role: string },
    businesses: new Map<string, Row>(),
    members: [] as Row[],
    users: new Map<string, Row>(),
    plans: new Map<string, Row>(),
    payments: new Map<string, Row>(),
    processedWebhooks: new Set<string>(),
    autopilotSubs: new Map<string, Row>(),
    autopilotEnts: new Map<string, Row>(),
    aftercallSubs: new Map<string, Row>(),
    audits: [] as Row[],
    businessStatusUpdates: [] as Row[],
    seq: 1,
  };

  const nextId = (p: string) => `${p}_${state.seq++}`;

  function matches(row: Row, where: Row): boolean {
    for (const [key, value] of Object.entries(where ?? {})) {
      if (value === undefined) continue;
      const actual = row[key];
      if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
        if ("gte" in value && !(actual >= (value as any).gte)) return false;
        if ("lt" in value && !(actual < (value as any).lt)) return false;
        if ("not" in value && actual === (value as any).not) return false;
        continue;
      }
      if (actual !== value) return false;
    }
    return true;
  }

  const db: any = {
    business: {
      findUnique: async ({ where }: any) => state.businesses.get(where.id) ?? null,
      findFirst: async ({ where }: any) => {
        const b = state.businesses.get(where.id);
        if (!b) return null;
        if (where.ownerId && b.ownerId !== where.ownerId) return null;
        return b;
      },
      findMany: async ({ where }: any) =>
        [...state.businesses.values()].filter((b) => b.ownerId === where.ownerId),
      update: async ({ where, data }: any) => {
        const b = state.businesses.get(where.id);
        state.businessStatusUpdates.push({ id: where.id, ...data });
        return { ...b, ...data };
      },
    },
    businessMember: {
      findMany: async ({ where }: any) => state.members.filter((m) => m.userId === where.userId),
      findFirst: async ({ where }: any) =>
        state.members.find((m) => m.businessId === where?.businessId && m.userId === where?.userId) ?? null,
    },
    user: { findUnique: async ({ where }: any) => state.users.get(where.id) ?? null },
    planConfig: {
      findUnique: async ({ where }: any) => {
        if (where.id) return state.plans.get(where.id) ?? null;
        if (where.key) return [...state.plans.values()].find((p) => p.key === where.key) ?? null;
        return null;
      },
    },
    payment: {
      create: async ({ data }: any) => {
        const row = { id: nextId("pay"), createdAt: new Date(), ...data };
        state.payments.set(row.id, row);
        return { ...row };
      },
      findUnique: async ({ where }: any) => {
        if (where.id) return state.payments.get(where.id) ?? null;
        if (where.reference) return [...state.payments.values()].find((p) => p.reference === where.reference) ?? null;
        return null;
      },
      // A "raceOnly" row is invisible to the pre-check read but visible to the post-create
      // convergence read — exactly the window two simultaneous clicks create in PostgreSQL.
      findFirst: async ({ where }: any) =>
        [...state.payments.values()].find((p) => !p.raceOnly && matches(p, where)) ?? null,
      findMany: async ({ where }: any) => {
        const rows = [...state.payments.values()].filter((p) => matches(p, where));
        return rows.sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || String(a.id).localeCompare(String(b.id)));
      },
      update: async ({ where, data }: any) => {
        const row = { ...state.payments.get(where.id), ...data };
        state.payments.set(where.id, row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, row] of state.payments) {
          if (matches(row, where)) {
            state.payments.set(id, { ...row, ...data });
            count++;
          }
        }
        return { count };
      },
    },
    processedWebhook: {
      findUnique: async ({ where }: any) => (state.processedWebhooks.has(where.id) ? { id: where.id } : null),
      create: async ({ data }: any) => {
        if (state.processedWebhooks.has(data.id)) {
          const err: any = new Error("unique");
          err.code = "P2002";
          throw err;
        }
        state.processedWebhooks.add(data.id);
        return { id: data.id };
      },
      upsert: async ({ where }: any) => {
        state.processedWebhooks.add(where.id);
        return { id: where.id };
      },
    },
    autopilotSubscription: {
      findUnique: async ({ where }: any) => state.autopilotSubs.get(where.businessId) ?? null,
      findMany: async ({ where }: any) =>
        [...state.autopilotSubs.values()].filter((s) => where?.status?.in?.includes(s.status)),
      upsert: async ({ where, create, update }: any) => {
        const current = state.autopilotSubs.get(where.businessId);
        const saved = current ? { ...current, ...update } : { id: nextId("apsub"), ...create };
        state.autopilotSubs.set(where.businessId, saved);
        return saved;
      },
      update: async ({ where, data }: any) => {
        for (const [businessId, row] of state.autopilotSubs) {
          if (row.id === where.id) {
            state.autopilotSubs.set(businessId, { ...row, ...data });
            return state.autopilotSubs.get(businessId);
          }
        }
        return null;
      },
    },
    autopilotEntitlement: {
      upsert: async ({ where, create, update }: any) => {
        const current = state.autopilotEnts.get(where.businessId);
        const saved = current ? { ...current, ...update } : { id: nextId("apent"), ...create };
        state.autopilotEnts.set(where.businessId, saved);
        return saved;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [businessId, row] of state.autopilotEnts) {
          if (businessId === where.businessId) {
            state.autopilotEnts.set(businessId, { ...row, ...data });
            count++;
          }
        }
        return { count };
      },
    },
    subscription: {
      findUnique: async ({ where }: any) => state.aftercallSubs.get(where.businessId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const current = state.aftercallSubs.get(where.businessId);
        const saved = current ? { ...current, ...update } : { id: nextId("sub"), ...create };
        state.aftercallSubs.set(where.businessId, saved);
        return saved;
      },
    },
    auditEvent: { create: async ({ data }: any) => ({ id: nextId("audit"), ...data }) },
    autopilotAuditEvent: {
      create: async ({ data }: any) => {
        const row = { id: nextId("apaudit"), createdAt: new Date(), ...data };
        state.audits.push(row);
        return row;
      },
      findMany: async ({ where }: any) => state.audits.filter((a) => a.businessId === where.businessId),
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };

  return { state, db, initialize: vi.fn() };
});

const state = hoisted.state;
const mocks = { initialize: hoisted.initialize };

vi.mock("@/lib/auth", () => ({ getSession: async () => hoisted.state.session }));

vi.mock("@/lib/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paystack")>();
  return { ...actual, initializeTransaction: hoisted.initialize };
});

vi.mock("@/lib/db", () => ({ default: hoisted.db, prisma: hoisted.db }));

import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { activateSubscriptionForPayment } from "@/lib/paystack";

const PLAN_ROWS = [
  { id: "plan_std", key: "JATA_AUTOPILOT", name: "JATA Autopilot", priceKES: 2499, durationDays: 30, isActive: true },
  { id: "plan_pro", key: "JATA_AUTOPILOT_PRO", name: "JATA Autopilot Pro", priceKES: 6999, durationDays: 30, isActive: true },
  { id: "plan_ent", key: "JATA_AUTOPILOT_ENTERPRISE", name: "JATA Autopilot Enterprise", priceKES: 19999, durationDays: 30, isActive: true },
];

function request(body: unknown) {
  return new Request("https://example.test/api/checkout", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function post(body: unknown) {
  const response = await checkoutRoute(request(body));
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

beforeEach(() => {
  state.seq = 1;
  state.businesses.clear();
  state.members = [];
  state.users.clear();
  state.plans.clear();
  state.payments.clear();
  state.processedWebhooks.clear();
  state.autopilotSubs.clear();
  state.autopilotEnts.clear();
  state.aftercallSubs.clear();
  state.audits = [];
  state.businessStatusUpdates = [];

  for (const plan of PLAN_ROWS) state.plans.set(plan.id, { ...plan });
  state.businesses.set("biz_a", { id: "biz_a", ownerId: "user_a", status: "PENDING" });
  state.businesses.set("biz_b", { id: "biz_b", ownerId: "user_b", status: "PENDING" });
  state.users.set("user_a", { id: "user_a", email: "owner-a@example.test" });
  state.users.set("user_b", { id: "user_b", email: "owner-b@example.test" });
  state.session = { userId: "user_a", email: "owner-a@example.test", role: "CUSTOMER" };

  mocks.initialize.mockReset();
  mocks.initialize.mockResolvedValue({
    authorization_url: "https://checkout.paystack.com/test-session",
    reference: "jata-test",
    access_code: "test",
  });
  vi.stubEnv("PAYSTACK_SECRET_KEY", "test-only-not-a-credential");
  vi.stubEnv("NODE_ENV", "test");
});

describe("1. each plan submits the correct identifier at the server price", () => {
  it.each([
    ["JATA_AUTOPILOT", 2499],
    ["JATA_AUTOPILOT_PRO", 6999],
    ["JATA_AUTOPILOT_ENTERPRISE", 19999],
  ])("%s resolves to KES %i / 30 days and one provider session", async (planKey, priceKES) => {
    const { status, json } = await post({ businessId: "biz_a", planKey });

    expect(status).toBe(200);
    expect(json.authorization_url).toBe("https://checkout.paystack.com/test-session");
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ amount: priceKES * 100, currency: "KES", email: "owner-a@example.test" }),
    );
    const payment = [...state.payments.values()][0];
    expect(payment).toMatchObject({
      businessId: "biz_a",
      userId: "user_a",
      amount: priceKES * 100,
      currency: "KES",
      status: "PENDING",
    });
    expect(state.plans.get(payment.planId)?.durationDays).toBe(30);
  });

  it("still accepts the stored plan id used by every other checkout flow", async () => {
    const { status } = await post({ businessId: "biz_a", planId: "plan_pro" });
    expect(status).toBe(200);
    expect([...state.payments.values()][0]).toMatchObject({ planId: "plan_pro", amount: 699900 });
  });
});

describe("2. client input cannot override the server's price or duration", () => {
  it("ignores client-supplied amount, currency, duration and price fields", async () => {
    const { status } = await post({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT_ENTERPRISE",
      amount: 1,
      priceKES: 1,
      currency: "USD",
      durationDays: 1,
    });
    expect(status).toBe(200);
    expect(mocks.initialize).toHaveBeenCalledWith(expect.objectContaining({ amount: 1999900, currency: "KES" }));
    expect([...state.payments.values()][0]).toMatchObject({ amount: 1999900, currency: "KES" });
  });

  it("refuses a plan id that does not match the requested key", async () => {
    const { status, json } = await post({ businessId: "biz_a", planId: "plan_pro", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(409);
    expect(json.code).toBe("PLAN_MISMATCH");
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("fails closed when the stored Autopilot price drifts from the catalogue", async () => {
    state.plans.set("plan_std", { ...PLAN_ROWS[0], priceKES: 2498 });
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(500);
    expect(json.code).toBe("PLAN_PRICING_INVALID");
    expect(state.payments.size).toBe(0);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("fails closed when the stored billing cycle is not 30 days", async () => {
    state.plans.set("plan_ent", { ...PLAN_ROWS[2], durationDays: 365 });
    const { status } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT_ENTERPRISE" });
    expect(status).toBe(500);
    expect(state.payments.size).toBe(0);
  });
});

describe("3. authentication and tenant ownership stay enforced", () => {
  it("returns the sign-in response for a signed-out caller", async () => {
    state.session = null;
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(401);
    expect(json).toMatchObject({ code: "SIGN_IN_REQUIRED", error: "Please sign in to continue." });
    expect(state.payments.size).toBe(0);
  });

  it("refuses another tenant's business without leaking its plan state", async () => {
    state.session = { userId: "user_b", email: "owner-b@example.test", role: "CUSTOMER" };
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(403);
    expect(json.error).toBe("You are not authorized to pay for this business.");
    expect(state.payments.size).toBe(0);
  });

  it("requires billing rights, not just read access, for an Autopilot plan", async () => {
    state.members.push({ userId: "user_staff", businessId: "biz_a", role: "STAFF" });
    state.session = { userId: "user_staff", email: "staff@example.test", role: "CUSTOMER" };
    const { status } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(403);
    expect(state.payments.size).toBe(0);
  });
});

describe("4. invalid plans are rejected", () => {
  it("refuses a key outside the Autopilot allowlist", async () => {
    const { status, json } = await post({ businessId: "biz_a", planKey: "MONTHLY" });
    expect(status).toBe(400);
    expect(json.code).toBe("PLAN_NOT_ALLOWED");
  });

  it("refuses an unknown stored plan id", async () => {
    const { status, json } = await post({ businessId: "biz_a", planId: "does-not-exist" });
    expect(status).toBe(404);
    expect(json.code).toBe("PLAN_NOT_FOUND");
  });

  it("refuses an inactive plan", async () => {
    state.plans.set("plan_std", { ...PLAN_ROWS[0], isActive: false });
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(400);
    expect(json.code).toBe("PLAN_UNAVAILABLE");
    expect(state.payments.size).toBe(0);
  });

  it("reports a missing catalogue row as configuration, not as a dead button", async () => {
    state.plans.delete("plan_std");
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(503);
    expect(json.code).toBe("PLAN_NOT_CONFIGURED");
    expect(String(json.error)).toContain("npm run seed");
    expect(state.payments.size).toBe(0);
  });
});

describe("5. provider and configuration failures produce recoverable feedback", () => {
  it("returns a provider error and fails the pending row when Paystack refuses", async () => {
    mocks.initialize.mockRejectedValueOnce(new Error("provider detail that must not leak"));
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(502);
    expect(json).toMatchObject({
      code: "PROVIDER_ERROR",
      error: "Paystack could not start this payment. Please try again.",
    });
    expect(JSON.stringify(json)).not.toContain("provider detail");
    expect([...state.payments.values()][0].status).toBe("FAILED");
  });

  it("says payments are unavailable when the deployment has no provider key", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT_PRO" });
    expect(status).toBe(503);
    expect(json.code).toBe("PAYMENTS_UNAVAILABLE");
    expect([...state.payments.values()][0].status).toBe("FAILED");
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
});

describe("6. repeated clicks cannot create a duplicate purchase", () => {
  it("refuses a second attempt while one payment is in progress", async () => {
    state.payments.set("pay_existing", {
      id: "pay_existing",
      reference: "jata-existing",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_std",
      amount: 249900,
      currency: "KES",
      status: "PENDING",
      createdAt: new Date(),
    });
    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(409);
    expect(json).toMatchObject({
      code: "CHECKOUT_IN_PROGRESS",
      reference: "jata-existing",
      statusUrl: "/checkout/callback?reference=jata-existing",
    });
    expect(state.payments.size).toBe(1);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("converges two simultaneous attempts onto one provider session", async () => {
    // The pre-check cannot see the racing row; the post-create read can. Both requests create
    // a PENDING row, and exactly one of them may proceed to Paystack.
    state.payments.set("pay_race", {
      id: "pay_race",
      reference: "jata-race",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_std",
      amount: 249900,
      currency: "KES",
      status: "PENDING",
      createdAt: new Date(Date.now() - 1000),
      raceOnly: true,
    });

    const { status, json } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(409);
    expect(json).toMatchObject({ code: "CHECKOUT_IN_PROGRESS", reference: "jata-race" });
    expect(mocks.initialize).not.toHaveBeenCalled();

    const mine = [...state.payments.values()].filter((p) => !p.raceOnly);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("CANCELLED");
  });

  it("retires an abandoned attempt after the pending window so the owner can retry", async () => {
    state.payments.set("pay_stale", {
      id: "pay_stale",
      reference: "jata-stale",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_std",
      amount: 249900,
      currency: "KES",
      status: "PENDING",
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    const { status } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT" });
    expect(status).toBe(200);
    expect(state.payments.get("pay_stale")?.status).toBe("EXPIRED");
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });

  it("keeps a fresh attempt for a different plan independent", async () => {
    state.payments.set("pay_std", {
      id: "pay_std",
      reference: "jata-std",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_std",
      amount: 249900,
      currency: "KES",
      status: "PENDING",
      createdAt: new Date(),
    });
    const { status } = await post({ businessId: "biz_a", planKey: "JATA_AUTOPILOT_PRO" });
    expect(status).toBe(200);
  });
});

describe("7. an unverified payment cannot activate a subscription", () => {
  function pendingPayment(over: Row = {}) {
    const row = {
      id: "pay_pending",
      reference: "jata-pending",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_std",
      amount: 249900,
      currency: "KES",
      status: "PENDING",
      createdAt: new Date(),
      ...over,
    };
    state.payments.set(row.id, row);
    return row;
  }

  it("refuses settlement without provider evidence", async () => {
    pendingPayment();
    await expect(activateSubscriptionForPayment("pay_pending")).rejects.toThrow("PAYMENT_EVIDENCE_REQUIRED");
    expect(state.autopilotSubs.size).toBe(0);
    expect(state.payments.get("pay_pending")?.status).toBe("PENDING");
  });

  it("refuses settlement when the recorded amount is not the plan price", async () => {
    pendingPayment({ amount: 14900 });
    await expect(
      activateSubscriptionForPayment("pay_pending", undefined, { paystackId: "ps_1" }),
    ).rejects.toThrow("PAYMENT_AMOUNT_MISMATCH");
    expect(state.autopilotSubs.size).toBe(0);
  });

  it("refuses settlement when the currency is not KES", async () => {
    pendingPayment({ currency: "USD" });
    await expect(
      activateSubscriptionForPayment("pay_pending", undefined, { paystackId: "ps_1" }),
    ).rejects.toThrow("PAYMENT_CURRENCY_MISMATCH");
    expect(state.autopilotSubs.size).toBe(0);
  });
});

describe("8. a verified payment activates only the correct tenant's subscription", () => {
  function verifiedPayment(over: Row = {}) {
    const row = {
      id: "pay_verified",
      reference: "jata-verified",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_pro",
      amount: 699900,
      currency: "KES",
      status: "PENDING",
      createdAt: new Date(),
      ...over,
    };
    state.payments.set(row.id, row);
    return row;
  }

  it("activates the paying business only, on the paid tier", async () => {
    verifiedPayment();
    state.aftercallSubs.set("biz_a", { id: "sub_a", businessId: "biz_a", status: "ACTIVE", planKey: "MONTHLY" });

    const result = await activateSubscriptionForPayment("pay_verified", undefined, { paystackId: "ps_verified" });

    expect(result.alreadySettled).toBe(false);
    expect(state.payments.get("pay_verified")?.status).toBe("PAID");
    expect(state.autopilotSubs.get("biz_a")).toMatchObject({
      planKey: "JATA_AUTOPILOT_PRO",
      status: "ACTIVE",
      paymentReference: "jata-verified",
    });
    expect(state.autopilotEnts.get("biz_a")).toMatchObject({ tier: "PRO", status: "ACTIVE" });
    expect(state.autopilotSubs.has("biz_b")).toBe(false);
    // The AFTERCALL page subscription is a different product and must not be rewritten.
    expect(state.aftercallSubs.get("biz_a")).toMatchObject({ planKey: "MONTHLY", status: "ACTIVE" });
  });

  it("is idempotent: replaying the same payment does not extend the period twice", async () => {
    verifiedPayment();
    await activateSubscriptionForPayment("pay_verified", "evt_1", { paystackId: "ps_verified" });
    const firstExpiry = state.autopilotSubs.get("biz_a")?.expiresAt;

    const replay = await activateSubscriptionForPayment("pay_verified", "evt_1", { paystackId: "ps_verified" });
    expect(replay.alreadySettled).toBe(true);
    expect(state.autopilotSubs.get("biz_a")?.expiresAt).toEqual(firstExpiry);
  });

  it("extends an active subscription from its existing expiry", async () => {
    verifiedPayment();
    const soon = new Date(Date.now() + 5 * 86_400_000);
    state.autopilotSubs.set("biz_a", {
      id: "apsub_existing",
      businessId: "biz_a",
      userId: "user_a",
      planId: "plan_std",
      planKey: "JATA_AUTOPILOT",
      status: "ACTIVE",
      startAt: new Date(Date.now() - 25 * 86_400_000),
      expiresAt: soon,
      graceUntil: new Date(soon.getTime() + 3 * 86_400_000),
      paymentId: "pay_previous",
    });

    await activateSubscriptionForPayment("pay_verified", undefined, { paystackId: "ps_verified" });

    const sub = state.autopilotSubs.get("biz_a");
    expect(sub?.planKey).toBe("JATA_AUTOPILOT_PRO");
    expect(new Date(sub!.expiresAt).getTime()).toBe(soon.getTime() + 30 * 86_400_000);
  });
});
