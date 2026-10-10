/**
 * Draft history — Undo, Redo and recovery (§15, §45)
 *
 * Every Studio change reaches the database through one write path, and that path records the
 * document it produced here. Undo and Redo are therefore one mechanism that already works for
 * sections, design, photos, catalogue edits and AI content alike — not a separate feature per
 * screen — and nothing an owner does is ever unrecoverable.
 *
 * The model is deliberately simple and bounded:
 *   • one revision per owner-visible change, numbered exactly like `draftVersion`;
 *   • a cursor recording which revision the draft currently equals;
 *   • a brand-new edit made after an Undo discards the redo branch (editor behaviour, §45);
 *   • at most `DRAFT_HISTORY_LIMIT` revisions per business, so storage stays predictable (§51).
 *
 * Pure helpers carry the logic so Undo and Redo can be reasoned about — and tested — without a
 * database; the async helpers only read rows, delegate to those helpers, and write the result.
 */

import type { ExperienceDocument } from "./types";
import { normalizeExperienceDocument } from "./document";

/** How many revisions one business keeps. Older ones are pruned after every new revision. */
export const DRAFT_HISTORY_LIMIT = 30;

export type DraftRevisionSource = "EDIT" | "AI" | "RESTORE" | "SYSTEM";

export type DraftRevisionRow = {
  draftVersion: number;
  label?: string | null;
  source?: string | null;
  createdAt?: string | Date | null;
};

export type DraftRevisionSummary = {
  draftVersion: number;
  label: string;
  source: string;
  createdAt: string | null;
  current: boolean;
};

export type DraftHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoTo: number | null;
  redoTo: number | null;
  /** The revision the draft currently equals (0 when there is no history yet). */
  cursor: number;
  /** The newest recorded revision (0 when there is no history yet). */
  head: number;
  count: number;
};

function ordered(revisions: DraftRevisionRow[]): number[] {
  return revisions
    .map((revision) => revision.draftVersion)
    .filter((version) => Number.isSafeInteger(version) && version > 0)
    .sort((a, b) => a - b);
}

/**
 * Where the draft sits in its own history.
 *
 * `historyCursor` is 0 for every site created before this feature existed and for a brand-new
 * site, and is then treated as the newest revision: an owner who has never pressed Undo is
 * always "at the end", which is what makes the very first Undo work as they expect.
 */
export function historyState(revisions: DraftRevisionRow[], cursorVersion: number): DraftHistoryState {
  const list = ordered(revisions);
  if (!list.length) {
    return { canUndo: false, canRedo: false, undoTo: null, redoTo: null, cursor: 0, head: 0, count: 0 };
  }
  const head = list[list.length - 1];
  const cursor = resolveCursor(list, cursorVersion, head);
  // The draft is newer than anything recorded (history was pruned, or a legacy row was never
  // re-saved). There is still a real snapshot to go back to, so Undo points at the newest one
  // rather than pretending the owner has nothing to recover.
  if (cursorVersion > head) {
    return { canUndo: true, canRedo: false, undoTo: head, redoTo: null, cursor: head, head, count: list.length };
  }
  const index = list.indexOf(cursor);
  return {
    canUndo: index > 0,
    canRedo: index >= 0 && index < list.length - 1,
    undoTo: index > 0 ? list[index - 1] : null,
    redoTo: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    cursor,
    head,
    count: list.length,
  };
}

function resolveCursor(list: number[], cursorVersion: number, head: number): number {
  if (cursorVersion > 0 && list.includes(cursorVersion)) return cursorVersion;
  if (cursorVersion > 0 && cursorVersion < list[0]) {
    // The draft is older than anything recorded (a legacy row, or history that was pruned). The
    // oldest known revision is the honest cursor: Undo says "nothing older to go back to", and
    // Redo can still move the owner forward to a state JATA does have.
    return list[0];
  }
  // Nearest revision at or below the recorded draft number, otherwise the newest one: a draft
  // edited before its history was recorded still points at a real snapshot, never an imaginary
  // one, and Undo is never a no-op that silently does nothing.
  const below = list.filter((version) => version <= cursorVersion);
  return below.length ? below[below.length - 1] : head;
}

