import { beforeEach, describe, expect, it, vi } from "vitest";

// Regressions for POST /api/business:
// 1. It created a new row on every call, so a double tap, a retry after a timeout, or resubmitting
//    step 1 after a refresh produced duplicate businesses (fixed with draftKey idempotency).
// 2. Review finding on PR #12: if the Business row was written but the owner BusinessMember row was
//    not, a retry returned the business as "idempotent" without the required owner membership.
//
// The mock below behaves like the database for the parts that matter: a unique primary key on
// Business.id and slug, a unique (userId, businessId) on BusinessMember, and nested creates that are
// atomic (if the nested membership write fails, the business is not persisted either).

type Member = { id: string; userId: string; businessId: string; role: string };
const store = vi.hoisted(() => ({
  businesses: new Map<string, any>(),
  members: [] as Member[],
  creates: 0,
  raceOnce: false,
  failNestedMemberOnce: false,
  failUpsertTimes: 0,
  upsertRaceOnce: false,
}));
const mocks = vi.hoisted(() => ({ session: { userId: "owner-a", role: "CUSTOMER" } as any, audit: vi.fn() }));

const uniqueError = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/db", () => {
  const findMember = (userId: string, businessId: string) => store.members.find((m) => m.userId === userId && m.businessId === businessId) ?? null;
  return {
    default: {
      business: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.id) return store.businesses.get(where.id) ?? null;
          return [...store.businesses.values()].find((b) => b.slug === where.slug) ?? null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const { members, ...fields } = data;
          const id = fields.id ?? `cuid-${store.creates + 1}`;
          if (store.raceOnce) {
            // A concurrent request for the same draft committed first (business + membership, atomically).
            store.raceOnce = false;
            store.businesses.set(id, { ...fields, id });
            store.members.push({ id: `m-${store.members.length + 1}`, userId: fields.ownerId, businessId: id, role: "OWNER" });
            throw uniqueError();
          }
          if (store.businesses.has(id) || [...store.businesses.values()].some((b) => b.slug === fields.slug)) throw uniqueError();
          if (members?.create && store.failNestedMemberOnce) {
            // Nested write failed: the whole create is rolled back, nothing is persisted.
            store.failNestedMemberOnce = false;
            throw new Error("membership write failed");
          }
          store.creates += 1;
          const row = { ...fields, id };
          store.businesses.set(id, row);
          if (members?.create) store.members.push({ id: `m-${store.members.length + 1}`, businessId: id, userId: members.create.userId, role: members.create.role });
          return row;
        }),
      },
      businessMember: {
        create: vi.fn(async () => {
          throw new Error("unexpected separate (non-atomic) membership create");
        }),
        findUnique: vi.fn(async ({ where }: any) => findMember(where.userId_businessId.userId, where.userId_businessId.businessId)),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const { userId, businessId } = where.userId_businessId;
          if (store.failUpsertTimes > 0) {
            store.failUpsertTimes -= 1;
            throw new Error("database unavailable");
          }
          if (store.upsertRaceOnce) {
            // Another retry inserted the membership between this upsert's read and write.
            store.upsertRaceOnce = false;
            store.members.push({ id: `m-${store.members.length + 1}`, ...create });
            throw uniqueError();
          }
          const existing = findMember(userId, businessId);
          if (existing) return Object.assign(existing, update);
          const row = { id: `m-${store.members.length + 1}`, ...create };
          store.members.push(row);
          return row;
        }),
      },
    },
  };
});

import prisma from "@/lib/db";
import { POST } from "@/app/api/business/route";
import { deriveDraftBusinessId, isValidDraftKey } from "@/lib/businessDraft";

