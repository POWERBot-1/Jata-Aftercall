import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "OWNER" } as any,
  accessError: null as (Error & { status?: number }) | null,
  access: { websiteId: "site-a", businessId: "business-a", workspaceId: "workspace-a", slug: "default", name: "A", websiteRole: "OWNER", workspaceRole: "OWNER", businessRole: "OWNER" },
  website: { id: "site-a", slug: "default", status: "DRAFT", isDefault: true },
  business: { id: "business-a", name: "A", slug: "a", category: "Food", phone: null, whatsapp: null, location: null, logoUrl: null, isPublished: false },
  content: { websiteId: "site-a", draftJson: JSON.stringify({ categoryKey: "food" }), draftVersion: 7, publishedJson: null, publishedVersion: 0 },
  target: { websiteId: "site-a", version: 2, snapshotJson: JSON.stringify({ categoryKey: "food" }) },
  current: { websiteId: "site-a", draftJson: "{}", draftVersion: 8, publishedJson: "{}", publishedVersion: 3 },
  findWebsite: vi.fn(),
  findBusiness: vi.fn(),
  findContent: vi.fn(),
  findVersion: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/experience/tenant", () => ({
  assertStudioWebsiteAccess: vi.fn(async () => {
    if (mocks.accessError) throw mocks.accessError;
    return mocks.access;
  }),
}));
vi.mock("@/lib/experience/site-content", () => ({
  ensureStudioWebsiteContent: vi.fn(async () => mocks.content),
}));
vi.mock("@/lib/experience/schema", () => ({
  validateExperienceJson: vi.fn(() => ({ ok: true, document: { categoryKey: "food", themeKey: "food-grill" } })),
}));
vi.mock("@/lib/media/persistence-policy", () => ({
  containsInlineImageDataUrl: vi.fn(() => false),
  INLINE_MEDIA_PERSISTENCE_CODE: "inline_media_persistence_disabled",
  INLINE_MEDIA_PERSISTENCE_MESSAGE: "Persistent media is required.",
}));
vi.mock("@/lib/experience/entitlement", () => ({
  getInteractiveEntitlement: vi.fn(async () => ({ entitled: true, reason: "Active" })),
  syncInteractiveEntitlement: vi.fn(async () => ({})),
}));
vi.mock("@/lib/experience/validate", () => ({
  findInvalidCatalogueItems: vi.fn(() => []),
  validateForPublication: vi.fn(() => ({ ready: true })),
}));
vi.mock("@/lib/publication", () => ({
  hasVerifiedPublicationRight: vi.fn(() => true),
  canSetPublished: vi.fn(() => true),
}));
vi.mock("@/lib/team-access", () => ({ hasTeamFreeAccessForBusiness: vi.fn(async () => false) }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

vi.mock("@/lib/db", () => ({
  default: {
    studioWebsite: { findUnique: mocks.findWebsite },
    studioWebsiteContent: { findUnique: mocks.findContent },
    studioWebsiteVersion: { findUnique: mocks.findVersion },
    business: { findUnique: mocks.findBusiness },
    product: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
    service: { count: vi.fn(async () => 0) },
    payment: { findFirst: vi.fn(async () => ({ status: "PAID" })) },
    subscription: { findUnique: vi.fn(async () => ({ status: "ACTIVE", expiresAt: new Date(Date.now() + 86400000), graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS" } })) },
    $transaction: mocks.transaction,
  },
}));

import { POST as publish } from "@/app/api/studio/websites/publish/route";
import { POST as rollback } from "@/app/api/studio/websites/rollback/route";

function request(url: string, body: unknown) {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "owner-a", role: "OWNER" };
  mocks.accessError = null;
  mocks.findWebsite.mockResolvedValue(mocks.website);
  mocks.findBusiness.mockResolvedValue(mocks.business);
  mocks.findContent.mockResolvedValue(mocks.current);
  mocks.findVersion.mockResolvedValue(mocks.target);
});

describe("Studio website publication tenant boundary", () => {
  it("rejects a foreign tenant before reading or mutating its website", async () => {
    mocks.accessError = Object.assign(new Error("forbidden"), { status: 403 });
    const response = await publish(request("https://jata.test/api/studio/websites/publish", {
      websiteId: "site-b", expectedDraftVersion: 7,
    }));
    expect(response.status).toBe(403);
    expect(mocks.findWebsite).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a stale draft version before publication writes", async () => {
    mocks.content = { ...mocks.content, draftVersion: 8 };
    const response = await publish(request("https://jata.test/api/studio/websites/publish", {
      websiteId: "site-a", expectedDraftVersion: 7,
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("website_draft_version_conflict");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("Studio website rollback concurrency boundary", () => {
  it("rejects rollback across a foreign tenant boundary", async () => {
    mocks.accessError = Object.assign(new Error("forbidden"), { status: 403 });
    const response = await rollback(request("https://jata.test/api/studio/websites/rollback", {
      websiteId: "site-b", targetVersion: 2, expectedPublishedVersion: 3, expectedDraftVersion: 8,
    }));
    expect(response.status).toBe(403);
    expect(mocks.findVersion).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects rollback when either the reviewed draft or live publication is stale", async () => {
    mocks.findContent.mockResolvedValue({ ...mocks.current, draftVersion: 9 });
    const response = await rollback(request("https://jata.test/api/studio/websites/rollback", {
      websiteId: "site-a", targetVersion: 2, expectedPublishedVersion: 3, expectedDraftVersion: 8,
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("website_publish_conflict");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
