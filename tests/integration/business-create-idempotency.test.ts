import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: POST /api/business created a new row on every call, so a double tap, a retry
// after a timeout, or resubmitting step 1 after a refresh produced duplicate businesses.

const store = vi.hoisted(() => ({ businesses: new Map<string, any>(), creates: 0, raceOnce: false }));
const mocks = vi.hoisted(() => ({ session: { userId: "owner-a", role: "CUSTOMER" } as any, memberCreate: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return store.businesses.get(where.id) ?? null;
        return [...store.businesses.values()].find((b) => b.slug === where.slug) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = data.id ?? `cuid-${store.creates + 1}`;
        if (store.raceOnce) {
          // Simulate a concurrent request for the same draft committing first.
          store.raceOnce = false;
          store.businesses.set(id, { ...data, id });
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        if (store.businesses.has(id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        store.creates += 1;
        const row = { ...data, id };
        store.businesses.set(id, row);
        return row;
      }),
    },
    businessMember: { create: mocks.memberCreate },
  },
}));

import { POST } from "@/app/api/business/route";
import { deriveDraftBusinessId, isValidDraftKey } from "@/lib/businessDraft";

const DRAFT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const post = (body: unknown) => POST(new Request("https://example.test/api/business", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("idempotent business creation for onboarding drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.businesses.clear();
    store.creates = 0;
    store.raceOnce = false;
    mocks.session = { userId: "owner-a", role: "CUSTOMER" };
  });

  it("repeating the same draft create (double tap / retry / refresh) returns the same business once", async () => {
    const first = await post({ name: "Wanjiru Salon", draftKey: DRAFT });
    expect(first.status).toBe(201);
    const created = (await first.json()).business;
    for (let i = 0; i < 3; i++) {
      const again = await post({ name: "Wanjiru Salon", draftKey: DRAFT });
      expect(again.status).toBe(200);
      const body = await again.json();
      expect(body.idempotent).toBe(true);
      expect(body.business.id).toBe(created.id);
      expect(body.business.slug).toBe(created.slug);
    }
    expect(store.creates).toBe(1);
    expect(store.businesses.size).toBe(1);
    expect(mocks.memberCreate).toHaveBeenCalledTimes(1);
  });

  it("a concurrent duplicate that loses the primary-key race returns the winning business", async () => {
    store.raceOnce = true;
    const response = await post({ name: "Race Cafe", draftKey: DRAFT });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.idempotent).toBe(true);
    expect(body.business.id).toBe(deriveDraftBusinessId("owner-a", DRAFT));
    expect(store.businesses.size).toBe(1);
  });

  it("the same draft key from a different owner can never read or reuse another owner's business", async () => {
    await post({ name: "Owner A Shop", draftKey: DRAFT });
    mocks.session = { userId: "owner-b", role: "CUSTOMER" };
    const other = await post({ name: "Owner B Shop", draftKey: DRAFT });
    expect(other.status).toBe(201);
    const body = await other.json();
    expect(body.business.ownerId).toBe("owner-b");
    expect(body.business.id).not.toBe(deriveDraftBusinessId("owner-a", DRAFT));
    expect(store.businesses.size).toBe(2);
  });

  it("refuses to hand back a business owned by someone else even on an id match", async () => {
    store.businesses.set(deriveDraftBusinessId("owner-a", DRAFT), { id: deriveDraftBusinessId("owner-a", DRAFT), ownerId: "intruder", slug: "x", name: "X" });
    const response = await post({ name: "Mine", draftKey: DRAFT });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("intruder");
  });

  it("different drafts (a genuine second business) still create separate businesses", async () => {
    await post({ name: "Shop One", draftKey: DRAFT });
    const second = await post({ name: "Shop Two", draftKey: "9b2d7c1e-0a4f-4c3b-8e6d-5f1a2b3c4d5e" });
    expect(second.status).toBe(201);
    expect(store.creates).toBe(2);
  });

  it("requests without a valid draft key keep the original behaviour (no client-chosen ids)", async () => {
    const response = await post({ name: "Legacy", draftKey: "../../etc" });
    expect(response.status).toBe(201);
    const body = await response.json();
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
