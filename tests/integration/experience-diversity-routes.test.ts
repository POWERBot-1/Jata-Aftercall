/**
 * Route-level diversity behaviour for the layout preview endpoint.
 *
 * The preview route is the only real candidate-generation path. It must:
 *   - compare against the business's own published history (ExperienceVersion snapshots),
 *   - report a duplicate of a published layout as not accepted,
 *   - say plainly when there is no history, rather than claim a check,
 *   - skip unreadable snapshots instead of counting them as comparisons,
 *   - reject another tenant's business before reading anything, and
 *   - never write (the preview has no side effects).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { buildVariant } from "@/lib/experience/variant";
import { DEFAULT_DIVERSITY_THRESHOLD } from "@/lib/experience/diversity";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  experience: null as any,
  versions: [] as Array<{ snapshotJson: string }>,
  experienceFindUnique: vi.fn(),
  experienceUpdate: vi.fn(),
  versionFindMany: vi.fn(),
}));

const OWNED = "business-a";
const FOREIGN = "business-b";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  guardTenantMutation: vi.fn(async (_session: unknown, businessId: string) => {
    if (businessId !== OWNED) return { ok: false as const, error: "You do not have access to that business.", status: 403 as const };
    return { ok: true as const };
  }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    businessExperience: { findUnique: mocks.experienceFindUnique, update: mocks.experienceUpdate, create: vi.fn(), upsert: vi.fn() },
    experienceVersion: { findMany: mocks.versionFindMany },
  },
}));

import { POST as variantPost } from "@/app/api/experience/variant/route";

const draft = normalizeExperienceDocument(
  createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen", phone: "0712345678", location: "Westlands" }),
  "food",
);

function request(body: Record<string, unknown>) {
  return new Request("https://jata.test/api/experience/variant", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.experience = { draftJson: JSON.stringify(draft), categoryKey: "food", draftVersion: 7 };
  mocks.versions = [];
  mocks.experienceFindUnique.mockImplementation(async () => mocks.experience);
  mocks.versionFindMany.mockImplementation(async () => mocks.versions);
  mocks.experienceUpdate.mockResolvedValue({});
});

describe("layout preview: history basis", () => {
  it("reports a limitation and compares only with the draft when there is no published history", async () => {
    const response = await variantPost(request({ businessId: OWNED }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.comparedWith).toBe(0);
    expect(body.history.publishedCompared).toBe(0);
    expect(typeof body.history.limitation).toBe("string");
    expect(body.baseDraftVersion).toBe(7);
    expect(body.saved).toBe(false);
  });

  it("compares with published history and clears the limitation when versions exist", async () => {
    mocks.versions = [{ snapshotJson: JSON.stringify(draft) }];
    const response = await variantPost(request({ businessId: OWNED }));
    const body = await response.json();
    expect(body.comparedWith).toBe(1);
    expect(body.history.publishedCompared).toBe(1);
    expect(body.history.limitation).toBeNull();
  });

  it("skips an unreadable published snapshot instead of counting it as a comparison", async () => {
    mocks.versions = [{ snapshotJson: "{not json" }];
    const response = await variantPost(request({ businessId: OWNED }));
    const body = await response.json();
    expect(body.comparedWith).toBe(0);
    expect(body.history.publishedCompared).toBe(0);
    expect(typeof body.history.limitation).toBe("string");
  });
});

describe("layout preview: duplicate and acceptable candidates", () => {
  it("does not accept the first candidate when it duplicates a published layout", async () => {
    const seed = `${OWNED}:7`;
    // The first candidate the route would build from this draft is already in the owner's history.
    const duplicate = buildVariant(draft, seed).document;
    mocks.versions = [{ snapshotJson: JSON.stringify(duplicate) }];
    const response = await variantPost(request({ businessId: OWNED, seed }));
    const body = await response.json();
    expect(body.attempts[0].ok).toBe(false);
    expect(body.attempts[0].maxSimilarity).toBeGreaterThanOrEqual(DEFAULT_DIVERSITY_THRESHOLD);
    expect(body.report.threshold).toBe(DEFAULT_DIVERSITY_THRESHOLD);
    // Whatever it returns, it is reported honestly: accepted only if a retry passed the gate.
    if (body.accepted) expect(body.report.maxSimilarity).toBeLessThan(DEFAULT_DIVERSITY_THRESHOLD);
  });

  it("accepts a candidate that differs from the draft and from an unrelated published layout", async () => {
    const other = normalizeExperienceDocument(
      createExperienceDocument({ categoryKey: "retail", businessName: "Duka Ya Mtaa" }),
      "retail",
    );
    mocks.versions = [{ snapshotJson: JSON.stringify(other) }];
    const response = await variantPost(request({ businessId: OWNED }));
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.report.maxSimilarity).toBeLessThan(DEFAULT_DIVERSITY_THRESHOLD);
  });

  it("is reproducible: the same seed gives the same candidate and seed", async () => {
    const first = await (await variantPost(request({ businessId: OWNED, seed: "biz-a:repeat" }))).json();
    const second = await (await variantPost(request({ businessId: OWNED, seed: "biz-a:repeat" }))).json();
    expect(first.seed).toBe(second.seed);
    expect(JSON.stringify(first.candidate)).toBe(JSON.stringify(second.candidate));
  });
});

describe("layout preview: tenant isolation and no side effects", () => {
  it("rejects another tenant's business before reading any draft or history", async () => {
    const response = await variantPost(request({ businessId: FOREIGN }));
    expect(response.status).toBe(403);
    expect(mocks.experienceFindUnique).not.toHaveBeenCalled();
    expect(mocks.versionFindMany).not.toHaveBeenCalled();
  });

  it("never writes the draft or a revision, even when the candidate is accepted", async () => {
    const response = await variantPost(request({ businessId: OWNED }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("refuses when the business has no website yet", async () => {
    mocks.experience = null;
    const response = await variantPost(request({ businessId: OWNED }));
    expect(response.status).toBe(409);
  });
});
