/**
 * Undo, Redo and branch replacement — end to end through the real routes (§45)
 *
 * This is the behaviour that matters most: an owner edits, undoes, and edits again. The abandoned
 * branch must be discarded at the exact number the new edit takes, so history reads
 * 1 → 2 → NEW 3 (never 1 → 2 → 3 → NEW 3, and never a unique-key collision).
 *
 * Both routes run against one in-memory database, so the test exercises the real orchestration:
 * the experience PATCH write path records the revision, and the history route moves the draft.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const store = {
  experience: null as Row | null,
  revisions: [] as Row[],
  updates: [] as Row[],
  creates: [] as Row[],
};

function seed(document: Row) {
  store.experience = {
    id: "exp-a",
    businessId: "business-a",
    categoryKey: document.categoryKey,
    themeKey: document.themeKey,
    status: "DRAFT",
    draftJson: JSON.stringify(document),
    publishedJson: null,
    draftVersion: 1,
    historyCursor: 1,
    publishedVersion: 0,
  };
  store.revisions = [
    { id: "rev-1", businessId: "business-a", draftVersion: 1, label: "Created your website", source: "SYSTEM", createdAt: new Date(), snapshotJson: store.experience.draftJson },
  ];
}

const mocks = vi.hoisted(() => ({ session: { userId: "user-a", role: "OWNER" } as any }));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  assertBusinessOwnership: vi.fn(async () => {}),
  guardTenantMutation: vi.fn(async () => ({ ok: true, status: 200 })),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: {
      findUnique: vi.fn(async () => store.experience),
      update: vi.fn(async (args: any) => {
        const data = { ...(args.data ?? {}) };
        for (const key of Object.keys(data)) {
          const value = data[key];
          if (value && typeof value === "object" && "increment" in value) {
            data[key] = Number(store.experience?.[key] ?? 0) + Number(value.increment);
          }
        }
        store.updates.push(data);
        store.experience = { ...(store.experience ?? {}), ...data };
        return store.experience;
      }),
      create: vi.fn(async (args: any) => ({ id: "exp-a", ...args.data })),
    },
    business: { findUnique: vi.fn(async () => ({ id: "business-a", name: "Choma Place", description: null, location: null, phone: null, whatsapp: null, openingHours: null })) },
    experienceDraftRevision: {
      findMany: vi.fn(async (args: any) => {
        const descending = args?.orderBy?.draftVersion === "desc";
        const rows = [...store.revisions].sort((a, b) => (descending ? b.draftVersion - a.draftVersion : a.draftVersion - b.draftVersion));
        return typeof args?.skip === "number" ? rows.slice(args.skip) : rows;
      }),
      create: vi.fn(async (args: any) => {
        const row = { id: `rev-${args.data.draftVersion}`, createdAt: new Date(), ...args.data };
        store.creates.push(row);
        store.revisions.push(row);
        return row;
      }),
      deleteMany: vi.fn(async (args: any) => {
        const where = args?.where?.draftVersion ?? {};
        const ids: string[] | undefined = args?.where?.id?.in;
        const before = store.revisions.length;
        store.revisions = store.revisions.filter((row) => {
          const byVersion =
            (typeof where.gt === "number" && row.draftVersion > where.gt) ||
            (typeof where.gte === "number" && row.draftVersion >= where.gte);
          return !(byVersion || (ids ? ids.includes(row.id) : false));
        });
        return { count: before - store.revisions.length };
      }),
    },
  },
}));

import { PATCH } from "@/app/api/experience/route";
import { GET as historyGet, POST as historyPost } from "@/app/api/experience/history/route";

function documentFor(name: string, heroImageUrl = "") {
  return {
    version: 1,
    categoryKey: "food",
    themeKey: "food-grill",
    brand: { businessName: name, tagline: "", logoUrl: "", heroImageUrl, primaryColor: "#b45309", secondaryColor: "#78350f", accentColor: "#f59e0b", buttonStyle: "solid", fontPairing: "modern" },
    settings: { phone: "0722000000" },
    sections: [
      { id: "nav", type: "navigation", visible: true },
      { id: "hero", type: "hero", visible: true, title: "Welcome" },
    ],
  };
}

function edit(body: unknown) {
  return PATCH(
    new Request("https://jata.test/api/experience", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

function history(body: unknown) {
  return historyPost(
    new Request("https://jata.test/api/experience/history", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

function historyList() {
  return historyGet(new Request("https://jata.test/api/experience/history?businessId=business-a"));
}

beforeEach(() => {
  mocks.session = { userId: "user-a", role: "OWNER" };
  store.updates = [];
  store.creates = [];
  seed(documentFor("Choma Place"));
});

describe("a normal edit records a revision", () => {
  it("numbers it like the draft and stores the document that was actually saved", async () => {
    const response = await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Karibu" } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.experience.draftVersion).toBe(2);
    expect(data.canUndo).toBe(true);

    expect(store.creates).toHaveLength(1);
    expect(store.creates[0].draftVersion).toBe(2);
    expect(store.creates[0].source).toBe("EDIT");
    expect(store.creates[0].label).not.toContain("undefined");
    const snapshot = JSON.parse(store.creates[0].snapshotJson);
    expect(snapshot.sections.find((section: any) => section.id === "hero").title).toBe("Karibu");
    expect(store.experience?.historyCursor).toBe(2);
  });

  it("keeps numbering in step across several edits", async () => {
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "One" } });
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Two" } });
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Three" } });
    expect(store.revisions.map((row) => row.draftVersion)).toEqual([1, 2, 3, 4]);
    expect(store.experience?.draftVersion).toBe(4);
    const list = await (await historyList()).json();
    expect(list.revisions.map((entry: any) => entry.draftVersion)).toEqual([4, 3, 2, 1]);
  });
});

describe("undo and redo through the route", () => {
  it("undo restores the previous document without creating another revision", async () => {
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Karibu" } });
    const before = store.creates.length;

    const response = await history({ businessId: "business-a", direction: "undo" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draftVersion).toBe(1);
    expect(data.document.sections.find((section: any) => section.id === "hero").title).toBe("Welcome");
    expect(data.label).toBe("Created your website");

    // Undo moves the draft; it never writes history, so Redo can still find what it left behind.
    expect(store.creates).toHaveLength(before);
    expect(store.revisions.map((row) => row.draftVersion)).toEqual([1, 2]);
    expect(store.experience?.historyCursor).toBe(1);
  });

  it("redo returns to the newest revision", async () => {
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Karibu" } });
    await history({ businessId: "business-a", direction: "undo" });
    const response = await history({ businessId: "business-a", direction: "redo" });
    const data = await response.json();
    expect(data.draftVersion).toBe(2);
    expect(data.document.sections.find((section: any) => section.id === "hero").title).toBe("Karibu");
    expect(store.experience?.draftVersion).toBe(2);
  });
});

describe("branch replacement after an undo", () => {
  it("replaces the abandoned revision number instead of colliding with it", async () => {
    // 1 → 2 → 3
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Two" } });
    await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Three" } });
    expect(store.revisions.map((row) => row.draftVersion)).toEqual([1, 2, 3]);

    // undo to 2 …
    await history({ businessId: "business-a", direction: "undo" });
    expect(store.experience?.draftVersion).toBe(2);
    expect(store.revisions.map((row) => row.draftVersion)).toEqual([1, 2, 3]);

    // … then make a new edit
    const response = await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: "Brand new" } });
    expect(response.status).toBe(200);

    // 1 → 2 → NEW 3: the same numbers, the abandoned snapshot gone, no duplicate, no collision.
    expect(store.revisions.map((row) => row.draftVersion)).toEqual([1, 2, 3]);
    const third = store.revisions.find((row) => row.draftVersion === 3);
    expect(JSON.parse(third!.snapshotJson).sections.find((section: any) => section.id === "hero").title).toBe("Brand new");
    expect(store.experience?.draftVersion).toBe(3);
    expect(store.experience?.historyCursor).toBe(3);

    const list = await (await historyList()).json();
    expect(list.head).toBe(3);
    expect(list.canRedo).toBe(false);
    expect(list.revisions.map((entry: any) => entry.draftVersion)).toEqual([3, 2, 1]);
  });

  it("keeps every revision unique after several undo-then-edit cycles", async () => {
    for (const title of ["Two", "Three", "Four"]) {
      await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title } });
    }
    for (let round = 0; round < 3; round += 1) {
      await history({ businessId: "business-a", direction: "undo" });
      await history({ businessId: "business-a", direction: "undo" });
      await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: `Round ${round}` } });
    }
    const versions = store.revisions.map((row) => row.draftVersion);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions[versions.length - 1]).toBe(store.experience?.draftVersion);
    const newest = store.revisions[store.revisions.length - 1];
    expect(JSON.parse(newest.snapshotJson).sections.find((section: any) => section.id === "hero").title).toBe("Round 2");
  });
});

describe("retention", () => {
  it("keeps the newest revisions and drops the oldest once the limit is reached", async () => {
    for (let index = 0; index < 34; index += 1) {
      await edit({ businessId: "business-a", op: "update", sectionId: "hero", patch: { title: `Change ${index}` } });
    }
    expect(store.revisions.length).toBe(30);
    const versions = store.revisions.map((row) => row.draftVersion);
    expect(versions[0]).toBeGreaterThan(1);
    expect(versions[versions.length - 1]).toBe(store.experience?.draftVersion);
    // The oldest edits are the ones that go; the owner's newest work is never pruned.
    const newest = store.revisions[store.revisions.length - 1];
    expect(JSON.parse(newest.snapshotJson).sections.find((section: any) => section.id === "hero").title).toBe("Change 33");
  });
});
