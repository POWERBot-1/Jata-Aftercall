/**
 * Studio Undo / Redo / recovery (§45)
 *
 * The pure helpers decide where Undo and Redo go, so they are asserted directly: what an owner
 * sees when they press the button is exactly what these functions compute. The async helpers are
 * then driven against a fake database to prove that a revision is written once, pruned, and that
 * moving through history rewrites the draft — never the published site.
 */

import { describe, expect, it } from "vitest";
import {
  DRAFT_HISTORY_LIMIT,
  describeDraftChange,
  historyState,
  historyTarget,
  loadDraftHistory,
  moveDraftHistory,
  recordDraftRevision,
  revisionSummaries,
} from "@/lib/experience/history";

function documentFor(name: string, heroImageUrl = "") {
  return {
    version: 1,
    categoryKey: "food",
    themeKey: "food-grill",
    brand: { businessName: name, tagline: "", heroImageUrl },
    settings: { phone: "0722000000" },
    sections: [
      { id: "nav", type: "navigation", visible: true },
      { id: "hero", type: "hero", visible: true },
    ],
  } as any;
}

function revision(draftVersion: number, label: string, source = "EDIT") {
  return {
    id: `rev-${draftVersion}`,
    draftVersion,
    label,
    source,
    createdAt: new Date(2026, 9, draftVersion).toISOString(),
    snapshotJson: JSON.stringify(documentFor(`Name ${draftVersion}`)),
  };
}

function fakeDb(options: { experience?: any; revisions?: any[] } = {}) {
  const rows = [...(options.revisions ?? [])];
  const updates: any[] = [];
  const db = {
    businessExperience: {
      findUnique: async () => options.experience ?? null,
      update: async (args: any) => {
        updates.push(args);
        if (options.experience) Object.assign(options.experience, args.data);
        return { id: "exp-a", ...(args.data ?? {}) };
      },
    },
    experienceDraftRevision: {
      findMany: async (args: any) => {
        const descending = args?.orderBy?.draftVersion === "desc";
        const sorted = [...rows].sort((a, b) => (descending ? b.draftVersion - a.draftVersion : a.draftVersion - b.draftVersion));
        return typeof args?.skip === "number" ? sorted.slice(args.skip) : sorted;
      },
      create: async (args: any) => {
        rows.push({ id: `rev-${args.data.draftVersion}`, ...args.data });
        return args.data;
      },
      deleteMany: async (args: any) => {
        const where = args?.where?.draftVersion ?? {};
        const ids: string[] | undefined = args?.where?.id?.in;
        let before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          const byVersion =
            (typeof where.gt === "number" && row.draftVersion > where.gt) ||
            (typeof where.gte === "number" && row.draftVersion >= where.gte);
          const remove = byVersion || (ids ? ids.includes(row.id) : false);
          if (remove) rows.splice(index, 1);
        }
        return { count: before - rows.length };
      },
    },
  };
  return { db: db as any, rows, updates };
}

