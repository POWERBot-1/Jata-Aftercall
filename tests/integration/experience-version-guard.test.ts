/**
 * Draft version guards on the experience routes, and the diversity status of website creation.
 *
 *  - A whole-document PATCH replaces the draft, so it must name the version it was built from (428 otherwise).
 *  - Changing the business type of an existing draft must name the version too (428 otherwise), so a stale
 *    "create" window cannot rewrite a newer draft.
 *  - Section and studio-fix ops are server-side and compare-and-swap on the version they read, so a
 *    concurrent write produces 409, never a silent overwrite.
 *  - Creating a website for a business with no draft is deterministic. Its diversity status is informational:
 *    compared with published versions when they exist, and reported as "no-history" when they do not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  experience: null as any,
  business: null as any,
  experienceUpdate: vi.fn(),
  experienceCreate: vi.fn(),
  versionFindMany: vi.fn(),
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
  getOwnedBusinessIds: vi.fn(async () => [OWNED]),
  assertBusinessOwnership: vi.fn(async () => undefined),
  guardTenantMutation: vi.fn(async (_session: unknown, businessId: string) => {
    if (!businessId) return { ok: false as const, error: "Choose a business first.", status: 400 as const };
    if (businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
  assertSlugOwnershipByBusinessId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business) },
    businessExperience: {
      findUnique: vi.fn(async () => mocks.experience),
      update: mocks.experienceUpdate,
      create: mocks.experienceCreate,
    },
    experienceVersion: { findMany: mocks.versionFindMany },
    auditEvent: { create: mocks.audit },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/experience/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/experience/history")>()),
  recordDraftRevision: mocks.revision,
}));

import { PATCH, POST } from "@/app/api/experience/route";

const baseDocument = () => createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" });

function jsonRequest(body: unknown, method = "PATCH") {
  return new Request("https://jata.test/api/experience", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.experience = {
    id: "exp-a",
    businessId: OWNED,
    draftJson: JSON.stringify(baseDocument()),
    categoryKey: "food",
    themeKey: "food-grill",
    draftVersion: 3,
    publishedVersion: 2,
    status: "PUBLISHED",
  };
  mocks.business = {
    id: OWNED,
    name: "Mama Njeri Kitchen",
    description: "Home cooked meals",
    phone: "0712345678",
    whatsapp: null,
    location: "Westlands",
    category: "food",
    openingHours: null,
  };
  mocks.experienceUpdate.mockResolvedValue({ id: "exp-a", draftVersion: 4, publishedVersion: 2, status: "PUBLISHED", updatedAt: new Date(0) });
  mocks.experienceCreate.mockImplementation(async (args: any) => ({ id: "exp-new", ...args.data }));
  mocks.versionFindMany.mockResolvedValue([]);
  mocks.revision.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue({});
});

describe("PATCH: whole-document writes must name their base version", () => {
  it("refuses a whole-document write with no expectedDraftVersion (428) and writes nothing", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, document: baseDocument() }));
    expect(response.status).toBe(428);
    expect((await response.json()).code).toBe("draft_version_required");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("refuses a whole-document write with an invalid expectedDraftVersion (428)", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, document: baseDocument(), expectedDraftVersion: "three" }));
    expect(response.status).toBe(428);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("applies a whole-document write when the version matches, with a compare-and-swap on that version", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, document: baseDocument(), expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate.mock.calls[0][0].where).toEqual({ businessId: OWNED, draftVersion: 3 });
  });

  it("refuses a stale whole-document write with 409 and does not overwrite the newer draft", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, document: baseDocument(), expectedDraftVersion: 2 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("applies a section op sent with the current version, compare-and-swapped on that version", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "toggle", sectionId: baseDocument().sections[0].id, expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate.mock.calls[0][0].where).toEqual({ businessId: OWNED, draftVersion: 3 });
  });

  it("turns a concurrent write between read and update (P2025) into 409 for a section op, with no revision", async () => {
    mocks.experienceUpdate.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "toggle", sectionId: baseDocument().sections[0].id, expectedDraftVersion: 3 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("rejects another tenant's business before any version check or write", async () => {
    const response = await PATCH(jsonRequest({ businessId: FOREIGN, document: baseDocument(), expectedDraftVersion: 3 }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});

describe("POST: changing the business type of an existing draft must name its base version", () => {
  it("refuses a type change with no expectedDraftVersion (428) and does not rewrite the draft", async () => {
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail" }, "POST"));
    expect(response.status).toBe(428);
    expect((await response.json()).code).toBe("draft_version_required");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("refuses a stale type change with 409 and writes nothing", async () => {
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 2 }, "POST"));
    expect(response.status).toBe(409);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("applies a type change when the version matches, keeping the sections and recording one revision", async () => {
    const before = baseDocument();
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(200);
    const args = mocks.experienceUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: OWNED, draftVersion: 3 });
    expect(args.data.categoryKey).toBe("retail");
    const written = JSON.parse(args.data.draftJson);
    expect(written.sections.map((s: { type: string }) => s.type)).toEqual(before.sections.map((s) => s.type));
    expect(mocks.revision).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and records no revision when another write lands between read and update", async () => {
    mocks.experienceUpdate.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(409);
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("rejects another tenant's business before any write", async () => {
    const response = await POST(jsonRequest({ businessId: FOREIGN, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});

describe("POST: creating a website for a business with no draft", () => {
  beforeEach(() => {
    mocks.experience = null;
  });

  it("creates the draft and reports no-history when the business has no published versions", async () => {
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.diversity.status).toBe("no-history");
    expect(body.diversity.limitation).toMatch(/no published versions/i);
    expect(mocks.experienceCreate).toHaveBeenCalledTimes(1);
  });

  it("compares with published history when it exists and clears the limitation (informational, never blocks)", async () => {
    // A published snapshot identical in structure to the default layout: the create must still succeed.
    const snapshot = createExperienceDocument({
      categoryKey: "food",
      businessName: "Mama Njeri Kitchen",
      description: "Home cooked meals",
      phone: "0712345678",
      whatsapp: null,
      location: "Westlands",
      themeKey: null,
    });
    mocks.versionFindMany.mockResolvedValue([{ snapshotJson: JSON.stringify(snapshot) }]);
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.diversity.publishedCompared).toBe(1);
    expect(body.diversity.limitation).toBeNull();
    expect(typeof body.diversity.maxSimilarity).toBe("number");
    expect(body.diversity.seed).toMatch(/:1$/);
  });

  it("skips an unreadable published snapshot instead of counting it as a comparison", async () => {
    mocks.versionFindMany.mockResolvedValue([{ snapshotJson: "{not json" }]);
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.diversity.status).toBe("no-history");
  });

  it("still creates the draft when the history query fails", async () => {
    mocks.versionFindMany.mockRejectedValue(new Error("connection reset"));
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(201);
    expect((await response.json()).diversity.status).toBe("no-history");
  });

  it("rejects another tenant's business before creating anything", async () => {
    const response = await POST(jsonRequest({ businessId: FOREIGN, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(403);
    expect(mocks.experienceCreate).not.toHaveBeenCalled();
    expect(mocks.versionFindMany).not.toHaveBeenCalled();
  });
});

describe("section operations and studio fixes are version-checked", () => {
  it("refuses a stale section toggle with 409: a stale view cannot act on sections that have since moved", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "toggle", sectionId: baseDocument().sections[0].id, expectedDraftVersion: 2 }, "PATCH"));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("applies a current section update with a compare-and-swap, and leaves every other section as it was", async () => {
    // The stored draft is the baseline. baseDocument() mints new section ids on every call, so it cannot be used here.
    const before = JSON.parse(mocks.experience.draftJson);
    const target = before.sections[0];
    const response = await PATCH(
      jsonRequest({ businessId: OWNED, op: "update", sectionId: target.id, patch: { title: "Changed headline" }, expectedDraftVersion: 3 }, "PATCH"),
    );
    expect(response.status).toBe(200);
    const args = mocks.experienceUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: OWNED, draftVersion: 3 });
    const written = JSON.parse(args.data.draftJson);
    expect(written.sections.find((section: any) => section.id === target.id).title).toBe("Changed headline");
    for (const other of before.sections.slice(1)) {
      const after = written.sections.find((section: any) => section.id === other.id);
      expect(after).toBeDefined();
      expect(after.type).toBe(other.type);
      expect(after.title).toBe(other.title);
      expect(after.visible).toBe(other.visible);
    }
  });

  it("refuses a stale studio fix with 409 and changes nothing", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "studio-fix", fixId: "hero-copy", expectedDraftVersion: 2 }, "PATCH"));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("refuses a section op from another tenant before any version check or write", async () => {
    const response = await PATCH(jsonRequest({ businessId: FOREIGN, op: "toggle", sectionId: baseDocument().sections[0].id, expectedDraftVersion: 3 }, "PATCH"));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});

describe("every draft write must name the version it was made from", () => {
  it("refuses a section operation with no version (428) and writes nothing", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "toggle", sectionId: "hero" }, "PATCH"));
    expect(response.status).toBe(428);
    expect((await response.json()).code).toBe("draft_version_required");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("refuses a theme or brand edit with no version (428) and writes nothing", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, brand: { businessName: "New name" } }, "PATCH"));
    expect(response.status).toBe(428);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("refuses a studio fix with no version (428) and writes nothing", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "studio-fix", fixId: "hero-copy" }, "PATCH"));
    expect(response.status).toBe(428);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("refuses a version that is not a positive whole number (428), not a silent unversioned write", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, op: "toggle", sectionId: "hero", expectedDraftVersion: "three" }, "PATCH"));
    expect(response.status).toBe(428);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("applies a current-version theme edit with a compare-and-swap on the version", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, brand: { businessName: "New name" }, expectedDraftVersion: 3 }, "PATCH"));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate.mock.calls[0][0].where).toEqual({ businessId: OWNED, draftVersion: 3 });
  });
});
