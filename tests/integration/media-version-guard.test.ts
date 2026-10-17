/**
 * Media edit version guards — PATCH /api/media is a compare-and-swap on `MediaAsset.updatedAt`.
 *
 * The bug this suite exists to prevent: two places hold the same library image open (a second
 * tab, or two people with access to one business). Each rewrites the description from the copy
 * it loaded, and the later save silently erases the earlier one — nothing errors, the text is
 * simply gone.
 *
 * The contract asserted here:
 *  - An edit must name the version it was made from. Missing or unparseable: 428, nothing changed.
 *  - A stale version: 409, and the newer text survives. The client is never told the write worked.
 *  - The write itself is conditional. A change that lands between the route's read and its update
 *    still produces 409 rather than an overwrite — the pre-check is an optimization, not the
 *    guarantee.
 *  - Authorization is untouched: a foreign tenant is refused before any version is discussed, and
 *    the conditional update is scoped by `businessId` as well as `id`.
 *
 * The fake database below applies `updateMany` the way Prisma does — matching on id, tenant and
 * the stored version — so these tests prove the guard, not the mock.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNED = "business-a";
const FOREIGN = "business-b";
const V1 = new Date("2026-10-01T10:00:00.000Z");
const V2 = new Date("2026-10-01T10:05:00.000Z");

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  rows: new Map<string, any>(),
  applied: [] as any[],
  audit: [] as any[],
  reads: 0,
  onRead: null as null | { at: number; before?: () => void; after?: (row: any) => void },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));

vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  assertBusinessOwnership: vi.fn(async () => undefined),
  // Mirrors the real guard: the stored row decides which tenant may change it, and a foreign
  // business is refused with 403 before any version token is looked at.
  guardTenantMutation: vi.fn(async (_session: unknown, businessId?: string | null) => {
    if (!businessId) return { ok: false as const, status: 400 as const, error: "Choose a business before saving." };
    if (businessId !== OWNED) return { ok: false as const, status: 403 as const, error: "You don't have access to that business." };
    return { ok: true as const };
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (event: any) => {
    mocks.audit.push(event);
  }),
}));

vi.mock("@/lib/db", () => ({
  default: {
    mediaAsset: {
      findUnique: vi.fn(async ({ where }: any) => {
        mocks.reads += 1;
        const plan = mocks.onRead && mocks.onRead.at === mocks.reads ? mocks.onRead : null;
        if (plan) mocks.onRead = null;
        plan?.before?.();
        const row = mocks.rows.get(where.id);
        if (!row) return null;
        const snapshot = { ...row };
        // A concurrent write can land after the route has read (and copied) the row.
        plan?.after?.(row);
        return snapshot;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = mocks.rows.get(where.id);
        if (!row) return { count: 0 };
        if (where.businessId && row.businessId !== where.businessId) return { count: 0 };
        if (new Date(row.updatedAt).getTime() !== new Date(where.updatedAt).getTime()) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date(new Date(row.updatedAt).getTime() + 1000) });
        mocks.applied.push({ where, data });
        return { count: 1 };
      }),
    },
  },
}));

import { PATCH } from "@/app/api/media/route";

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/media", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function seed(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "a1",
    businessId: OWNED,
    url: "https://cdn.jata.test/ugali.jpg",
    kind: "IMAGE",
    alt: "Ugali and sukuma wiki",
    width: 1200,
    height: 900,
    bytes: 1024,
    mime: "image/jpeg",
    source: "UPLOAD",
    label: null,
    aiGenerationId: null,
    createdAt: V1,
    updatedAt: V1,
    ...overrides,
  };
  mocks.rows.set(row.id, row);
  return row;
}

beforeEach(() => {
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.rows.clear();
  mocks.applied = [];
  mocks.audit = [];
  mocks.reads = 0;
  mocks.onRead = null;
});

describe("an edit must name the version it was made from", () => {
  it("refuses an edit with no version token, and changes nothing", async () => {
    seed();
    const response = await patch({ id: "a1", alt: "A new description" });
    expect(response.status).toBe(428);
    const body = await response.json();
    expect(body.code).toBe("media_version_required");
    expect(body.error).toMatch(/version/i);
    expect(mocks.rows.get("a1").alt).toBe("Ugali and sukuma wiki");
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.audit).toHaveLength(0);
  });

  it("refuses every unusable shape of token with 428 rather than guessing a version", async () => {
    seed();
    const badTokens: unknown[] = ["", "   ", "not-a-date", "2026-13-45T99:99:99Z", "2026-10-01T10:00:00.000Z extra", 1759312800000, null, true, {}, []];
    for (const expectedUpdatedAt of badTokens) {
      const response = await patch({ id: "a1", alt: "Attempted overwrite", expectedUpdatedAt });
      expect(response.status, `token ${JSON.stringify(expectedUpdatedAt)}`).toBe(428);
    }
    expect(mocks.rows.get("a1").alt).toBe("Ugali and sukuma wiki");
    expect(mocks.applied).toHaveLength(0);
  });

  it("does not discuss the version with a caller who may not touch the image", async () => {
    seed({ businessId: FOREIGN });
    const response = await patch({ id: "a1", alt: "Foreign overwrite", expectedUpdatedAt: V1.toISOString() });
    expect(response.status).toBe(403);
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.rows.get("a1").alt).toBe("Ugali and sukuma wiki");
  });
});

describe("the version the owner read is the version that gets written", () => {
  it("saves when the token matches and hands back the new version", async () => {
    seed();
    const response = await patch({ id: "a1", alt: "Ugali, sukuma wiki and grilled chicken", expectedUpdatedAt: V1.toISOString() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.asset.alt).toBe("Ugali, sukuma wiki and grilled chicken");
    expect(new Date(body.asset.updatedAt).getTime()).toBe(V1.getTime() + 1000);
    expect(mocks.rows.get("a1").alt).toBe("Ugali, sukuma wiki and grilled chicken");
    expect(mocks.audit).toHaveLength(1);
    expect(mocks.audit[0].action).toBe("MEDIA_UPDATED");
  });

  it("scopes the conditional write to the tenant as well as the asset", async () => {
    seed();
    await patch({ id: "a1", alt: "Scoped write", expectedUpdatedAt: V1.toISOString() });
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0].where).toEqual({ id: "a1", businessId: OWNED, updatedAt: V1 });
  });

  it("keeps the existing validation: an empty description clears the field", async () => {
    seed();
    const response = await patch({ id: "a1", alt: "", expectedUpdatedAt: V1.toISOString() });
    expect(response.status).toBe(200);
    expect(mocks.rows.get("a1").alt).toBeNull();
  });
});

describe("a stale edit never overwrites a newer one", () => {
  it("refuses the second save built from an older version and keeps the newer text", async () => {
    seed();
    const first = await patch({ id: "a1", alt: "Written by the first window", expectedUpdatedAt: V1.toISOString() });
    expect(first.status).toBe(200);

    // The second window still holds V1. It must not win.
    const second = await patch({ id: "a1", alt: "Written by the stale window", expectedUpdatedAt: V1.toISOString() });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.code).toBe("media_version_conflict");
    expect(mocks.rows.get("a1").alt).toBe("Written by the first window");
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.audit).toHaveLength(1);
  });

  it("refuses a write that loses a race between the check and the update", async () => {
    seed();
    // The route reads V1, then another writer stores V2 before the conditional update runs.
    mocks.onRead = { at: 1, after: (row) => { row.updatedAt = V2; row.alt = "Written by someone else"; } };

    const response = await patch({ id: "a1", alt: "Built from the version that was already gone", expectedUpdatedAt: V1.toISOString() });
    expect(response.status).toBe(409);
    expect(mocks.rows.get("a1").alt).toBe("Written by someone else");
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.audit).toHaveLength(0);
  });

  it("reports a conflict when the image disappears mid-edit instead of claiming success", async () => {
    seed();
    mocks.onRead = { at: 2, before: () => { mocks.rows.delete("a1"); } };
    const response = await patch({ id: "a1", alt: "Written to a row that is gone", expectedUpdatedAt: V1.toISOString() });
    expect(response.status).toBe(409);
    expect(mocks.audit).toHaveLength(0);
  });
});

describe("the rest of the PATCH contract is unchanged", () => {
  it("requires a signed-in owner", async () => {
    seed();
    mocks.session = null;
    expect((await patch({ id: "a1", alt: "No session", expectedUpdatedAt: V1.toISOString() })).status).toBe(401);
  });

  it("still needs an id, an existing asset and something to change", async () => {
    seed();
    expect((await patch({ alt: "No id", expectedUpdatedAt: V1.toISOString() })).status).toBe(400);
    expect((await patch({ id: "missing", alt: "No row", expectedUpdatedAt: V1.toISOString() })).status).toBe(404);
    expect((await patch({ id: "a1", expectedUpdatedAt: V1.toISOString() })).status).toBe(400);
    expect(mocks.applied).toHaveLength(0);
  });

  it("normalizes an unknown kind and label the way the library always has", async () => {
    seed();
    const response = await patch({ id: "a1", kind: "not-a-kind", label: "ACTUAL", expectedUpdatedAt: V1.toISOString() });
    expect(response.status).toBe(200);
    expect(mocks.rows.get("a1").kind).toBe("IMAGE");
    expect(mocks.rows.get("a1").label).toBe("ACTUAL");
  });
});
