/**
 * Undo, redo, open-a-version and restore must not roll back or overwrite a newer draft.
 *
 * Each of these replaces the whole draft. They are compare-and-swaps on the version they read, and a stale
 * client (a version it did not see) is refused with 409 before anything is written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  experience: null as any,
  revisions: [] as any[],
  experienceVersion: null as any,
  experienceUpdate: vi.fn(),
  revision: vi.fn(),
  audit: vi.fn(),
}));

const OWNED = "business-a";
const FOREIGN = "business-b";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  assertBusinessOwnership: vi.fn(async (businessId: string) => {
    if (businessId !== OWNED) {
      const error = new Error("You do not have access to that business.") as Error & { status: number };
      error.status = 403;
      throw error;
    }
  }),
  guardTenantMutation: vi.fn(async (_session: unknown, businessId: string) => {
    if (!businessId) return { ok: false as const, error: "Choose a business first.", status: 400 as const };
    if (businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: {
      findUnique: vi.fn(async () => mocks.experience),
      update: mocks.experienceUpdate,
    },
    experienceDraftRevision: { findMany: vi.fn(async () => mocks.revisions) },
    experienceVersion: { findUnique: vi.fn(async () => mocks.experienceVersion) },
    auditEvent: { create: mocks.audit },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/experience/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience/history")>();
  return { ...actual, recordDraftRevision: mocks.revision };
});

import { GET as historyGet, POST as historyPost } from "@/app/api/experience/history/route";
import { POST as versionsPost } from "@/app/api/experience/versions/route";

const documentAt = (label: string) => createExperienceDocument({ categoryKey: "food", businessName: label });

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const CONFLICT = Object.assign(new Error("Record to update not found."), { code: "P2025" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.experience = {
    id: "exp-a",
    businessId: OWNED,
    draftJson: JSON.stringify(documentAt("Draft three")),
    categoryKey: "food",
    themeKey: "food-grill",
    draftVersion: 3,
    historyCursor: 3,
    publishedVersion: null,
    status: "DRAFT",
  };
  mocks.revisions = [1, 2, 3].map((version) => ({
    draftVersion: version,
    label: `Change ${version}`,
    source: "EDIT",
    createdAt: new Date(0),
    snapshotJson: JSON.stringify(documentAt(`Snapshot ${version}`)),
  }));
  mocks.experienceVersion = {
    version: 1,
    categoryKey: "food",
    themeKey: "food-grill",
    snapshotJson: JSON.stringify(documentAt("Published one")),
  };
  mocks.experienceUpdate.mockResolvedValue({ id: "exp-a", draftVersion: 4 });
  mocks.revision.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue({});
});

describe("history: undo and redo are compare-and-swaps on the version read", () => {
  it("reports the row's draftVersion so the client can send it back", async () => {
    const response = await historyGet(new Request(`https://jata.test/api/experience/history?businessId=${OWNED}`));
    expect(response.status).toBe(200);
    expect((await response.json()).draftVersion).toBe(3);
  });

  it("undoes when the expected version matches, writing only if the row is still at that version", async () => {
    const response = await historyPost(jsonRequest("https://jata.test/api/experience/history", { businessId: OWNED, direction: "undo", expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    const args = mocks.experienceUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: OWNED, draftVersion: 3 });
    expect(args.data.historyCursor).toBe(2);
  });

  it("refuses a stale undo with 409 and writes nothing, so a newer draft is never rolled back", async () => {
    const response = await historyPost(jsonRequest("https://jata.test/api/experience/history", { businessId: OWNED, direction: "undo", expectedDraftVersion: 2 }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("draft_version_conflict");
    expect(body.unchanged).toBe(true);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns 409 and writes no audit when another write lands between read and update", async () => {
    mocks.experienceUpdate.mockRejectedValue(CONFLICT);
    const response = await historyPost(jsonRequest("https://jata.test/api/experience/history", { businessId: OWNED, direction: "undo" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected database error instead of reporting a conflict", async () => {
    mocks.experienceUpdate.mockRejectedValue(new Error("connection reset"));
    const response = await historyPost(jsonRequest("https://jata.test/api/experience/history", { businessId: OWNED, direction: "undo" }));
    expect(response.status).toBe(500);
  });

  it("refuses another tenant's business before reading or writing the draft", async () => {
    const response = await historyPost(jsonRequest("https://jata.test/api/experience/history", { businessId: FOREIGN, direction: "undo", expectedDraftVersion: 3 }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});

describe("versions: restoring a published version is a compare-and-swap on the version read", () => {
  it("restores when the expected version matches, with the write keyed on that version", async () => {
    const response = await versionsPost(jsonRequest("https://jata.test/api/experience/versions", { businessId: OWNED, version: 1, expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate.mock.calls[0][0].where).toEqual({ businessId: OWNED, draftVersion: 3 });
    expect(mocks.revision).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale restore with 409 and does not replace the newer draft", async () => {
    const response = await versionsPost(jsonRequest("https://jata.test/api/experience/versions", { businessId: OWNED, version: 1, expectedDraftVersion: 2 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("returns 409 when another write lands between read and update, with no revision", async () => {
    mocks.experienceUpdate.mockRejectedValue(CONFLICT);
    const response = await versionsPost(jsonRequest("https://jata.test/api/experience/versions", { businessId: OWNED, version: 1 }));
    expect(response.status).toBe(409);
    expect(mocks.revision).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses another tenant's business before reading the draft or writing", async () => {
    const response = await versionsPost(jsonRequest("https://jata.test/api/experience/versions", { businessId: FOREIGN, version: 1, expectedDraftVersion: 3 }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});
