/**
 * Per-site Website Studio routes: hardening audit.
 *
 * These routes are the multi-site half of the Studio (one draft/publication row per
 * StudioWebsite). The audit looked for four classes of fault:
 *
 *   1. unguarded throws — a document the schema layer refuses must surface as an actionable
 *      client error, never as an unexplained 500;
 *   2. inconsistent error handling between the save, publish, rollback and restore paths;
 *   3. tenant-isolation failures on read *and* write;
 *   4. unsafe partial updates — a save that rewrites data it was never asked to change.
 *
 * The schema and publication-state modules are used for real here (they are pure). Only the
 * session, database and entitlement lookups are mocked, so these tests exercise the actual
 * validation that decides whether a customer's content is stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "OWNER" } as any,
  accessError: null as (Error & { status?: number }) | null,
  access: {
    websiteId: "site-a",
    businessId: "business-a",
    workspaceId: "workspace-a",
    slug: "default",
    name: "Site A",
    websiteRole: "OWNER",
    workspaceRole: "OWNER",
    businessRole: "OWNER",
  },
  website: { id: "site-a", slug: "default", status: "PUBLISHED", isDefault: true } as any,
  business: {
    id: "business-a",
    name: "Mama Njeri Kitchen",
    slug: "mama-njeri",
    category: "food",
    phone: null,
    whatsapp: null,
    location: null,
    logoUrl: null,
    isPublished: true,
    status: "ACTIVE",
  } as any,
  content: { websiteId: "site-a", draftJson: null as string | null, draftVersion: 4, publishedJson: null as string | null, publishedVersion: 2 } as any,
  version: { websiteId: "site-a", version: 2, snapshotJson: "{}" } as any,
  revision: { websiteId: "site-a", draftVersion: 3, snapshotJson: "{}" } as any,
  updateMany: vi.fn(),
  revisionCreate: vi.fn(),
  revisionFindMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));

vi.mock("@/lib/experience/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/experience/tenant")>()),
  assertStudioWebsiteAccess: vi.fn(async () => {
    if (mocks.accessError) throw mocks.accessError;
    return mocks.access;
  }),
}));

// Keep the real refusal class so the routes' `instanceof` handling is exercised too.
vi.mock("@/lib/experience/publication-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/experience/publication-access")>()),
  assertStudioPublicationAccess: vi.fn(async () => {
    if (mocks.accessError) throw mocks.accessError;
    return mocks.access;
  }),
}));

vi.mock("@/lib/experience/site-content", () => ({
  ensureStudioWebsiteContent: vi.fn(async () => mocks.content),
}));

vi.mock("@/lib/experience/entitlement", () => ({
  getInteractiveEntitlement: vi.fn(async () => ({ entitled: true, status: "ACTIVE", reason: "Active" })),
  syncInteractiveEntitlement: vi.fn(async () => ({})),
}));

vi.mock("@/lib/experience/validate", () => ({
  findInvalidCatalogueItems: vi.fn(() => []),
  validateForPublication: vi.fn(() => ({ ready: true, checks: [] })),
}));

vi.mock("@/lib/publication", () => ({
  hasVerifiedPublicationRight: vi.fn(() => true),
  canSetPublished: vi.fn(() => true),
}));

vi.mock("@/lib/team-access", () => ({ hasTeamFreeAccessForBusiness: vi.fn(async () => false) }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

vi.mock("@/lib/db", () => {
  const tx = {
    studioWebsite: { updateMany: mocks.updateMany },
    studioWebsiteContent: { updateMany: mocks.updateMany },
    studioWebsiteVersion: { create: vi.fn(async () => ({})) },
    studioWebsiteDraftRevision: {
      create: mocks.revisionCreate,
      findMany: mocks.revisionFindMany,
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    business: { updateMany: mocks.updateMany, update: vi.fn(async () => ({})) },
    businessExperience: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  return {
    default: {
      studioWebsite: { findUnique: vi.fn(async () => mocks.website), count: vi.fn(async () => 1) },
      studioWebsiteContent: { findUnique: vi.fn(async () => mocks.content) },
      studioWebsiteVersion: { findUnique: vi.fn(async () => mocks.version) },
      studioWebsiteDraftRevision: {
        findUnique: vi.fn(async () => mocks.revision),
        findFirst: vi.fn(async () => ({ draftVersion: 3 })),
        findMany: mocks.revisionFindMany,
      },
      business: { findUnique: vi.fn(async () => mocks.business) },
      businessExperience: { findUnique: vi.fn(async () => null) },
      product: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
      service: { count: vi.fn(async () => 0) },
      payment: { findFirst: vi.fn(async () => ({ status: "PAID" })) },
      subscription: { findUnique: vi.fn(async () => ({ status: "ACTIVE", expiresAt: null, graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS", name: "Interactive" } })) },
      interactiveBusinessEntitlement: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

import { createExperienceDocument } from "@/lib/experience/document";
import { PUT as saveContent } from "@/app/api/studio/websites/content/route";
import { POST as publishSite } from "@/app/api/studio/websites/publish/route";
import { POST as rollbackSite } from "@/app/api/studio/websites/rollback/route";
import { POST as restoreRevision } from "@/app/api/studio/websites/revisions/route";

const FOOD_DIRECTION = { version: 1, family: "editorial", goal: "enquire", personality: "warm", audience: "local", density: "balanced" };

/** A format-2 document the schema layer accepts. */
function validDocument() {
  return { ...createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" }), version: 2, artDirection: FOOD_DIRECTION };
}

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/studio/websites", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorBody(response: Response) {
  return (await response.json()) as { error?: string; code?: string; issues?: Array<{ code: string }> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "owner-a", role: "OWNER" };
  mocks.accessError = null;
  mocks.content = { websiteId: "site-a", draftJson: JSON.stringify(validDocument()), draftVersion: 4, publishedJson: null, publishedVersion: 2 };
  mocks.version = { websiteId: "site-a", version: 2, snapshotJson: JSON.stringify(validDocument()) };
  mocks.revision = { websiteId: "site-a", draftVersion: 3, snapshotJson: JSON.stringify(validDocument()) };
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.revisionCreate.mockResolvedValue({});
  mocks.revisionFindMany.mockResolvedValue([]);
  mocks.audit.mockResolvedValue(undefined);
});

