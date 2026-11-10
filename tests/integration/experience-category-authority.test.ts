/**
 * The Website Studio editor's real save path (`/api/experience`) must not let a request body
 * decide what kind of business the site is.
 *
 * Trace: `components/studio/canvas/StudioCanvas.tsx` (and the dashboard panels) call
 * `/api/experience` POST (create / change type) and PATCH (every edit) with an
 * `expectedDraftVersion`. `PATCH /api/business` is the only supported way to change a business's
 * category. Before this guard, POST took `categoryKey` straight from the body and never read the
 * tenant's business row, so an owner could silently switch a site to a different set of sections,
 * catalogue rules and customer flow.
 *
 * These tests exercise the real route with the real category-authority module. Only the session,
 * database and tenant-guard lookups are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";
import { planCreateCategory, planContentCategory, categoryForRead, hasChosenCategory } from "@/lib/experience/category-authority";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "OWNER" } as any,
  experience: null as any,
  business: null as any,
  experienceUpdate: vi.fn(),
  experienceCreate: vi.fn(),
  businessUpdate: vi.fn(),
  businessUpdateMany: vi.fn(),
  draftUpdateMany: vi.fn(),
  transaction: vi.fn(),
  revision: vi.fn(),
  audit: vi.fn(),
}));

const OWNED = "business-a";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  TenantError: class TenantError extends Error {
    status = 403;
  },
  getOwnedBusinessIds: vi.fn(async () => [OWNED]),
  assertBusinessOwnership: vi.fn(async () => undefined),
  guardTenantMutation: vi.fn(async () => ({ ok: true as const })),
  assertSlugOwnershipByBusinessId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/experience/ensure-default-website", () => ({
  guardStudioWebsiteMutation: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business), update: mocks.businessUpdate, updateMany: mocks.businessUpdateMany },
    businessExperience: {
      findUnique: vi.fn(async () => mocks.experience),
      update: mocks.experienceUpdate,
      create: mocks.experienceCreate,
      updateMany: mocks.draftUpdateMany,
    },
    experienceVersion: { findMany: vi.fn(async () => []) },
    // The category change is applied inside one transaction with the draft write.
    $transaction: vi.fn(async (callback: any) => callback({
      business: { updateMany: mocks.businessUpdateMany },
      businessExperience: { updateMany: mocks.draftUpdateMany, create: mocks.experienceCreate },
    })),
    auditEvent: { create: mocks.audit },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/experience/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/experience/history")>()),
  recordDraftRevision: mocks.revision,
}));

import { POST, PATCH } from "@/app/api/experience/route";

function jsonRequest(body: unknown, method = "PATCH") {
  return new Request("https://jata.test/api/experience", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const foodDocument = () => createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "OWNER" };
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
  mocks.experience = {
    id: "exp-a",
    businessId: OWNED,
    draftJson: JSON.stringify(foodDocument()),
    categoryKey: "food",
    themeKey: "food-grill",
    draftVersion: 3,
    publishedVersion: 2,
    status: "PUBLISHED",
  };
  mocks.experienceUpdate.mockResolvedValue({ id: "exp-a", draftVersion: 4, publishedVersion: 2, status: "PUBLISHED", updatedAt: new Date(0) });
  mocks.experienceCreate.mockImplementation(async (args: any) => ({ id: "exp-new", ...args.data }));
  mocks.businessUpdate.mockResolvedValue({});
  mocks.businessUpdateMany.mockResolvedValue({ count: 1 });
  mocks.draftUpdateMany.mockResolvedValue({ count: 1 });
  mocks.revision.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue({});
});

describe("create website: the business record decides the category", () => {
  it("carries an explicit type choice into the business record on a first-time create", async () => {
    // "You can change it later" is a real feature. The defect was never that an owner could choose
    // a type — it was that the choice was written to the draft and never to the tenant, so the
    // website and the business record could silently disagree.
    mocks.experience = null;
    mocks.business.category = "food";
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "realestate" }, "POST"));
    expect(response.status).toBe(201);
    expect(mocks.experienceCreate.mock.calls[0][0].data.categoryKey).toBe("realestate");
    expect(mocks.businessUpdateMany).toHaveBeenCalledWith({ where: { id: OWNED, category: "food" }, data: { category: "realestate" } });
  });

  it("carries an explicit type change into the business record on an existing draft", async () => {
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(200);
    expect(mocks.draftUpdateMany.mock.calls[0][0].data.categoryKey).toBe("retail");
    expect(mocks.businessUpdateMany).toHaveBeenCalledWith({ where: { id: OWNED, category: "food" }, data: { category: "retail" } });
    expect(mocks.revision).toHaveBeenCalledTimes(1);
  });

  it("accepts the business record's own category and creates the draft", async () => {
    mocks.experience = null;
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(201);
    expect(mocks.experienceCreate).toHaveBeenCalledTimes(1);
    expect(mocks.experienceCreate.mock.calls[0][0].data.categoryKey).toBe("food");
  });

  it("accepts the owner's first choice when the business record has no real category yet", async () => {
    // A brand-new business is stored as "Other" during onboarding. Opening the website for the
    // first time is how the owner says what they do, so this must not be refused.
    mocks.experience = null;
    mocks.business.category = "Other";
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(201);
    expect(mocks.experienceCreate.mock.calls[0][0].data.categoryKey).toBe("food");
  });

  it("refuses a create with no category at all when the business has none", async () => {
    mocks.experience = null;
    mocks.business.category = null;
    const response = await POST(jsonRequest({ businessId: OWNED }, "POST"));
    expect(response.status).toBe(400);
    expect((await response.json() as { code?: string }).code).toBe("category_required");
    expect(mocks.experienceCreate).not.toHaveBeenCalled();
  });

  it("rejects a business that does not exist", async () => {
    mocks.business = null;
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food" }, "POST"));
    expect(response.status).toBe(404);
    expect(mocks.experienceCreate).not.toHaveBeenCalled();
  });
});

describe("edit draft: a partial edit cannot re-categorise the site", () => {
  it("refuses a partial edit whose body switches the business type, writing nothing", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, categoryKey: "retail", brand: { primaryColor: "#0F766E" }, expectedDraftVersion: 3 }));
    expect(response.status).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("business_category_mismatch");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });

  it("still applies an ordinary edit that does not mention the category", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, brand: { primaryColor: "#0F766E" }, expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.experienceUpdate.mock.calls[0][0].data.draftJson);
    expect(written.categoryKey).toBe("food");
    expect(written.brand.primaryColor).toBe("#0F766E");
  });

  it("still applies an edit that echoes the correct category", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, categoryKey: "food", brand: { primaryColor: "#123456" }, expectedDraftVersion: 3 }));
    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.experienceUpdate.mock.calls[0][0].data.draftJson);
    expect(written.categoryKey).toBe("food");
  });

  it("keeps stale-write protection ahead of any category write", async () => {
    const response = await PATCH(jsonRequest({ businessId: OWNED, categoryKey: "food", brand: { primaryColor: "#123456" }, expectedDraftVersion: 1 }));
    expect(response.status).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("draft_version_conflict");
    expect(mocks.experienceUpdate).not.toHaveBeenCalled();
  });
});

describe("a type change propagates to the business record", () => {
  it("moves the business record with an explicit change of business type", async () => {
    // The website and the tenant must never disagree about what the business is.
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(200);
    expect(mocks.businessUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.businessUpdateMany.mock.calls[0][0]).toEqual({ where: { id: OWNED, category: "food" }, data: { category: "retail" } });
    expect(mocks.draftUpdateMany.mock.calls[0][0].data.categoryKey).toBe("retail");
  });

  it("does not touch the business record when the type did not change", async () => {
    mocks.business.category = "food";
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "food", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(200);
    expect(mocks.businessUpdateMany).not.toHaveBeenCalled();
  });
});

describe("category authority rules in isolation", () => {
  it("propagates an explicit choice and reports the previous category", () => {
    const plan = planCreateCategory("food", "retail");
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.categoryKey).toBe("retail");
      expect(plan.propagateToBusiness).toBe(true);
      expect(plan.previousCategory).toBe("food");
    }
  });

  it("does not propagate when the choice matches the record", () => {
    const plan = planCreateCategory("food", "food");
    expect(plan.ok && plan.propagateToBusiness).toBe(false);
  });

  it("adopts the first choice while onboarding has not recorded a category", () => {
    for (const unset of ["other", "Other", null, undefined, "not-a-category"]) {
      const plan = planCreateCategory(unset as any, "food");
      expect(plan.ok, `businessCategory=${String(unset)}`).toBe(true);
      if (plan.ok) expect(plan.propagateToBusiness).toBe(true);
      expect(hasChosenCategory(unset as any)).toBe(false);
    }
  });

  it("requires a choice when neither the record nor the request has one", () => {
    const plan = planCreateCategory(null, undefined);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("category_required");
  });

  it("refuses a content edit that tries to change a recorded category", () => {
    const plan = planContentCategory("food", "retail");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.status).toBe(409);
      expect(plan.code).toBe("business_category_mismatch");
    }
  });

  it("lets a content edit confirm the recorded category, or say nothing", () => {
    for (const asked of ["food", undefined]) {
      const plan = planContentCategory("food", asked);
      expect(plan.ok, `asked=${String(asked)}`).toBe(true);
      if (plan.ok) expect(plan.categoryKey).toBe("food");
    }
  });

  it("never refuses a read, and reports a stored category that disagrees with the business", () => {
    const read = categoryForRead("food", "retail");
    expect(read.categoryKey).toBe("food");
    expect(read.mismatch).toBe(true);
    expect(categoryForRead("food", null).categoryKey).toBe("food");
    expect(categoryForRead(null, "retail").categoryKey).toBe("retail");
    expect(categoryForRead(null, null).categoryKey).toBe("other");
  });
});

describe("atomicity: a type change is all-or-nothing", () => {
  it("does not move the business record when the draft compare-and-swap loses", async () => {
    // A concurrent edit advanced the draft. The draft write matches no row, so the transaction must
    // abandon BEFORE touching the business record — otherwise the tenant's type would change while
    // the draft stayed on the old one.
    mocks.draftUpdateMany.mockResolvedValue({ count: 0 });
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(409);
    expect(mocks.businessUpdateMany).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("rolls back the draft when the business record compare-and-swap loses", async () => {
    // Someone else changed the business type between our read and our write. The whole request must
    // fail rather than leave a draft for one type and a business record for another.
    mocks.businessUpdateMany.mockResolvedValue({ count: 0 });
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBe(409);
    expect((await response.json() as { code?: string }).code).toBe("draft_version_conflict");
    expect(mocks.revision).not.toHaveBeenCalled();
  });

  it("fails the whole create when the business record cannot be updated", async () => {
    mocks.experience = null;
    mocks.businessUpdateMany.mockResolvedValue({ count: 0 });
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail" }, "POST"));
    expect(response.status).not.toBe(201);
    // The draft must not have been created for a type the business record does not hold.
    expect(mocks.experienceCreate).not.toHaveBeenCalled();
  });

  it("propagates a database failure instead of reporting a successful change", async () => {
    mocks.draftUpdateMany.mockRejectedValue(new Error("connection reset"));
    const response = await POST(jsonRequest({ businessId: OWNED, categoryKey: "retail", expectedDraftVersion: 3 }, "POST"));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(mocks.businessUpdateMany).not.toHaveBeenCalled();
  });
});
