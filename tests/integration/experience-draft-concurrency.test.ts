/**
 * Draft concurrency and tenant isolation for the experience PATCH route.
 *
 * A preview is built from draft version N. Applying it must not overwrite a draft that has moved on
 * (version N+1 or later), and must never touch another tenant's row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  experience: {
    id: "exp-a",
    businessId: "business-a",
    draftJson: JSON.stringify({ categoryKey: "food", brand: {}, settings: {}, sections: [] }),
    categoryKey: "food",
    themeKey: "food-grill",
    draftVersion: 3,
    publishedVersion: 2,
    status: "PUBLISHED",
  },
  experienceUpdate: vi.fn(),
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
    businessExperience: {
      findUnique: vi.fn(async () => mocks.experience),
      update: mocks.experienceUpdate,
      upsert: vi.fn(),
      create: vi.fn(),
    },
    auditEvent: { create: mocks.audit },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { PATCH } from "@/app/api/experience/route";

function patch(body: unknown) {
  return new Request("https://jata.test/api/experience", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
  mocks.experience = { ...mocks.experience, draftVersion: 3 };
  mocks.experienceUpdate.mockResolvedValue({ id: "exp-a", draftVersion: 4, publishedVersion: 2, status: "PUBLISHED", updatedAt: new Date(0) });
  mocks.audit.mockResolvedValue({});
});

describe("PATCH draft concurrency", () => {
  it("applies the edit when the client's base version matches the stored draft", async () => {
    const response = await PATCH(patch({ businessId: OWNED, op: "toggle", sectionId: "s1", expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate).toHaveBeenCalledTimes(1);
    const args = mocks.experienceUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: OWNED, draftVersion: 3 });
    expect(args.data.draftVersion).toBe(4);
  });

  it("refuses a stale preview with 409 and does not write, so a newer draft is never overwritten", async () => {
    mocks.experience = { ...mocks.experience, draftVersion: 5 };
    const response = await PATCH(patch({ businessId: OWNED, op: "toggle", sectionId: "s1", expectedDraftVersion: 3 }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe("draft_version_conflict");
    expect(body.currentDraftVersion).toBe(5);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when the row changed between read and write (compare-and-swap miss)", async () => {
    mocks.experienceUpdate.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    const response = await PATCH(patch({ businessId: OWNED, op: "toggle", sectionId: "s1", expectedDraftVersion: 3 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("draft_version_conflict");
  });

  it("rethrows unexpected database errors instead of reporting a conflict", async () => {
    mocks.experienceUpdate.mockRejectedValue(new Error("connection reset"));
    const response = await PATCH(patch({ businessId: OWNED, op: "toggle", sectionId: "s1", expectedDraftVersion: 3 }));
    expect(response.status).toBe(500);
  });

  it("keeps working for clients that do not send a base version (no concurrency claim is made)", async () => {
    const response = await PATCH(patch({ businessId: OWNED, op: "toggle", sectionId: "s1" }));
    expect(response.status).toBe(200);
    expect(mocks.experienceUpdate.mock.calls[0][0].where).toEqual({ businessId: OWNED, draftVersion: 3 });
  });
});

describe("PATCH tenant isolation with concurrency", () => {
  it("rejects a foreign business before any version check or write", async () => {
    const response = await PATCH(patch({ businessId: FOREIGN, op: "toggle", sectionId: "s1", expectedDraftVersion: 3 }));
    expect(response.status).toBe(403);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.session = null;
    const response = await PATCH(patch({ businessId: OWNED, op: "toggle", sectionId: "s1", expectedDraftVersion: 3 }));
    expect(response.status).toBe(401);
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});