describe("save site draft: a refused document is a client error, never a 500", () => {
  it("refuses a non-format-2 art direction with 422 and writes nothing", async () => {
    // The classic defect shape: validateExperienceJson accepts the shape, then normalization
    // throws because art direction belongs to format 2. Before the fix that throw escaped the
    // route and became a 500 with no explanation of what the owner did wrong.
    const document = { ...createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" }), version: 1, artDirection: FOOD_DIRECTION };
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document }));
    expect(response.status, await response.clone().text()).toBe(422);
    expect(response.status).not.toBe(500);
    const body = await errorBody(response);
    expect(body.code).toBe("experience_schema_invalid");
    // The customer's stored draft is untouched.
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it("refuses an unsupported document version with 422 and writes nothing", async () => {
    const document = { ...validDocument(), version: 99 };
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document }));
    expect(response.status).toBe(422);
    expect((await errorBody(response)).code).toBe("experience_schema_invalid");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses malformed JSON-shaped input without touching the stored draft", async () => {
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document: { version: 2, artDirection: "nonsense" } }));
    expect(response.status).toBe(422);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("still saves a valid document with a compare-and-swap on the version it read", async () => {
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document: validDocument() }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { saved: boolean; draftVersion: number };
    expect(body.saved).toBe(true);
    expect(body.draftVersion).toBe(5);
    expect(mocks.updateMany).toHaveBeenCalled();
  });

  it("refuses a stale draft version with 409 and writes nothing", async () => {
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 2, document: validDocument() }));
    expect(response.status).toBe(409);
    expect((await errorBody(response)).code).toBe("website_draft_version_conflict");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a foreign tenant before performing any write", async () => {
    mocks.accessError = Object.assign(new Error("Studio website access denied"), { status: 403 });
    const response = await saveContent(request("PUT", { websiteId: "site-b", expectedDraftVersion: 4, document: validDocument() }));
    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });
});

