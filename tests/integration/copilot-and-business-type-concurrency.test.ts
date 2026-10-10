/**
 * Draft concurrency, diversity reporting and tenant isolation for two draft-writing paths that the
 * owner triggers explicitly:
 *
 *   - POST /api/studio/copilot with apply: true (AI design direction applied after confirmation)
 *   - POST /api/experience for an existing business (change of business type)
 *
 * Both must refuse a stale write with 409 and never overwrite a newer draft. The copilot apply
 * reports a diversity result against published history but is not blocked, because the owner has
 * already reviewed the proposal. That report must say when no published history exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  guardOk: true,
  workspace: null as any,
  publishedJson: null as string | null,
  experienceUpdate: vi.fn(),
  experienceFindUnique: vi.fn(),
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
    if (!mocks.guardOk || businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
  assertSlugOwnershipByBusinessId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: {
      findUnique: mocks.experienceFindUnique,
      update: mocks.experienceUpdate,
      create: vi.fn(),
      upsert: vi.fn(),
    },
    business: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/experience/history", () => ({ recordDraftRevision: mocks.revision }));
vi.mock("@/lib/experience/workspace", () => ({ loadWorkspace: vi.fn(async () => mocks.workspace) }));
vi.mock("@/lib/studio/studioData", () => ({
  loadStudioIntelligence: vi.fn(async () => ({ health: { score: 60, bandLabel: "Good" }, items: [], topSellingIds: [] })),
}));

import { POST as copilotPost } from "@/app/api/studio/copilot/route";
import { POST as experiencePost } from "@/app/api/experience/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

function workspaceFor(draftVersion: number, publishedJson: string | null = null) {
  const document = normalizeExperienceDocument(createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" }), "food");
  return {
    document,
    business: { name: "Mama Njeri Kitchen", description: null, location: null, phone: null, whatsapp: null, openingHours: null, isPublished: false },
    entitlement: { entitled: true },
    experience: { id: "exp-a", draftVersion, publishedJson, publishedVersion: publishedJson ? 1 : 0, status: "DRAFT", categoryKey: "food", themeKey: document.themeKey },
  };
}

const PREMIUM = "Make my website more premium";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.guardOk = true;
  mocks.workspace = workspaceFor(3);
  mocks.publishedJson = null;
  mocks.experienceFindUnique.mockImplementation(async () => ({ publishedJson: mocks.publishedJson, draftVersion: 3 }));
  mocks.experienceUpdate.mockImplementation(async (args: any) => ({ id: "exp-a", draftVersion: args.data.draftVersion }));
  mocks.revision.mockResolvedValue({});
  mocks.audit.mockResolvedValue({});
});

describe("copilot apply: draft version and diversity", () => {
  it("returns the draft version with the proposal so the owner's apply can be checked", async () => {
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.draftVersion).toBe(3);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("applies when the expected version matches, writes with a compare-and-swap, and returns the new version", async () => {
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM, apply: true, expectedDraftVersion: 3 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.draftVersion).toBe(4);
    const args = mocks.experienceUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: OWNED, draftVersion: 3 });
    expect(args.data.draftVersion).toBe(4);
    expect(mocks.revision).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale apply with 409 and writes nothing", async () => {
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM, apply: true, expectedDraftVersion: 2 }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns 409 when another write lands between read and write (compare-and-swap miss), with no revision or audit", async () => {
    mocks.experienceUpdate.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM, apply: true }));
    expect(response.status).toBe(409);
    expect(mocks.revision).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("reports that there is no published history instead of claiming a diversity check", async () => {
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM, apply: true }));
    const body = await response.json();
    expect(body.diversity.publishedCompared).toBe(0);
    expect(typeof body.diversity.limitation).toBe("string");
    expect(body.diversity.maxSimilarity).toBeNull();
  });

  it("compares against published history when it exists and clears the limitation", async () => {
    mocks.publishedJson = JSON.stringify(mocks.workspace.document);
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM, apply: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.diversity.publishedCompared).toBe(1);
    expect(body.diversity.limitation).toBeNull();
    expect(typeof body.diversity.maxSimilarity).toBe("number");
  });

  it("still applies when the published snapshot is malformed, and reports no comparison", async () => {
    mocks.publishedJson = "{not json";
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: OWNED, message: PREMIUM, apply: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.applied).toBe(true);
    expect(body.diversity.publishedCompared).toBe(0);
  });

  it("rejects another tenant's business before reading or writing the draft", async () => {
    const response = await copilotPost(jsonRequest("https://jata.test/api/studio/copilot", { businessId: FOREIGN, message: PREMIUM, apply: true, expectedDraftVersion: 3 }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});

describe("changing business type on an existing website: draft version", () => {
  const change = (body: Record<string, unknown>) =>
    experiencePost(jsonRequest("https://jata.test/api/experience", { businessId: OWNED, categoryKey: "retail", ...body }));

  it("applies when the expected version matches, using a compare-and-swap", async () => {
    const response = await change({ expectedDraftVersion: 3 });
    expect(response.status).toBe(200);
    const args = mocks.experienceUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: OWNED, draftVersion: 3 });
    expect(args.data.categoryKey).toBe("retail");
    expect(mocks.revision).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale change with 409 and writes nothing", async () => {
    const response = await change({ expectedDraftVersion: 2 });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("returns 409 on a lost race (P2025) and records no revision", async () => {
    mocks.experienceUpdate.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const response = await change({});
    expect(response.status).toBe(409);
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("refuses another tenant's business before any write", async () => {
    const response = await experiencePost(jsonRequest("https://jata.test/api/experience", { businessId: FOREIGN, categoryKey: "retail" }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});
