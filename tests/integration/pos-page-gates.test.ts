/**
 * Server-rendered POS page authorization (§11, §36, §56).
 *
 * A page that reads the store behind the workspace loader must answer exactly like the API read
 * it displays: a cashier who types the sales URL sees the sales screen, a cashier who types the
 * reports URL gets the plain-language refusal and *nothing else* — the permission check runs
 * inside the access guard, before any store read. A screen that loads data the equivalent API
 * call refuses is not a UI gap, it is a data leak, so this file drives `loadPosPageWorkspace`,
 * the single loader every server-rendered POS page goes through, with the same in-memory
 * database the route suites use.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as any }));

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
  requireSession: vi.fn(async () => mocks.session),
  createSession: vi.fn(async () => "token"),
  verifySession: vi.fn(async () => mocks.session),
  setSessionCookie: vi.fn(async () => undefined),
  clearSessionCookie: vi.fn(async () => undefined),
  hashPassword: vi.fn(async () => "hash"),
  verifyPassword: vi.fn(async () => true),
  getSessionFromToken: vi.fn(async () => mocks.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

import prisma from "@/lib/db";
import type { FakeDb } from "@/tests/helpers/posFakeDb";
import { saveDraft } from "@/lib/pos/provisioning";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { PosAccessError } from "@/lib/pos/guard";

const OWNER = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const CASHIER = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };

const fake = () => (globalThis as any).__posFake as FakeDb;
function rows(model: string) {
  return fake().rows(model);
}

/** A live, configured business: the minimum a page may load behind. */
async function goLive() {
  await saveDraft({
    businessId: "bizA",
    answers: {
      business_type: "retail",
      sells: ["products"],
      payment_methods: ["cash", "mpesa"],
      keeps_stock: true,
      units: ["piece", "plate"],
      keeps_customers: false,
      has_staff: true,
      staff_count: 1,
      staff_roles: ["CASHIER"],
      multi_branch: false,
      branch_count: 1,
      stock_by_branch: false,
      tracks_expenses: true,
    },
    actorId: "userA",
    context: { businessName: "Nyumbani Kitchen" },
  });
  fake().rows("payment").push({
    id: "pay_gate_1",
    reference: "jata-pos-gate-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_gate_1", reference: "jata-pos-gate-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_gate_1",
    }),
  );
}

describe("loadPosPageWorkspace enforces the module read permission", () => {
  beforeEach(async () => {
    mocks.session = null;
    fake().reset();
    await goLive();
  });

  it("the owner loads the sales screen with the sales module read", async () => {
    mocks.session = OWNER;
    const gate = await loadPosPageWorkspace("bizA", "VIEW_SALES");
    expect(gate.workspace).toBeTruthy();
    expect(gate.refusal).toBeUndefined();
    expect(gate.permission).toBe("VIEW_SALES");
    expect(gate.basePath).toContain("bizA");
  });

  it("the owner may also load a read the cashier lacks, so refusal is about the role, not the page", async () => {
    mocks.session = OWNER;
    const gate = await loadPosPageWorkspace("bizA", "VIEW_REPORTS");
    expect(gate.workspace).toBeTruthy();
    expect(gate.refusal).toBeUndefined();
  });

  it("a cashier keeps the sales screen the CASHIER role holds", async () => {
    mocks.session = CASHIER;
    const gate = await loadPosPageWorkspace("bizA", "VIEW_SALES");
    expect(gate.workspace).toBeTruthy();
    expect(gate.refusal).toBeUndefined();
  });

  it("a cashier gets the plain-language refusal — and no workspace — for a module read they do not hold", async () => {
    mocks.session = CASHIER;
    const gate = await loadPosPageWorkspace("bizA", "VIEW_REPORTS");
    expect(gate.workspace).toBeUndefined();
    expect(typeof gate.refusal).toBe("string");
    expect(gate.refusal!.length).toBeGreaterThan(0);
  });

  it("a signed-out browser is re-thrown, not softened into a refusal, so the shell still says sign in", async () => {
    mocks.session = null;
    await expect(loadPosPageWorkspace("bizA", "VIEW_SALES")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("a different tenant is still a hard stop, not a page refusal", async () => {
    mocks.session = { userId: "userB", email: "b@example.com", role: "CUSTOMER", name: "Owner B" };
    await expect(loadPosPageWorkspace("bizA", "VIEW_SALES")).rejects.toBeInstanceOf(PosAccessError);
  });
});
