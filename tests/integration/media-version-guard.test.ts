/**
 * Media edit version guards — PATCH /api/media is a compare-and-swap on `MediaAsset.version`.
 *
 * The bug this suite exists to prevent: two places hold the same library image open (a second
 * tab, or two people with access to one business). Each rewrites the description from the copy
 * it loaded, and the later save silently erases the earlier one — nothing errors, the text is
 * simply gone.
 *
 * The contract asserted here:
 *  - An edit must name the version it was made from. Missing or unparseable: 428, nothing changed.
 *  - A stale version: 409, and the newer text survives. The client is never told the write worked.
 *  - The write itself is conditional (`id` + `tenant` + `version`) and increments the counter in
 *    the same statement, so a change that lands between the route's read and its update still
 *    produces 409 rather than an overwrite. The pre-check is an optimization, not the guarantee.
 *  - The guarantee does not depend on the clock. The fake database below deliberately stamps
 *    EVERY write with the same millisecond, which is exactly the case a `TIMESTAMP(3)` token
 *    could not separate. The counter still does.
 *  - Authorization is untouched: a foreign tenant is refused before any version is discussed,
 *    and the conditional update is scoped by `businessId` as well as `id`.
 *  - Audit records are written only when the conditional write actually applied.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNED = "business-a";
const FOREIGN = "business-b";

// Every write in this fake lands on the identical instant. If the guard depended on `updatedAt`
// at all, the second writer below would pass and these tests would fail.
const SAME_MS = new Date("2026-10-17T06:46:05.123Z");

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  rows: new Map<string, any>(),
  applied: [] as any[],
  audit: [] as any[],
  reads: 0,
  // One-shot hook, aimed at an absolute read number with `mocks.reads + N` so a test never has to
  // guess how many reads happened before it. `before` fires prior to the lookup (row vanishes),
  // `after` fires after the snapshot is taken (a concurrent writer wins the race).
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
      // Models Prisma's `updateMany`: it matches on id, tenant and the stored counter, and it
      // applies atomic `{ increment }` operations. A non-matching condition touches nothing.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = mocks.rows.get(where.id);
        if (!row) return { count: 0 };
        if (where.businessId && row.businessId !== where.businessId) return { count: 0 };
        if (where.version !== undefined && Number(row.version) !== Number(where.version)) return { count: 0 };

        const next: any = { ...row };
        for (const [key, value] of Object.entries(data)) {
          next[key] =
            value && typeof value === "object" && "increment" in (value as Record<string, unknown>)
              ? Number(next[key] ?? 0) + Number((value as { increment: number }).increment)
              : value;
        }
        // Deliberately identical to the previous value: the counter, not the clock, must decide.
        next.updatedAt = SAME_MS;

        mocks.rows.set(where.id, next);
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
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    version: 0,
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
    const badTokens: unknown[] = [
      "",
      "   ",
      "not-a-version",
      "1.5",
      "-1",
      1.5,
      -1,
      2147483648,
      null,
      true,
      {},
      [],
      // The superseded timestamp token is not a version: fail closed rather than reinterpret it.
      SAME_MS.toISOString(),
    ];
    for (const expectedVersion of badTokens) {
      const response = await patch({ id: "a1", alt: "Attempted overwrite", expectedVersion });
      expect(response.status, `token ${JSON.stringify(expectedVersion)}`).toBe(428);
    }
    expect(mocks.rows.get("a1").alt).toBe("Ugali and sukuma wiki");
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.audit).toHaveLength(0);
  });

  it("does not discuss the version with a caller who may not touch the image", async () => {
    seed({ businessId: FOREIGN });
    const response = await patch({ id: "a1", alt: "Foreign overwrite", expectedVersion: 0 });
    expect(response.status).toBe(403);
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.rows.get("a1").alt).toBe("Ugali and sukuma wiki");
  });
});

describe("the version the client read is the version that gets written", () => {
  it("saves when the token matches, increments the counter and hands the new version back", async () => {
    seed({ version: 4 });
    const response = await patch({ id: "a1", alt: "Ugali, sukuma wiki and grilled chicken", expectedVersion: 4 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.asset.alt).toBe("Ugali, sukuma wiki and grilled chicken");
    expect(body.asset.version).toBe(5);
    expect(mocks.rows.get("a1").version).toBe(5);
    expect(mocks.rows.get("a1").alt).toBe("Ugali, sukuma wiki and grilled chicken");
  });

  it("increments atomically in the write itself, not from a value it read", async () => {
    seed({ version: 4 });
    await patch({ id: "a1", alt: "Atomic", expectedVersion: 4 });
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0].data.version).toEqual({ increment: 1 });
  });

  it("scopes the conditional write to the tenant and the expected version", async () => {
    seed({ version: 2 });
    await patch({ id: "a1", alt: "Scoped write", expectedVersion: 2 });
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0].where).toEqual({ id: "a1", businessId: OWNED, version: 2 });
  });

  it("accepts a version sent as a numeric string, surrounding whitespace included", async () => {
    seed({ version: 3 });
    const response = await patch({ id: "a1", alt: "String token", expectedVersion: " 3 " });
    expect(response.status).toBe(200);
    expect(mocks.rows.get("a1").version).toBe(4);
  });

  it("lets a freshly created asset be edited at version 0", async () => {
    seed({ version: 0 });
    const response = await patch({ id: "a1", alt: "First edit", expectedVersion: 0 });
    expect(response.status).toBe(200);
    expect(mocks.rows.get("a1").version).toBe(1);
  });

  it("keeps the existing validation: an empty description clears the field", async () => {
    seed({ version: 0 });
    const response = await patch({ id: "a1", alt: "", expectedVersion: 0 });
    expect(response.status).toBe(200);
    expect(mocks.rows.get("a1").alt).toBeNull();
  });

  it("writes exactly one audit record, for the field names that changed", async () => {
    seed({ version: 0 });
    await patch({ id: "a1", alt: "Audited", expectedVersion: 0 });
    expect(mocks.audit).toHaveLength(1);
    expect(mocks.audit[0].action).toBe("MEDIA_UPDATED");
    expect(mocks.audit[0].metadata).toEqual({ businessId: OWNED, fields: ["alt"] });
  });
});

describe("a stale edit never overwrites a newer one", () => {
  it("refuses the second of two competing updates built from the same version", async () => {
    seed({ version: 0 });
    const first = await patch({ id: "a1", alt: "Written by the first window", expectedVersion: 0 });
    expect(first.status).toBe(200);

    const second = await patch({ id: "a1", alt: "Written by the second window", expectedVersion: 0 });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.code).toBe("media_version_conflict");

    expect(mocks.rows.get("a1").alt).toBe("Written by the first window");
    expect(mocks.rows.get("a1").version).toBe(1);
    expect(mocks.applied).toHaveLength(1);
  });

  it("rejects a stale request that arrives after several later updates", async () => {
    seed({ version: 0 });
    await patch({ id: "a1", alt: "Edit one", expectedVersion: 0 });
    await patch({ id: "a1", alt: "Edit two", expectedVersion: 1 });
    await patch({ id: "a1", alt: "Edit three", expectedVersion: 2 });

    const stale = await patch({ id: "a1", alt: "Stale overwrite", expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(mocks.rows.get("a1").alt).toBe("Edit three");
    expect(mocks.rows.get("a1").version).toBe(3);
  });

  it("separates two writes that land in the same millisecond", async () => {
    seed({ version: 0 });

    const first = await patch({ id: "a1", alt: "First writer", expectedVersion: 0 });
    expect(first.status).toBe(200);
    const afterFirst = mocks.rows.get("a1");

    const second = await patch({ id: "a1", alt: "Second writer", expectedVersion: 0 });
    expect(second.status).toBe(409);
    const afterSecond = mocks.rows.get("a1");

    // Both writes carry the identical timestamp — the case a TIMESTAMP(3) token cannot resolve.
    expect(afterFirst.updatedAt.getTime()).toBe(SAME_MS.getTime());
    expect(afterSecond.updatedAt.getTime()).toBe(SAME_MS.getTime());
    // The counter resolves it anyway.
    expect(afterFirst.version).toBe(1);
    expect(afterSecond.version).toBe(1);
    expect(afterSecond.alt).toBe("First writer");
  });

  it("refuses a write that loses the race between the check and the update", async () => {
    seed({ version: 0 });
    // The route reads version 0, then another writer stores version 1 before the conditional
    // update runs. The pre-check already passed, so only the conditional write can catch this.
    mocks.onRead = {
      at: mocks.reads + 1,
      after: (row) => {
        row.version = 1;
        row.alt = "Written by someone else";
      },
    };

    const response = await patch({ id: "a1", alt: "Built from a version that was already gone", expectedVersion: 0 });
    expect(response.status).toBe(409);
    expect(mocks.rows.get("a1").alt).toBe("Written by someone else");
    expect(mocks.rows.get("a1").version).toBe(1);
    expect(mocks.applied).toHaveLength(0);
  });

  it("never writes an audit record for a rejected stale update", async () => {
    seed({ version: 0 });
    await patch({ id: "a1", alt: "Edit one", expectedVersion: 0 });
    expect(mocks.audit).toHaveLength(1);

    // Fast-path rejection.
    expect((await patch({ id: "a1", alt: "Stale one", expectedVersion: 0 })).status).toBe(409);
    // Conditional-write rejection: the pre-check passes, then the row moves on before the write.
    mocks.onRead = { at: mocks.reads + 1, after: (row) => { row.version = 9; } };
    expect((await patch({ id: "a1", alt: "Stale two", expectedVersion: 1 })).status).toBe(409);

    expect(mocks.audit).toHaveLength(1);
    expect(mocks.rows.get("a1").alt).toBe("Edit one");
  });

  it("reports a conflict when the image disappears mid-edit instead of claiming success", async () => {
    seed({ version: 0 });
    // The PATCH lookup succeeds; the row is gone by the read-after-write.
    mocks.onRead = { at: mocks.reads + 2, before: () => { mocks.rows.delete("a1"); } };

    const response = await patch({ id: "a1", alt: "Written to a row that is gone", expectedVersion: 0 });
    expect(response.status).toBe(409);
    expect(mocks.audit).toHaveLength(0);
  });
});

describe("the rest of the PATCH contract is unchanged", () => {
  it("requires a signed-in owner", async () => {
    seed();
    mocks.session = null;
    expect((await patch({ id: "a1", alt: "No session", expectedVersion: 0 })).status).toBe(401);
  });

  it("still needs an id, an existing asset and something to change", async () => {
    seed();
    expect((await patch({ alt: "No id", expectedVersion: 0 })).status).toBe(400);
    expect((await patch({ id: "missing", alt: "No row", expectedVersion: 0 })).status).toBe(404);
    expect((await patch({ id: "a1", expectedVersion: 0 })).status).toBe(400);
    expect(mocks.applied).toHaveLength(0);
  });

  it("normalizes an unknown kind and label the way the library always has", async () => {
    seed({ version: 0 });
    const response = await patch({ id: "a1", kind: "not-a-kind", label: "ACTUAL", expectedVersion: 0 });
    expect(response.status).toBe(200);
    expect(mocks.rows.get("a1").kind).toBe("IMAGE");
    expect(mocks.rows.get("a1").label).toBe("ACTUAL");
  });
});
