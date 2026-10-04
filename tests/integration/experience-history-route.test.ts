/**
 * Draft history API (§45)
 *
 * Undo, Redo and recovery driven through the real route: what an owner's tap sends, what comes
 * back, and — just as important — what never happens. History is tenant-scoped, it rewrites the
 * draft only, and every response is a plain-language sentence rather than a database log.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  guard: { ok: true, status: 200, error: undefined } as any,
  experience: null as any,
  rows: [] as any[],
  updates: [] as any[],
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  assertBusinessOwnership: vi.fn(async () => {}),
  guardTenantMutation: vi.fn(async () => mocks.guard),
}));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: {
      findUnique: vi.fn(async () => mocks.experience),
      update: vi.fn(async (args: any) => {
        mocks.updates.push(args);
        if (mocks.experience) Object.assign(mocks.experience, args.data);
        return { id: "exp-a", ...(args.data ?? {}) };
      }),
    },
    experienceDraftRevision: {
      findMany: vi.fn(async (args: any) => {
        const descending = args?.orderBy?.draftVersion === "desc";
        const sorted = [...mocks.rows].sort((a, b) => (descending ? b.draftVersion - a.draftVersion : a.draftVersion - b.draftVersion));
        return typeof args?.skip === "number" ? sorted.slice(args.skip) : sorted;
      }),
      create: vi.fn(async (args: any) => {
        mocks.rows.push({ id: `rev-${args.data.draftVersion}`, createdAt: new Date(), ...args.data });
        return args.data;
      }),
      deleteMany: vi.fn(async (args: any) => {
        const where = args?.where?.draftVersion ?? {};
        const ids: string[] | undefined = args?.where?.id?.in;
        const before = mocks.rows.length;
        mocks.rows = mocks.rows.filter((row) => {
          const byVersion =
            (typeof where.gt === "number" && row.draftVersion > where.gt) ||
            (typeof where.gte === "number" && row.draftVersion >= where.gte);
          return !(byVersion || (ids ? ids.includes(row.id) : false));
        });
        return { count: before - mocks.rows.length };
      }),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { GET, POST } from "@/app/api/experience/history/route";

function documentFor(name: string) {
  return {
    version: 1,
    categoryKey: "food",
    themeKey: "food-grill",
    brand: { businessName: name, tagline: "", heroImageUrl: "" },
    settings: { phone: "0722000000" },
    sections: [
      { id: "nav", type: "navigation", visible: true },
      { id: "hero", type: "hero", visible: true },
    ],
  };
}

function row(draftVersion: number, label: string, source = "EDIT", document = documentFor(`Name ${draftVersion}`)) {
  return { id: `rev-${draftVersion}`, draftVersion, label, source, createdAt: new Date(), snapshotJson: JSON.stringify(document) };
}

function post(body: unknown) {
  return POST(
    new Request("https://jata.test/api/experience/history", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

function get(businessId = "business-a") {
  return GET(new Request(`https://jata.test/api/experience/history?businessId=${businessId}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.guard = { ok: true, status: 200, error: undefined };
  mocks.experience = { id: "exp-a", draftVersion: 3, historyCursor: 3, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 3")) };
  mocks.rows = [row(1, "Created your website", "SYSTEM"), row(2, "Edited the Hero section"), row(3, "Swapped a photo", "AI")];
  mocks.updates = [];
});

describe("GET /api/experience/history", () => {
  it("requires a session and a business the owner may read", async () => {
    mocks.session = null;
    expect((await get()).status).toBe(401);
    mocks.session = { userId: "user-a" };
    mocks.guard = { ok: false, status: 403, error: "You do not have access to this business." };
    const refused = await get();
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain("access");
  });

  it("returns what Undo and Redo can do, newest first, without leaking snapshots", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.canUndo).toBe(true);
    expect(data.canRedo).toBe(false);
    expect(data.cursor).toBe(3);
    expect(data.head).toBe(3);
    expect(data.revisions.map((entry: any) => entry.draftVersion)).toEqual([3, 2, 1]);
    expect(data.revisions[0].source).toBe("AI");
    expect(data.revisions.find((entry: any) => entry.draftVersion === 3).current).toBe(true);
    expect(JSON.stringify(data)).not.toContain("snapshotJson");
    expect(JSON.stringify(data)).not.toContain("Name 1");
  });

  it("is honest when there is no history yet", async () => {
    mocks.rows = [];
    const data = await (await get()).json();
    expect(data).toMatchObject({ canUndo: false, canRedo: false, cursor: 0, head: 0, count: 0, revisions: [] });
  });
});

describe("POST /api/experience/history", () => {
  it("rejects an empty request instead of guessing what the owner meant", async () => {
    const response = await post({ businessId: "business-a" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Undo");
  });

  it("undo puts the previous version back into the draft and says so plainly", async () => {
    const response = await post({ businessId: "business-a", direction: "undo" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draftVersion).toBe(2);
    expect(data.label).toBe("Edited the Hero section");
    expect(data.document.brand.businessName).toBe("Name 2");
    expect(data.message).toContain("Undone");
    expect(data.canRedo).toBe(true);
    expect(data.canUndo).toBe(true);
    expect(mocks.updates[0].data).toMatchObject({ draftVersion: 2, historyCursor: 2, themeKey: "food-grill" });
    expect(mocks.updates[0].data.publishedJson).toBeUndefined();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "EXPERIENCE_DRAFT_UNDO" }));
  });

  it("redo walks forward again without inventing a version", async () => {
    mocks.experience = { id: "exp-a", draftVersion: 2, historyCursor: 2, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 2")) };
    const response = await post({ businessId: "business-a", direction: "redo" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draftVersion).toBe(3);
    expect(data.document.brand.businessName).toBe("Name 3");
    expect(data.message).toContain("Redone");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "EXPERIENCE_DRAFT_REDO" }));
  });

  it("stops at the beginning and at the end with a real explanation", async () => {
    mocks.experience = { id: "exp-a", draftVersion: 1, historyCursor: 1, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 1")) };
    mocks.rows = [row(1, "Created your website", "SYSTEM")];
    const old = await post({ businessId: "business-a", direction: "undo" });
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ unchanged: true });
    expect((await (await post({ businessId: "business-a", direction: "redo" })).json()).error).toContain("newest change");
  });

  it("goes straight back to a chosen version and reminds the owner to publish", async () => {
    const response = await post({ businessId: "business-a", version: 1 });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draftVersion).toBe(1);
    expect(data.document.brand.businessName).toBe("Name 1");
    expect(data.message).toContain("Created your website");
    expect(data.message).toContain("publish");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "EXPERIENCE_DRAFT_VERSION_OPENED" }));
  });

  it("refuses a version that does not exist", async () => {
    const response = await post({ businessId: "business-a", version: 77 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("no longer available");
  });

  it("cannot be used against another tenant's business", async () => {
    mocks.guard = { ok: false, status: 403, error: "You do not have access to this business." };
    const response = await post({ businessId: "business-b", direction: "undo" });
    expect(response.status).toBe(403);
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mocks.session = null;
    expect((await post({ businessId: "business-a", direction: "undo" })).status).toBe(401);
  });

  it("opens a snapshot written by an older version of the platform safely", async () => {
    mocks.experience = { id: "exp-a", draftVersion: 9, historyCursor: 9, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 9")) };
    mocks.rows = [
      { id: "rev-2", draftVersion: 2, label: "Old draft", source: "EDIT", createdAt: new Date(), snapshotJson: JSON.stringify({ categoryKey: "food" }) },
    ];
    const response = await post({ businessId: "business-a", direction: "undo" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draftVersion).toBe(2);
    expect(Array.isArray(data.document.sections)).toBe(true);
    expect(data.document.sections.length).toBeGreaterThan(0);
  });
});
