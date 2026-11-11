import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  assertStudioPublicationAccess: vi.fn(),
  getInteractiveEntitlement: vi.fn(),
  logAudit: vi.fn(),
  studioWebsiteFindUnique: vi.fn(),
  studioWebsiteUpdateMany: vi.fn(),
  studioWebsiteCount: vi.fn(),
  businessFindUnique: vi.fn(),
  businessUpdateMany: vi.fn(),
  documentFindUnique: vi.fn(),
  transaction: vi.fn(),
  documentUpdateMany: vi.fn(),
  publicationCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/experience/publication-access", () => ({
  assertStudioPublicationAccess: mocks.assertStudioPublicationAccess,
  StudioPublicationRefused: class StudioPublicationRefused extends Error {
    status: number;
    code: string;
    constructor(message: string, status: number, code: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock("@/lib/experience/entitlement", () => ({ getInteractiveEntitlement: mocks.getInteractiveEntitlement }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("@/lib/db", () => ({
  default: {
    studioWebsite: {
      findUnique: mocks.studioWebsiteFindUnique,
      updateMany: mocks.studioWebsiteUpdateMany,
      count: mocks.studioWebsiteCount,
    },
    business: {
      findUnique: mocks.businessFindUnique,
      updateMany: mocks.businessUpdateMany,
    },
    openPageSiteDocument: { findUnique: mocks.documentFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "@/app/api/studio/openpage/publish/route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/studio/openpage/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const draftJson = JSON.stringify({ name: "Nyumbani Kitchen", blocks: [] });

function setup(action: "publish" | "unpublish" = "publish") {
  mocks.getSession.mockResolvedValue({ userId: "owner-1", role: "BUSINESS" });
  mocks.assertStudioPublicationAccess.mockResolvedValue({
    websiteId: "site-1",
    businessId: "business-1",
    workspaceId: "workspace-1",
    slug: "default",
    name: "Nyumbani Kitchen",
    websiteRole: "OWNER",
    workspaceRole: "OWNER",
    businessRole: "OWNER",
  });
  mocks.getInteractiveEntitlement.mockResolvedValue({ entitled: true, reason: "Active" });
  mocks.studioWebsiteFindUnique.mockResolvedValue({
    id: "site-1",
    slug: "default",
    isDefault: true,
    status: action === "publish" ? "DRAFT" : "PUBLISHED",
  });
  mocks.businessFindUnique.mockResolvedValue({ id: "business-1", slug: "nyumbani-kitchen", status: "ACTIVE" });
  mocks.documentFindUnique.mockResolvedValue({
    websiteId: "site-1",
    draftJson,
    draftVersion: 1,
    publishedVersion: action === "publish" ? 0 : 1,
  });
  const tx = {
    openPageSiteDocument: { updateMany: mocks.documentUpdateMany },
    openPageSitePublication: { create: mocks.publicationCreate },
    studioWebsite: { updateMany: mocks.studioWebsiteUpdateMany, count: mocks.studioWebsiteCount },
    business: { updateMany: mocks.businessUpdateMany },
  };
  mocks.transaction.mockImplementation(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.documentUpdateMany.mockResolvedValue({ count: 1 });
  mocks.publicationCreate.mockResolvedValue({ id: "publication-1" });
  mocks.studioWebsiteUpdateMany.mockResolvedValue({ count: 1 });
  mocks.studioWebsiteCount.mockResolvedValue(0);
  mocks.businessUpdateMany.mockResolvedValue({ count: 1 });
}

describe("native OpenPage publication API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes the exact saved draft and stores an immutable publication snapshot", async () => {
    setup("publish");
    const response = await POST(request({
      websiteId: "site-1",
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ published: true, websiteId: "site-1", version: 1, url: "/b/nyumbani-kitchen" });
    expect(mocks.documentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ websiteId: "site-1", draftVersion: 1, publishedVersion: 0, draftJson }),
      data: expect.objectContaining({ publishedJson: draftJson, publishedVersion: 1 }),
    }));
    expect(mocks.publicationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ websiteId: "site-1", version: 1, draftVersion: 1, snapshotJson: draftJson }),
    }));
    expect(mocks.studioWebsiteUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "site-1", status: "DRAFT" },
      data: { status: "PUBLISHED" },
    }));
  });

  it("rejects stale draft or publication versions without writing", async () => {
    setup("publish");
    mocks.documentFindUnique.mockResolvedValue({
      websiteId: "site-1",
      draftJson,
      draftVersion: 2,
      publishedVersion: 0,
    });
    const response = await POST(request({
      websiteId: "site-1",
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
    }));

    expect(response.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("blocks publishing when Website Studio entitlement is inactive", async () => {
    setup("publish");
    mocks.getInteractiveEntitlement.mockResolvedValue({ entitled: false, reason: "Renew Website Studio." });
    const response = await POST(request({
      websiteId: "site-1",
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
    }));

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("unpublishes without deleting the saved publication snapshot", async () => {
    setup("unpublish");
    const response = await POST(request({
      websiteId: "site-1",
      expectedDraftVersion: 1,
      expectedPublishedVersion: 1,
      action: "unpublish",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ published: false, status: "UNPUBLISHED" });
    expect(mocks.studioWebsiteUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "site-1", status: "PUBLISHED" },
      data: { status: "UNPUBLISHED" },
    }));
    expect(mocks.publicationCreate).not.toHaveBeenCalled();
  });
});