describe("save site draft: a save never rewrites data it was not asked to change", () => {
  it("never lets the body switch a site to another kind of business", async () => {
    // The route validated against the business's category but stored the *document's* category, so
    // a document asking for another category was silently accepted and changed which sections,
    // catalogue rules and storefront flow the site renders with. The site's business is the
    // authority. Reproduced before the fix: the stored document read "retail".
    const document = { ...validDocument(), categoryKey: "retail" };
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document }));
    expect(response.status).toBe(422);
    const body = await response.json() as { code?: string };
    expect(body.code).toBe("experience_schema_invalid");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it("accepts a document that names the site's own category", async () => {
    // Pinning must not reject a client that echoes the correct category back.
    const document = { ...validDocument(), categoryKey: "food" };
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document }));
    expect(response.status).toBe(200);
    const data = mocks.updateMany.mock.calls[0][0].data as { draftJson: string };
    expect((JSON.parse(data.draftJson) as { categoryKey: string }).categoryKey).toBe("food");
  });

  it("accepts a document that omits the category and stores the business's own", async () => {
    const { categoryKey: _omitted, ...document } = validDocument() as Record<string, unknown>;
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document }));
    expect(response.status).toBe(200);
    const data = mocks.updateMany.mock.calls[0][0].data as { draftJson: string };
    expect((JSON.parse(data.draftJson) as { categoryKey: string }).categoryKey).toBe("food");
  });

  it("keeps a format-2 document in format 2 and preserves its art direction", async () => {
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document: validDocument() }));
    expect(response.status).toBe(200);
    const data = mocks.updateMany.mock.calls[0][0].data as { draftJson: string };
    const stored = JSON.parse(data.draftJson) as { version: number; artDirection: unknown };
    expect(stored.version).toBe(2);
    expect(stored.artDirection).toEqual(FOOD_DIRECTION);
  });
});