/** The revision one step back or forward. `null` means "there is nowhere to go". */
export function historyTarget(
  revisions: DraftRevisionRow[],
  cursorVersion: number,
  direction: "undo" | "redo",
): number | null {
  const state = historyState(revisions, cursorVersion);
  return direction === "undo" ? state.undoTo : state.redoTo;
}

/** Newest first, for display. Never includes the document itself — only its label. */
export function revisionSummaries(
  revisions: DraftRevisionRow[],
  cursorVersion: number,
  limit = 12,
): DraftRevisionSummary[] {
  const state = historyState(revisions, cursorVersion);
  return revisions
    .slice()
    .sort((a, b) => b.draftVersion - a.draftVersion)
    .slice(0, limit)
    .map((revision) => ({
      draftVersion: revision.draftVersion,
      label: revision.label || `Version ${revision.draftVersion}`,
      source: revision.source || "EDIT",
      createdAt: revision.createdAt ? new Date(revision.createdAt).toISOString() : null,
      current: revision.draftVersion === state.cursor,
    }));
}

/**
 * Plain-language names for the things owners actually do, so history reads like a sentence and
 * not like a database log. Unknown operations still get an honest, non-technical label.
 */
export function describeDraftChange(op: string | null, detail?: { type?: string; label?: string; fixLabel?: string }): string {
  switch (op) {
    case "add":
      return detail?.label ? `Added the ${detail.label} section` : "Added a section";
    case "remove":
      return detail?.label ? `Removed the ${detail.label} section` : "Removed a section";
    case "move":
      return detail?.label ? `Moved the ${detail.label} section` : "Reordered sections";
    case "duplicate":
      return detail?.label ? `Duplicated the ${detail.label} section` : "Duplicated a section";
    case "toggle":
      return detail?.label ? `Showed or hid the ${detail.label} section` : "Showed or hid a section";
    case "update":
      return detail?.label ? `Edited the ${detail.label} section` : "Edited a section";
    case "studio-fix":
      return detail?.fixLabel ? `JATA fixed: ${detail.fixLabel}` : "JATA applied a fix";
    case "brand":
      return "Updated your brand";
    case "settings":
      return "Updated your contact and business details";
    case "theme":
      return "Changed your design";
    case "ai":
      return detail?.label || "JATA edited your content";
    default:
      return detail?.label || "Saved a change to your website";
  }
}

export type HistoryMoveResult =
  | { status: "ok"; document: ExperienceDocument; draftVersion: number; label: string; source: string; message: string }
  | { status: "missing"; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "conflict"; reason: string };

export const HISTORY_CONFLICT_REASON =
  "Your website changed in another window, so nothing was undone or restored. Reload to see the latest draft, then try again.";

type HistoryClient = {
  businessExperience: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  experienceDraftRevision: {
    findMany: (args: any) => Promise<any[]>;
    findFirst?: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
  };
};

