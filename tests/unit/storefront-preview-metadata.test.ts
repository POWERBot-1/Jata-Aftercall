import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";

const h = vi.hoisted(() => ({ session: null as null | { userId: string; role: string }, business: null as any, load: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { business: { findUnique: h.find } } }));
vi.mock("@/lib/auth", () => ({ getSession: async () => h.session }));
vi.mock("@/lib/experience/storefront", () => ({ loadStorefront: h.load }));
import { generateMetadata } from "@/app/b/[slug]/page";

const draft = createExperienceDocument({ categoryKey: "retail", businessName: "Tenant catalogue" });
draft.seo = { title: "PRIVATE reviewed draft title", description: "Private draft description" };
const live = createExperienceDocument({ categoryKey: "retail", businessName: "Tenant catalogue" });
live.seo = { title: "PUBLIC live catalogue", description: "Public description" };
const request = (preview?: string) => ({ params: Promise.resolve({ slug: "tenant-catalogue" }), searchParams: Promise.resolve({ preview }) });

beforeEach(() => {
  h.session = { userId: "owner", role: "CUSTOMER" };
  h.business = { id: "owned-business", slug: "tenant-catalogue", name: "Tenant catalogue", category: "retail", location: "Nairobi",
    description: "Real supplied description", isPublished: true, ownerId: "owner", members: [{ userId: "member", role: "STAFF" }], services: [], offer: null, subscription: null };
  h.find.mockReset().mockImplementation(async () => h.business);
  h.load.mockReset().mockImplementation(async (_slug, options) => {
    const isPreview = options.allowDraft && (options.preferDraft || !h.business.isPublished);
    return { business: h.business, document: isPreview ? draft : live, isPreview: Boolean(isPreview) };
  });
});

describe("storefront metadata agrees with the authorized draft/live renderer", () => {
  it("published owner's requested draft uses draft SEO and is noindex/nofollow", async () => {
    const metadata = await generateMetadata(request("draft"));
    expect(h.load).toHaveBeenCalledWith("tenant-catalogue", { allowDraft: true, preferDraft: true });
    expect(metadata.title).toBe(draft.seo!.title);
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
  it.each([null, { userId: "foreign-owner", role: "CUSTOMER" }])("an anonymous/foreign draft query cannot select private metadata", async (session) => {
    h.session = session;
    const metadata = await generateMetadata(request("draft"));
    expect(h.load.mock.calls[0][1].allowDraft).toBe(false);
    expect(h.load.mock.calls[0][1].preferDraft).not.toBe(true);
    expect(metadata.title).toBe(live.seo!.title);
    expect(metadata.robots).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain("PRIVATE");
  });
  it.each([{ userId: "member", role: "CUSTOMER" }, { userId: "admin", role: "ADMIN" }])("preserves the renderer's existing member/admin preview permission", async (session) => {
    h.session = session;
    expect((await generateMetadata(request("draft"))).robots).toMatchObject({ index: false, follow: false });
    expect(h.load).toHaveBeenCalledWith("tenant-catalogue", { allowDraft: true, preferDraft: true });
  });
  it("ordinary owner live navigation retains published metadata", async () => {
    const metadata = await generateMetadata(request());
    expect(metadata.title).toBe(live.seo!.title);
    expect(metadata.robots).toBeUndefined();
    expect(h.load.mock.calls[0][1].allowDraft).toBe(true);
    expect(h.load.mock.calls[0][1].preferDraft).not.toBe(true);
  });
  it("unpublished owner preview remains noindex and public metadata stays unavailable", async () => {
    h.business.isPublished = false;
    expect((await generateMetadata(request())).robots).toMatchObject({ index: false, follow: false });
    h.session = null;
    expect((await generateMetadata(request("draft"))).title).toBe("Page not found");
  });
  it("failed experience loading has safe classic metadata/noindex, not a blank/error response", async () => {
    h.load.mockRejectedValue(new Error("Unreadable experience fixture"));
    const metadata = await generateMetadata(request("draft"));
    expect(metadata.title).toContain("Tenant catalogue");
    expect(metadata.description).toBe(h.business.description);
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