describe("historyState", () => {
  it("reports nothing to do when there is no history yet", () => {
    expect(historyState([], 0)).toEqual({ canUndo: false, canRedo: false, undoTo: null, redoTo: null, cursor: 0, head: 0, count: 0 });
  });

  it("treats an untracked cursor as the newest revision, so the first Undo works", () => {
    const revisions = [revision(1, "Created your website"), revision(2, "Edited the hero section")];
    const state = historyState(revisions, 0);
    expect(state.cursor).toBe(2);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);
    expect(state.undoTo).toBe(1);
  });

  it("moves both ways when the cursor sits in the middle", () => {
    const state = historyState([revision(1, "a"), revision(2, "b"), revision(3, "c")], 2);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(true);
    expect(state.undoTo).toBe(1);
    expect(state.redoTo).toBe(3);
    expect(state.head).toBe(3);
    expect(state.count).toBe(3);
  });

  it("never points Undo at a snapshot that does not exist", () => {
    const revisions = [revision(4, "four"), revision(5, "five")];
    expect(historyState(revisions, 99).cursor).toBe(5);
    // A draft older than everything recorded sits at the oldest known revision, so Redo can move
    // it forward and Undo honestly reports that it has nothing older to offer.
    const older = historyState(revisions, 1);
    expect(older.cursor).toBe(4);
    expect(older.canUndo).toBe(false);
    expect(older.canRedo).toBe(true);
  });

  it("stops at both ends", () => {
    const revisions = [revision(1, "one"), revision(2, "two")];
    expect(historyTarget(revisions, 1, "undo")).toBeNull();
    expect(historyTarget(revisions, 2, "redo")).toBeNull();
    expect(historyTarget(revisions, 2, "undo")).toBe(1);
    expect(historyTarget(revisions, 1, "redo")).toBe(2);
  });

  it("summarizes history newest first without leaking the document", () => {
    const summaries = revisionSummaries([revision(1, "Created"), revision(2, "Edited hero"), revision(3, "Swapped a photo", "AI")], 2);
    expect(summaries.map((entry) => entry.draftVersion)).toEqual([3, 2, 1]);
    expect(summaries.find((entry) => entry.draftVersion === 2)?.current).toBe(true);
    expect(summaries.find((entry) => entry.draftVersion === 3)?.source).toBe("AI");
    expect(JSON.stringify(summaries)).not.toContain("snapshotJson");
    expect(revisionSummaries([{ draftVersion: 1 }], 1, 1)[0].label).toBe("Version 1");
  });
});

describe("describeDraftChange", () => {
  it("reads like something an owner would say", () => {
    expect(describeDraftChange("add", { label: "Gallery" })).toBe("Added the Gallery section");
    expect(describeDraftChange("update", { label: "Hero" })).toBe("Edited the Hero section");
    expect(describeDraftChange("remove", { label: "FAQ" })).toBe("Removed the FAQ section");
    expect(describeDraftChange("studio-fix", { fixLabel: "Write a page title" })).toBe("JATA fixed: Write a page title");
    expect(describeDraftChange("brand")).toBe("Updated your brand");
    expect(describeDraftChange("settings")).toBe("Updated your contact and business details");
    expect(describeDraftChange("theme")).toBe("Changed your design");
    expect(describeDraftChange("ai", { label: "Added a testimonials section" })).toBe("Added a testimonials section");
    expect(describeDraftChange(null)).toBe("Saved a change to your website");
    expect(describeDraftChange("move")).toBe("Reordered sections");
  });
});

describe("recordDraftRevision", () => {
  it("writes one snapshot and prunes anything older than the limit", async () => {
    const { db, rows } = fakeDb({ revisions: Array.from({ length: DRAFT_HISTORY_LIMIT }, (_, index) => revision(index + 1, `v${index + 1}`)) });
    const saved = await recordDraftRevision(db, { businessId: "b", draftVersion: DRAFT_HISTORY_LIMIT + 1, document: documentFor("Newest") });
    expect(saved).toBe(true);
    expect(rows).toHaveLength(DRAFT_HISTORY_LIMIT);
    expect(rows.some((row) => row.draftVersion === 1)).toBe(false);
    expect(rows.some((row) => row.draftVersion === DRAFT_HISTORY_LIMIT + 1)).toBe(true);
  });

  it("discards the redo branch when a new edit follows an Undo", async () => {
    const { db, rows } = fakeDb({ revisions: [revision(1, "one"), revision(2, "two"), revision(3, "three")] });
    await recordDraftRevision(db, { businessId: "b", draftVersion: 3, document: documentFor("Replacement") });
    expect(rows.map((row) => row.draftVersion).sort()).toEqual([1, 2, 3]);
    expect(JSON.parse(rows[2].snapshotJson).brand.businessName).toBe("Replacement");
  });

  it("refuses an impossible version and never throws when history cannot be written", async () => {
    const { db } = fakeDb();
    expect(await recordDraftRevision(db, { businessId: "b", draftVersion: 0, document: documentFor("x") })).toBe(false);
    const broken = { ...db, experienceDraftRevision: { ...db.experienceDraftRevision, create: async () => { throw new Error("table missing"); } } };
    expect(await recordDraftRevision(broken, { businessId: "b", draftVersion: 2, document: documentFor("x") })).toBe(false);
  });

  it("keeps labels short and human", async () => {
    const { db, rows } = fakeDb();
    const long = "x".repeat(400);
    await recordDraftRevision(db, { businessId: "b", draftVersion: 1, document: documentFor("x"), label: long });
    expect(rows[0].label.length).toBeLessThanOrEqual(160);
    await recordDraftRevision(db, { businessId: "b", draftVersion: 2, document: documentFor("x") });
    expect(rows[1].label).toBe("Saved a change to your website");
  });
});

