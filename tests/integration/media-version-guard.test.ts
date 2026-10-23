/**
 * Media metadata PATCH uses a tenant-scoped compare-and-swap on MediaAsset.version.
 * This suite proves both the stale-read fast path and the write-time race guard without relying
 * on sleeps or clock precision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNED = "business-a";
const FOREIGN = "business-b";
const SAME_MS = new Date("2026-10-17T06:46:05.123Z");

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", email: "owner@example.test", role: "CUSTOMER" } as any,
  rows: new Map<string, any>(),
  applied: [] as any[],
  audit: [] as any[],
  reads: 0,
  onRead: null as null | { at: number; before?: () => void; after?: (row: any) => void },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error { status = 403; },
  assertBusinessOwnership: vi.fn(async () => undefined),
  guardTenantMutation: vi.fn(async (_session: unknown, businessId?: string | null, action?: string) => {
    if (!businessId) return { ok: false as const, status: 400 as const, error: "Choose a business before saving." };
    if (action !== "configure" || businessId !== OWNED) {
      return { ok: false as const, status: 403 as const, error: "You don't have access to that business." };
    }
    return { ok: true as const };
  }),
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (event: any) => { mocks.audit.push(event); }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    mediaAsset: {
      findUnique: vi.fn(async ({ where }: any) => {
        mocks.reads += 1;
        const plan = mocks.onRead?.at === mocks.reads ? mocks.onRead : null;
        if (plan) mocks.onRead = null;
        plan?.before?.();
        const row = mocks.rows.get(where.id);
        if (!row) return null;
        const snapshot = { ...row };
        plan?.after?.(row);
        return snapshot;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = mocks.rows.get(where.id);
        if (!row || row.businessId !== where.businessId || Number(row.version) !== Number(where.version)) {
          return { count: 0 };
        }
        const next = { ...row };
        for (const [key, value] of Object.entries(data)) {
          (next as any)[key] = value && typeof value === "object" && "increment" in (value as Record<string, unknown>)
            ? Number((next as any)[key] ?? 0) + Number((value as { increment: number }).increment)
            : value;
        }
        // Deliberately keep timestamp precision constant: only the counter may decide the race.
        (next as any).updatedAt = SAME_MS;
        mocks.rows.set(where.id, next);
        mocks.applied.push({ where, data });
        return { count: 1 };
      }),
    },
  },
}));

import { PATCH } from "@/app/api/media/route";
import { guardTenantMutation } from "@/lib/tenant";

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("https://jata.test/api/media", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
}

function seed(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "asset-a",
    businessId: OWNED,
    url: "https://cdn.jata.test/menu.jpg",
    kind: "IMAGE",
    alt: "Pilau with kachumbari",
    width: 1200,
    height: 900,
    bytes: 2048,
    mime: "image/jpeg",
    source: "UPLOAD",
    label: "ACTUAL",
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
  vi.clearAllMocks();
  mocks.session = { userId: "owner-a", email: "owner@example.test", role: "CUSTOMER" };
  mocks.rows.clear();
  mocks.applied = [];
  mocks.audit = [];
  mocks.reads = 0;
  mocks.onRead = null;
});

describe("media metadata version preconditions", () => {
  it("preserves compatibility for pre-version clients while protecting the write-time race", async () => {
    seed();
    const response = await patch({ id: "asset-a", alt: "New description" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.asset.alt).toBe("New description");
    expect(body.asset.version).toBe(1);
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0].where).toEqual({ id: "asset-a", businessId: OWNED, version: 0 });
  });

  it.each([
    ["blank", ""],
    ["timestamp", "2026-10-17T06:46:05.123Z"],
    ["fraction", 1.5],
    ["negative", -1],
    ["overflow", 2_147_483_648],
    ["boolean", true],
    ["object", {}],
  ])("rejects a %s token instead of guessing", async (_label, expectedVersion) => {
    seed();
    const response = await patch({ id: "asset-a", alt: "No write", expectedVersion });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("media_version_invalid");
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.audit).toHaveLength(0);
  });

  it("checks authorization before revealing whether a version token is required", async () => {
    seed({ businessId: FOREIGN });
    const response = await patch({ id: "asset-a", alt: "Foreign edit" });

    expect(response.status).toBe(403);
    expect(guardTenantMutation).toHaveBeenCalledWith(mocks.session, FOREIGN, "configure");
    expect(mocks.applied).toHaveLength(0);
  });

  it("keeps not-found and empty-update responses without writes", async () => {
    seed();
    expect((await patch({ id: "missing", alt: "No asset", expectedVersion: 0 })).status).toBe(404);
    expect((await patch({ id: "asset-a", expectedVersion: 0 })).status).toBe(400);
    expect(mocks.applied).toHaveLength(0);
  });
});

describe("atomic compare-and-swap behavior", () => {
  it("saves a matching version, increments it in the write, and returns the new version", async () => {
    seed({ version: 4 });
    const response = await patch({ id: "asset-a", alt: "Pilau, greens and kachumbari", expectedVersion: 4 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.asset.alt).toBe("Pilau, greens and kachumbari");
    expect(body.asset.version).toBe(5);
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0].where).toEqual({ id: "asset-a", businessId: OWNED, version: 4 });
    expect(mocks.applied[0].data.version).toEqual({ increment: 1 });
    expect(mocks.audit).toHaveLength(1);
  });

  it("accepts a numeric-string version while refusing a stale snapshot", async () => {
    seed({ version: 3 });
    const fresh = await patch({ id: "asset-a", alt: "Fresh text", expectedVersion: " 3 " });
    expect(fresh.status).toBe(200);
    expect(mocks.rows.get("asset-a").version).toBe(4);

    const stale = await patch({ id: "asset-a", alt: "Stale overwrite", expectedVersion: 3 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("media_version_conflict");
    expect(mocks.rows.get("asset-a").alt).toBe("Fresh text");
    expect(mocks.rows.get("asset-a").version).toBe(4);
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.audit).toHaveLength(1);
  });

  it("catches a writer that wins between the read and the conditional update", async () => {
    seed({ version: 0 });
    mocks.onRead = {
      at: mocks.reads + 1,
      after: (row) => {
        row.version = 1;
        row.alt = "Committed by the other window";
      },
    };

    const response = await patch({ id: "asset-a", alt: "Stale writer", expectedVersion: 0 });

    expect(response.status).toBe(409);
    expect(mocks.rows.get("asset-a").alt).toBe("Committed by the other window");
    expect(mocks.rows.get("asset-a").version).toBe(1);
    expect(mocks.applied).toHaveLength(0);
    expect(mocks.audit).toHaveLength(0);
  });

  it("separates two same-millisecond writes with the monotonic counter", async () => {
    seed({ version: 0 });
    const first = await patch({ id: "asset-a", alt: "First writer", expectedVersion: 0 });
    const second = await patch({ id: "asset-a", alt: "Second writer", expectedVersion: 0 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(mocks.rows.get("asset-a").updatedAt.getTime()).toBe(SAME_MS.getTime());
    expect(mocks.rows.get("asset-a").version).toBe(1);
    expect(mocks.rows.get("asset-a").alt).toBe("First writer");
    expect(mocks.applied).toHaveLength(1);
  });

  it("reports a conflict if the row disappears before the post-write read", async () => {
    seed({ version: 0 });
    mocks.onRead = { at: mocks.reads + 2, before: () => { mocks.rows.delete("asset-a"); } };

    const response = await patch({ id: "asset-a", alt: "Edited while deleted", expectedVersion: 0 });

    expect(response.status).toBe(409);
    expect(mocks.audit).toHaveLength(0);
  });
});