/** Newest first is never needed for logic, so history is always loaded oldest → newest. */
export async function loadDraftHistory(db: HistoryClient, businessId: string, limit = DRAFT_HISTORY_LIMIT) {
  try {
    const rows = await db.experienceDraftRevision.findMany({
      where: { businessId },
      orderBy: { draftVersion: "asc" },
      take: limit,
      select: { draftVersion: true, label: true, source: true, createdAt: true, snapshotJson: true },
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    // History is a convenience, never a hard dependency: if the table is unreachable the Studio
    // still edits and publishes exactly as before.
    return [];
  }
}

/**
 * Record the document a change produced.
 *
 * Called after every successful write. Pruning keeps the newest `DRAFT_HISTORY_LIMIT` revisions,
 * and a new edit made after an Undo discards the revisions that are now ahead of it, so Redo can
 * never resurrect a branch the owner abandoned.
 */
export async function recordDraftRevision(
  db: HistoryClient,
  params: {
    businessId: string;
    draftVersion: number;
    document: ExperienceDocument;
    label?: string;
    source?: DraftRevisionSource;
    createdById?: string | null;
  },
): Promise<boolean> {
  const { businessId, draftVersion } = params;
  if (!Number.isSafeInteger(draftVersion) || draftVersion < 1) return false;
  try {
    // `gte` (not `gt`): a new edit made after an Undo takes the number the abandoned branch was
    // using, so that stale revision is replaced rather than left to collide with the unique key.
    await db.experienceDraftRevision.deleteMany({ where: { businessId, draftVersion: { gte: draftVersion } } });
    await db.experienceDraftRevision.create({
      data: {
        businessId,
        draftVersion,
        label: (params.label || "Saved a change to your website").slice(0, 160),
        source: params.source || "EDIT",
        snapshotJson: JSON.stringify(params.document),
        createdById: params.createdById || null,
      },
    });
    const stale = await db.experienceDraftRevision.findMany({
      where: { businessId },
      orderBy: { draftVersion: "desc" },
      skip: DRAFT_HISTORY_LIMIT,
      select: { id: true },
    });
    if (Array.isArray(stale) && stale.length) {
      await db.experienceDraftRevision.deleteMany({ where: { id: { in: stale.map((row: any) => row.id) } } });
    }
    return true;
  } catch {
    // Never fail the owner's actual edit because the history row could not be written.
    console.error("draft revision was not recorded");
    return false;
  }
}

/**
 * Move the draft one step back, one step forward, or to a chosen revision.
 *
 * The document is re-normalized on the way out, so a snapshot written by an older version of the
 * platform is still safe to load. Nothing is published: Undo changes the draft only.
 */
export async function moveDraftHistory(
  db: HistoryClient,
  params: { businessId: string; direction?: "undo" | "redo"; version?: number | null; expectedDraftVersion?: number | null },
): Promise<HistoryMoveResult> {
  const { businessId } = params;
  const [experience, revisions] = await Promise.all([
    db.businessExperience.findUnique({
      where: { businessId },
      select: { id: true, draftJson: true, draftVersion: true, historyCursor: true, categoryKey: true },
    }),
    loadDraftHistory(db, businessId),
  ]);
  if (!experience) return { status: "missing", reason: "Create your website before editing it." };
  // A client that read version N sends N back; a newer draft is never rolled back from a stale window.
  const expected = Number(params.expectedDraftVersion);
  if (Number.isInteger(expected) && expected > 0 && expected !== Number(experience.draftVersion)) {
    return { status: "conflict", reason: HISTORY_CONFLICT_REASON };
  }
  if (!revisions.length) {
    return { status: "unavailable", reason: "There is nothing to undo yet — make a change to your website first." };
  }

  const direction = params.direction === "redo" ? "redo" : "undo";
  const cursor = Number(experience.historyCursor) > 0 ? Number(experience.historyCursor) : Number(experience.draftVersion) || 0;
  const requested = Number.isSafeInteger(params.version) && Number(params.version) > 0 ? Number(params.version) : null;
  const target = requested ?? historyTarget(revisions, cursor, direction);

  if (!target) {
    return {
      status: "unavailable",
      reason:
        direction === "redo"
          ? "You are already at your newest change."
          : "This is your first saved change, so there is nothing older to go back to.",
    };
  }
  const snapshot = revisions.find((revision: any) => revision.draftVersion === target);
  if (!snapshot) return { status: "unavailable", reason: "That version is no longer available." };

  let document: ExperienceDocument;
  try {
    document = normalizeExperienceDocument(JSON.parse(snapshot.snapshotJson), experience.categoryKey);
  } catch {
    return { status: "unavailable", reason: "That version can no longer be opened." };
  }

  // Compare-and-swap on the version this move was computed from: if another write landed after the read,
  // nothing is written (a lost race is a conflict, never a silent overwrite of the newer draft).
  const written = await db.businessExperience
    .update({
      where: { businessId, draftVersion: experience.draftVersion },
      data: {
        draftJson: JSON.stringify(document),
        draftVersion: target,
        historyCursor: target,
        categoryKey: document.categoryKey,
        themeKey: document.themeKey,
      },
    })
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code === "P2025") return null;
      throw error;
    });
  if (!written) return { status: "conflict", reason: HISTORY_CONFLICT_REASON };

  const label = snapshot.label || `Version ${target}`;
  return {
    status: "ok",
    document,
    draftVersion: target,
    label,
    source: snapshot.source || "RESTORE",
    message: requested
      ? `Back to “${label}”. Check your preview, then publish when you are happy.`
      : direction === "undo"
        ? `Undone — “${label}” is off your website. You can redo this if you change your mind.`
        : `Redone — “${label}” is back on your website.`,
  };
}
