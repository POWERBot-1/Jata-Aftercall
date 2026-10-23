/**
 * Media mutations must use the tenant's configuration permission, not the default read gate.
 * VIEWER membership intentionally has read access, so these route-level regressions prove that
 * upload, metadata changes and deletion fail closed before any side effect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as any,
  owners: {} as Record<string, string>,
  memberships: [] as Array<{ userId: string; businessId: string; role: string }>,
  assets: [] as any[],
  created: [] as any[],
  updated: [] as any[],
  deleted: [] as string[],
  deletedMany: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findMany: vi.fn(async ({ where }: any) =>
        Object.entries(state.owners)
          .filter(([, ownerId]) => ownerId === where?.ownerId)
          .map(([id]) => ({ id })),
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        state.owners[where?.id] === where?.ownerId ? { id: where.id } : null,
      ),
      findUnique: vi.fn(async ({ where }: any) =>
        state.owners[where?.id] ? { id: where.id, ownerId: state.owners[where.id] } : null,
      ),
    },
    businessMember: {
      findMany: vi.fn(async ({ where, select }: any) => {
        const rows = state.memberships.filter((membership) => membership.userId === where?.userId);
        return select?.role
          ? rows.map(({ businessId, role }) => ({ businessId, role }))
          : rows.map(({ businessId }) => ({ businessId }));
      }),
    },
    mediaAsset: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }: any) => state.assets.filter((asset) =>
        (!where?.businessId || asset.businessId === where.businessId) &&
        (!where?.aiGenerationId || asset.aiGenerationId === where.aiGenerationId),
      )),
      findUnique: vi.fn(async ({ where }: any) => state.assets.find((asset) => asset.id === where?.id) ?? null),
      groupBy: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => {
        const asset = { id: `created-${state.created.length + 1}`, createdAt: new Date(), ...data };
        state.created.push(asset);
        return asset;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        state.updated.push({ where, data });
        return { ...state.assets.find((asset) => asset.id === where.id), ...data };
      }),
      delete: vi.fn(async ({ where }: any) => {
        state.deleted.push(where.id);
        return { id: where.id };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        state.deletedMany.push(where);
        return { count: 1 };
      }),
    },
  },
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/media/route";
import { guardTenantMutation } from "@/lib/tenant";
import { dataUrlFor, jpegBytes } from "../helpers/imageFixtures";

const image = dataUrlFor(jpegBytes({ width: 16, height: 16 }), "image/jpeg");

function jsonRequest(method: string, body: unknown) {
  return new Request("https://jata.test/api/media", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function signIn(userId: string) {
  state.session = { userId, email: `${userId}@example.test`, role: "CUSTOMER" };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = null;
  state.owners = { "biz-a": "owner-a" };
  state.memberships = [
    { userId: "viewer-a", businessId: "biz-a", role: "VIEWER" },
    { userId: "manager-a", businessId: "biz-a", role: "MANAGER" },
  ];
  state.assets = [{
    id: "asset-a",
    businessId: "biz-a",
    url: image,
    kind: "IMAGE",
    alt: "Old description",
    width: 16,
    height: 16,
    bytes: 128,
    mime: "image/jpeg",
    source: "UPLOAD",
    label: null,
    aiGenerationId: "generation-a",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }];
  state.created = [];
  state.updated = [];
  state.deleted = [];
  state.deletedMany = [];
});

describe("VIEWER media permissions", () => {
  beforeEach(() => signIn("viewer-a"));

  it("preserves read-only access to the member's media library", async () => {
    const response = await GET(new Request("https://jata.test/api/media?businessId=biz-a"));

    expect(response.status).toBe(200);
    expect((await response.json()).assets).toHaveLength(1);
    await expect(guardTenantMutation(state.session, "biz-a", "read")).resolves.toEqual({ ok: true });
  });

  it("denies uploads before storing data or logging a write", async () => {
    const response = await POST(jsonRequest("POST", { businessId: "biz-a", dataUrl: image, alt: "New image" }));

    expect(response.status).toBe(403);
    expect(state.created).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });

  it("denies metadata changes before updating the asset", async () => {
    const response = await PATCH(jsonRequest("PATCH", { id: "asset-a", alt: "Changed by viewer" }));

    expect(response.status).toBe(403);
    expect(state.updated).toHaveLength(0);
  });

  it("denies deleting a single asset before deleting it", async () => {
    const response = await DELETE(new Request("https://jata.test/api/media?id=asset-a", { method: "DELETE" }));

    expect(response.status).toBe(403);
    expect(state.deleted).toHaveLength(0);
  });

  it("denies deleting a generation before deleting any of its assets", async () => {
    const response = await DELETE(new Request("https://jata.test/api/media?businessId=biz-a&generationId=generation-a", { method: "DELETE" }));

    expect(response.status).toBe(403);
    expect(state.deletedMany).toHaveLength(0);
  });
});

describe("MANAGER media permissions", () => {
  it("allows a manager to register a local-path image reference using the configure permission", async () => {
    signIn("manager-a");

    await expect(guardTenantMutation(state.session, "biz-a", "configure")).resolves.toEqual({ ok: true });
    const response = await POST(jsonRequest("POST", { businessId: "biz-a", url: "/images/manager-reference.jpg", alt: "Manager reference" }));

    expect(response.status).toBe(201);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ businessId: "biz-a", url: "/images/manager-reference.jpg", bytes: null, mime: null });
  });

  it("authorizes a manager but refuses new inline image bytes before any persistence", async () => {
    signIn("manager-a");

    const response = await POST(jsonRequest("POST", { businessId: "biz-a", dataUrl: image, alt: "Manager upload" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "inline_media_persistence_disabled" });
    expect(state.created).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });
});