describe("publish: an unrevalidatable draft is refused, not reported as a server fault", () => {
  it("refuses a draft that normalization rejects with a client error and publishes nothing", async () => {
    // validateExperienceJson reports ok, then the storefront-facing normalization throws. If that
    // escapes, the owner gets a 500 and cannot tell whether their site went live.
    mocks.content = {
      websiteId: "site-a",
      draftJson: JSON.stringify({ ...createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri" }), version: 1, artDirection: FOOD_DIRECTION }),
      draftVersion: 4,
      publishedJson: null,
      publishedVersion: 2,
    };
    const response = await publishSite(request("POST", { websiteId: "site-a", expectedDraftVersion: 4, expectedPublishedVersion: 2 }));
    expect(response.status).not.toBe(500);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).code).toBe("experience_schema_invalid");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("still publishes a valid reviewed draft", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const response = await publishSite(request("POST", { websiteId: "site-a", expectedDraftVersion: 4, expectedPublishedVersion: 2 }));
    expect(response.status).toBe(200);
    expect((await response.json() as { published: boolean }).published).toBe(true);
  });
});

describe("rollback and revision restore: an unusable snapshot is refused, not a 500", () => {
  it("refuses a historical publication whose art direction is unsupported with a client error", async () => {
    mocks.version = {
      websiteId: "site-a",
      version: 2,
      snapshotJson: JSON.stringify({ ...createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri" }), version: 1, artDirection: FOOD_DIRECTION }),
    };
    const response = await rollbackSite(request("POST", { websiteId: "site-a", targetVersion: 2, expectedPublishedVersion: 2, expectedDraftVersion: 4 }));
    expect(response.status).not.toBe(500);
    expect(response.status).toBe(422);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("still rolls back to a valid historical publication", async () => {
    const response = await rollbackSite(request("POST", { websiteId: "site-a", targetVersion: 2, expectedPublishedVersion: 2, expectedDraftVersion: 4 }));
    expect(response.status).toBe(200);
    expect((await response.json() as { rolledBack: boolean }).rolledBack).toBe(true);
  });

  it("refuses to restore a revision whose art direction is unsupported, without writing", async () => {
    mocks.revision = {
      websiteId: "site-a",
      draftVersion: 3,
      snapshotJson: JSON.stringify({ ...createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri" }), version: 1, artDirection: FOOD_DIRECTION }),
    };
    const response = await restoreRevision(request("POST", { websiteId: "site-a", revisionVersion: 3, expectedDraftVersion: 4 }));
    expect(response.status).not.toBe(500);
    expect(response.status).toBe(422);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("still restores a valid revision as a new revision", async () => {
    const response = await restoreRevision(request("POST", { websiteId: "site-a", revisionVersion: 3, expectedDraftVersion: 4 }));
    expect(response.status).toBe(200);
    expect((await response.json() as { restored: boolean }).restored).toBe(true);
    expect(mocks.revisionCreate).toHaveBeenCalledTimes(1);
  });
});

describe("tenant isolation across every per-site route", () => {
  it.each([
    ["save", () => saveContent(request("PUT", { websiteId: "site-b", expectedDraftVersion: 4, document: validDocument() }))],
    ["publish", () => publishSite(request("POST", { websiteId: "site-b", expectedDraftVersion: 4, expectedPublishedVersion: 2 }))],
    ["rollback", () => rollbackSite(request("POST", { websiteId: "site-b", targetVersion: 2, expectedPublishedVersion: 2, expectedDraftVersion: 4 }))],
    ["restore", () => restoreRevision(request("POST", { websiteId: "site-b", revisionVersion: 3, expectedDraftVersion: 4 }))],
  ])("refuses a foreign tenant on %s before any write", async (_label, call) => {
    mocks.accessError = Object.assign(new Error("Studio website access denied"), { status: 403 });
    const response = await call();
    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller on every per-site route", async () => {
    mocks.session = null;
    for (const call of [
      () => saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document: validDocument() })),
      () => publishSite(request("POST", { websiteId: "site-a", expectedDraftVersion: 4, expectedPublishedVersion: 2 })),
      () => rollbackSite(request("POST", { websiteId: "site-a", targetVersion: 2, expectedPublishedVersion: 2, expectedDraftVersion: 4 })),
      () => restoreRevision(request("POST", { websiteId: "site-a", revisionVersion: 3, expectedDraftVersion: 4 })),
    ]) {
      const response = await call();
      expect(response.status).toBe(401);
    }
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("refusal envelopes are consistent across save, publish, rollback and restore", () => {
  // Before the fix only publish sent a machine-readable code for a document the schema refuses.
  // Save, rollback and restore sent the same refusal with no code, so a client could not tell an
  // unsupported document from a database failure without parsing English prose. Each of these
  // routes must answer a refused document the same way.
  it("every route tags a refused document with the same code", async () => {
    const legacyWithDirection = {
      ...createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" }),
      version: 1,
      artDirection: FOOD_DIRECTION,
    };

    mocks.content = { websiteId: "site-a", draftJson: JSON.stringify(validDocument()), draftVersion: 4, publishedJson: null, publishedVersion: 2 };
    const save = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document: legacyWithDirection }));

    mocks.version = { websiteId: "site-a", version: 2, snapshotJson: JSON.stringify(legacyWithDirection) };
    const rollback = await rollbackSite(request("POST", { websiteId: "site-a", targetVersion: 2, expectedPublishedVersion: 2, expectedDraftVersion: 4 }));

    mocks.revision = { websiteId: "site-a", draftVersion: 3, snapshotJson: JSON.stringify(legacyWithDirection) };
    const restore = await restoreRevision(request("POST", { websiteId: "site-a", revisionVersion: 3, expectedDraftVersion: 4 }));

    mocks.content = { websiteId: "site-a", draftJson: JSON.stringify(legacyWithDirection), draftVersion: 4, publishedJson: null, publishedVersion: 2 };
    const publish = await publishSite(request("POST", { websiteId: "site-a", expectedDraftVersion: 4, expectedPublishedVersion: 2 }));

    for (const [label, response] of [["save", save], ["rollback", rollback], ["restore", restore], ["publish", publish]] as const) {
      expect(response.status, `${label} status`).toBe(422);
      const body = await response.json() as { code?: string; issues?: unknown[] };
      expect(body.code, `${label} code`).toBe("experience_schema_invalid");
      // Each refusal explains which part of the document is unsupported.
      expect(Array.isArray(body.issues), `${label} issues`).toBe(true);
    }
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("save site draft: a non-document payload is refused, never repaired into defaults", () => {
  // Pinning the category means building a new object. If that is done naively, a payload that is
  // not a document at all (null, a string, an array) becomes an empty object, gets the business's
  // category, passes validation as a default website, and overwrites the owner's real draft with
  // placeholder content. These cases must be refused before any write.
  it.each([
    ["null", null],
    ["a string", "not a document"],
    ["an array", []],
    ["a number", 42],
    ["absent", undefined],
  ])("refuses %s as the document", async (_label, document) => {
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document }));
    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it("still saves a real document afterwards", async () => {
    const response = await saveContent(request("PUT", { websiteId: "site-a", expectedDraftVersion: 4, document: validDocument() }));
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });
});