const DRAFT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const post = (body: unknown) => POST(new Request("https://example.test/api/business", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const ownerMemberships = (userId: string, businessId: string) => store.members.filter((m) => m.userId === userId && m.businessId === businessId && m.role === "OWNER");

/** Invariant: any successful create/idempotent response points at a business with exactly one owner membership. */
async function expectSuccessWithOwnerMembership(response: Response, userId: string) {
  expect([200, 201]).toContain(response.status);
  const body = await response.json();
  expect(body.business.ownerId).toBe(userId);
  expect(store.businesses.has(body.business.id)).toBe(true);
  expect(ownerMemberships(userId, body.business.id)).toHaveLength(1);
  return body;
}

describe("idempotent business creation for onboarding drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.businesses.clear();
    store.members.length = 0;
    store.creates = 0;
    store.raceOnce = false;
    store.failNestedMemberOnce = false;
    store.failUpsertTimes = 0;
    store.upsertRaceOnce = false;
    mocks.session = { userId: "owner-a", role: "CUSTOMER" };
  });

  it("normal first creation writes the business and its OWNER membership in one atomic create", async () => {
    const response = await post({ name: "Wanjiru Salon", draftKey: DRAFT });
    expect(response.status).toBe(201);
    const body = await expectSuccessWithOwnerMembership(response, "owner-a");
    expect(body.business.id).toBe(deriveDraftBusinessId("owner-a", DRAFT));
    expect(body.idempotent).toBeUndefined();
    expect(prisma.business.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ members: { create: { userId: "owner-a", role: "OWNER" } } }) }));
    expect(prisma.businessMember.create).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("repeating the same draft create (double tap / retry / refresh) returns the same business once", async () => {
    const first = await post({ name: "Wanjiru Salon", draftKey: DRAFT });
    expect(first.status).toBe(201);
    const created = (await first.json()).business;
    for (let i = 0; i < 3; i++) {
      const again = await post({ name: "Wanjiru Salon", draftKey: DRAFT });
      expect(again.status).toBe(200);
      const body = await expectSuccessWithOwnerMembership(again, "owner-a");
      expect(body.idempotent).toBe(true);
      expect(body.business.id).toBe(created.id);
      expect(body.business.slug).toBe(created.slug);
    }
    expect(store.creates).toBe(1);
    expect(store.businesses.size).toBe(1);
    expect(store.members).toHaveLength(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("concurrent double submission creates one business with one owner membership", async () => {
    const [a, b] = await Promise.all([post({ name: "Double Tap Cafe", draftKey: DRAFT }), post({ name: "Double Tap Cafe", draftKey: DRAFT })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const bodies = [await expectSuccessWithOwnerMembership(a, "owner-a"), await expectSuccessWithOwnerMembership(b, "owner-a")];
    expect(bodies[0].business.id).toBe(bodies[1].business.id);
    expect(store.creates).toBe(1);
    expect(store.businesses.size).toBe(1);
    expect(store.members).toHaveLength(1);
  });

  it("a concurrent duplicate that loses the primary-key race returns the winning business with its membership", async () => {
    store.raceOnce = true;
    const response = await post({ name: "Race Cafe", draftKey: DRAFT });
    expect(response.status).toBe(200);
    const body = await expectSuccessWithOwnerMembership(response, "owner-a");
    expect(body.idempotent).toBe(true);
    expect(body.business.id).toBe(deriveDraftBusinessId("owner-a", DRAFT));
    expect(store.businesses.size).toBe(1);
  });

  it("failure while writing the owner membership leaves nothing behind, and the retry creates both", async () => {
    store.failNestedMemberOnce = true;
    const failed = await post({ name: "Flaky Network Shop", draftKey: DRAFT });
    expect(failed.status).toBe(500);
    const failedBody = await failed.json();
    expect(failedBody.business).toBeUndefined();
    expect(failedBody.idempotent).toBeUndefined();
    expect(store.businesses.size).toBe(0);
    expect(store.members).toHaveLength(0);

    const retry = await post({ name: "Flaky Network Shop", draftKey: DRAFT });
    expect(retry.status).toBe(201);
    await expectSuccessWithOwnerMembership(retry, "owner-a");
    expect(store.businesses.size).toBe(1);
  });

  it("a retry that finds a business without its owner membership completes the membership before reporting success", async () => {
    // Partial state as left by the earlier non-atomic implementation (business written, membership not).
    const id = deriveDraftBusinessId("owner-a", DRAFT);
    store.businesses.set(id, { id, ownerId: "owner-a", slug: "half-made-shop", name: "Half Made Shop" });
    expect(ownerMemberships("owner-a", id)).toHaveLength(0);

    const retry = await post({ name: "Half Made Shop", draftKey: DRAFT });
    expect(retry.status).toBe(200);
    const body = await expectSuccessWithOwnerMembership(retry, "owner-a");
    expect(body.idempotent).toBe(true);
    expect(body.business.id).toBe(id);
    expect(store.creates).toBe(0);

    // Further retries stay idempotent and never duplicate the membership.
    await expectSuccessWithOwnerMembership(await post({ name: "Half Made Shop", draftKey: DRAFT }), "owner-a");
    expect(store.members).toHaveLength(1);
  });

  it("if the missing membership cannot be completed, the retry fails safely instead of reporting success", async () => {
    const id = deriveDraftBusinessId("owner-a", DRAFT);
    store.businesses.set(id, { id, ownerId: "owner-a", slug: "half-made-shop", name: "Half Made Shop" });
    store.failUpsertTimes = 1;

    const failed = await post({ name: "Half Made Shop", draftKey: DRAFT });
    expect(failed.status).toBe(500);
    const failedBody = await failed.json();
    expect(failedBody.business).toBeUndefined();
    expect(failedBody.idempotent).toBeUndefined();
    expect(ownerMemberships("owner-a", id)).toHaveLength(0);

    // Once the database recovers, the next retry completes the membership and succeeds.
    const retry = await post({ name: "Half Made Shop", draftKey: DRAFT });
    expect(retry.status).toBe(200);
    await expectSuccessWithOwnerMembership(retry, "owner-a");
  });

  it("two retries racing to repair the same membership both succeed with exactly one membership", async () => {
    const id = deriveDraftBusinessId("owner-a", DRAFT);
    store.businesses.set(id, { id, ownerId: "owner-a", slug: "half-made-shop", name: "Half Made Shop" });
    store.upsertRaceOnce = true;
    const response = await post({ name: "Half Made Shop", draftKey: DRAFT });
    expect(response.status).toBe(200);
    await expectSuccessWithOwnerMembership(response, "owner-a");
  });

  it("a non-owner membership role for the owner is corrected to OWNER before success", async () => {
    const id = deriveDraftBusinessId("owner-a", DRAFT);
    store.businesses.set(id, { id, ownerId: "owner-a", slug: "odd-role-shop", name: "Odd Role Shop" });
    store.members.push({ id: "m-x", userId: "owner-a", businessId: id, role: "STAFF" });
    await expectSuccessWithOwnerMembership(await post({ name: "Odd Role Shop", draftKey: DRAFT }), "owner-a");
    expect(store.members).toHaveLength(1);
  });

  it("the same draft key from a different owner can never read or reuse another owner's business", async () => {
    await post({ name: "Owner A Shop", draftKey: DRAFT });
    mocks.session = { userId: "owner-b", role: "CUSTOMER" };
    const other = await post({ name: "Owner B Shop", draftKey: DRAFT });
    expect(other.status).toBe(201);
    const body = await expectSuccessWithOwnerMembership(other, "owner-b");
    expect(body.business.id).not.toBe(deriveDraftBusinessId("owner-a", DRAFT));
    expect(store.businesses.size).toBe(2);
    // Owner B gained no membership on owner A's business.
    expect(ownerMemberships("owner-b", deriveDraftBusinessId("owner-a", DRAFT))).toHaveLength(0);
  });

  it("refuses to hand back (or join) a business owned by someone else even on an id match", async () => {
    const id = deriveDraftBusinessId("owner-a", DRAFT);
    store.businesses.set(id, { id, ownerId: "intruder", slug: "x", name: "X" });
    const response = await post({ name: "Mine", draftKey: DRAFT });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("intruder");
    expect(prisma.businessMember.upsert).not.toHaveBeenCalled();
    expect(store.members).toHaveLength(0);
  });

  it("different drafts (a genuine second business) still create separate businesses", async () => {
    await post({ name: "Shop One", draftKey: DRAFT });
    const second = await post({ name: "Shop Two", draftKey: "9b2d7c1e-0a4f-4c3b-8e6d-5f1a2b3c4d5e" });
    expect(second.status).toBe(201);
    await expectSuccessWithOwnerMembership(second, "owner-a");
    expect(store.creates).toBe(2);
  });

  it("requests without a valid draft key keep the original behaviour (no client-chosen ids), now atomically", async () => {
    const response = await post({ name: "Legacy", draftKey: "../../etc" });
    expect(response.status).toBe(201);
    const body = await expectSuccessWithOwnerMembership(response, "owner-a");
    expect(body.business.id).toMatch(/^cuid-/);
    expect(isValidDraftKey("../../etc")).toBe(false);
    expect(isValidDraftKey(DRAFT)).toBe(true);
  });

  it("derived ids are deterministic per owner+draft and distinct across owners", () => {
    expect(deriveDraftBusinessId("owner-a", DRAFT)).toBe(deriveDraftBusinessId("owner-a", DRAFT.toUpperCase()));
    expect(deriveDraftBusinessId("owner-a", DRAFT)).not.toBe(deriveDraftBusinessId("owner-b", DRAFT));
    expect(deriveDraftBusinessId("owner-a", DRAFT)).toMatch(/^d[0-9a-f]{24}$/);
  });
});