describe("moveDraftHistory", () => {
  it("undo rewrites the draft, moves the cursor and leaves publishing alone", async () => {
    const experience = { id: "exp", draftVersion: 3, historyCursor: 3, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 3")) };
    const { db, updates } = fakeDb({ experience, revisions: [revision(1, "Created your website"), revision(2, "Edited the hero section"), revision(3, "Swapped a photo")] });

    const result = await moveDraftHistory(db, { businessId: "b", direction: "undo" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draftVersion).toBe(2);
    expect(result.label).toBe("Edited the hero section");
    expect(result.document.brand.businessName).toBe("Name 2");
    expect(result.message).toContain("Undone");
    expect(updates[0].data.historyCursor).toBe(2);
    expect(updates[0].data.publishedJson).toBeUndefined();
    expect(updates[0].data.status).toBeUndefined();
  });

  it("redo moves forward again after an undo", async () => {
    const experience = { id: "exp", draftVersion: 2, historyCursor: 2, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 2")) };
    const { db } = fakeDb({ experience, revisions: [revision(1, "one"), revision(2, "two"), revision(3, "three")] });
    const result = await moveDraftHistory(db, { businessId: "b", direction: "redo" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draftVersion).toBe(3);
    expect(result.message).toContain("Redone");
  });

  it("stops honestly at the ends instead of pretending", async () => {
    const experience = { id: "exp", draftVersion: 1, historyCursor: 1, categoryKey: "food", draftJson: "{}" };
    const { db } = fakeDb({ experience, revisions: [revision(1, "one")] });
    const undo = await moveDraftHistory(db, { businessId: "b", direction: "undo" });
    expect(undo.status).toBe("unavailable");
    if (undo.status === "unavailable") expect(undo.reason).toContain("first saved change");

    const redo = await moveDraftHistory(db, { businessId: "b", direction: "redo" });
    expect(redo.status).toBe("unavailable");
    if (redo.status === "unavailable") expect(redo.reason).toContain("newest change");
  });

  it("says so when there is nothing recorded yet, and when the site does not exist", async () => {
    const empty = await moveDraftHistory(fakeDb({ experience: { id: "exp", draftVersion: 1, historyCursor: 1, categoryKey: "food", draftJson: "{}" } }).db, {
      businessId: "b",
      direction: "undo",
    });
    expect(empty.status).toBe("unavailable");
    if (empty.status === "unavailable") expect(empty.reason).toContain("nothing to undo yet");

    const missing = await moveDraftHistory(fakeDb().db, { businessId: "b", direction: "undo" });
    expect(missing.status).toBe("missing");
    if (missing.status === "missing") expect(missing.reason).toContain("Create your website");
  });

  it("restores one chosen revision and explains where it went", async () => {
    const experience = { id: "exp", draftVersion: 5, historyCursor: 5, categoryKey: "food", draftJson: JSON.stringify(documentFor("Name 5")) };
    const { db } = fakeDb({ experience, revisions: [revision(1, "Created your website"), revision(5, "Edited the menu")] });
    const result = await moveDraftHistory(db, { businessId: "b", version: 1 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draftVersion).toBe(1);
    expect(result.message).toContain("Created your website");
    expect(result.message).toContain("publish");

    const unknown = await moveDraftHistory(db, { businessId: "b", version: 42 });
    expect(unknown.status).toBe("unavailable");
  });

  it("returns an empty history instead of failing when the table is unreachable", async () => {
    const broken = { experienceDraftRevision: { findMany: async () => { throw new Error("no table"); } } } as any;
    expect(await loadDraftHistory(broken, "b")).toEqual([]);
    expect(await recordDraftRevision({ ...broken, businessExperience: { findUnique: async () => null, update: async () => ({}) } }, {
      businessId: "b",
      draftVersion: 1,
      document: documentFor("x"),
    })).toBe(false);
  });
});
