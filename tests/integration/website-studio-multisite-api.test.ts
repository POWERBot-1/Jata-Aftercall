import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any, session: null as any }));
vi.mock("@/lib/db", () => ({
  get default() { return holder.client; },
  get prisma() { return holder.client; },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => holder.session),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

import { createExperienceDocument } from "@/lib/experience/document";
import { POST as createWebsite } from "@/app/api/studio/websites/route";
import { GET as getWebsiteContent, PUT as saveWebsiteContent } from "@/app/api/studio/websites/content/route";
import { POST as restoreWebsiteDraft } from "@/app/api/studio/websites/revisions/route";
import { POST as changeStudioPublication } from "@/app/api/studio/websites/publish/route";
import { POST as rollbackStudioWebsite } from "@/app/api/studio/websites/rollback/route";
import { ensureDefaultStudioWebsite } from "@/lib/experience/ensure-default-website";
import { ensureStudioWebsiteContent } from "@/lib/experience/site-content";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `studio-multisite-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let client: any;
let ownerA: any;
let ownerB: any;
let businessA: any;
let businessB: any;

function session(user: any) {
  return { userId: user.id, email: user.email, role: "CUSTOMER", name: user.name };
}
function request(url: string, method: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!enabled)("Website Studio multi-site content API on PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    holder.client = client;
    ownerA = await client.user.create({
      data: { email: `studio-owner-a-${stamp}@example.test`, name: "Studio owner A", passwordHash: "fixture-only" },
    });
    ownerB = await client.user.create({
      data: { email: `studio-owner-b-${stamp}@example.test`, name: "Studio owner B", passwordHash: "fixture-only" },
    });
    businessA = await client.business.create({
      data: { ownerId: ownerA.id, slug: `studio-multi-a-${stamp}`, name: "Multi-site tenant A", category: "retail" },
    });
    businessB = await client.business.create({
      data: { ownerId: ownerB.id, slug: `studio-multi-b-${stamp}`, name: "Multi-site tenant B", category: "retail" },
    });
    const document = createExperienceDocument({ categoryKey: "retail", businessName: businessA.name });
    await client.businessExperience.create({
      data: {
        businessId: businessA.id,
        categoryKey: "retail",
        themeKey: document.themeKey,
        status: "DRAFT",
        draftJson: JSON.stringify(document),
        draftVersion: 1,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      const businessIds = [businessA?.id, businessB?.id].filter(Boolean);
      const ownerIds = [ownerA?.id, ownerB?.id].filter(Boolean);
      const workspaceLinks = await client.studioWorkspaceBusiness.findMany({
        where: { businessId: { in: businessIds } },
        select: { workspaceId: true },
      });
      const workspaceIds = [...new Set(workspaceLinks.map((link: { workspaceId: string }) => link.workspaceId))];
      const websites = await client.studioWebsite.findMany({
        where: { businessId: { in: businessIds } },
        select: { id: true },
      });
      const websiteIds = websites.map((website: { id: string }) => website.id);

      // Delete this fixture's dependent Studio data first, preserving FK integrity.
      if (websiteIds.length) {
        await client.studioWebsiteDraftRevision.deleteMany({ where: { websiteId: { in: websiteIds } } });
        await client.studioWebsiteVersion.deleteMany({ where: { websiteId: { in: websiteIds } } });
        await client.studioWebsiteContent.deleteMany({ where: { websiteId: { in: websiteIds } } });
        await client.studioWebsiteMember.deleteMany({ where: { websiteId: { in: websiteIds } } });
        await client.studioWebsite.deleteMany({ where: { id: { in: websiteIds }, businessId: { in: businessIds } } });
      }
      await client.studioWorkspaceBusiness.deleteMany({ where: { businessId: { in: businessIds } } });
      for (const workspaceId of workspaceIds) {
        const remainingLinks = await client.studioWorkspaceBusiness.count({ where: { workspaceId } });
        if (remainingLinks === 0) {
          await client.studioWorkspaceMember.deleteMany({ where: { workspaceId } });
          await client.studioWorkspace.deleteMany({ where: { id: workspaceId, ownerUserId: { in: ownerIds } } });
        }
      }

      await client.businessExperience.deleteMany({ where: { businessId: { in: businessIds } } });
      await client.subscription.deleteMany({ where: { businessId: { in: businessIds } } });
      await client.business.deleteMany({ where: { id: { in: businessIds } } });
      await client.user.deleteMany({ where: { id: { in: ownerIds } } });
    } finally {
      await client.$disconnect().catch(() => {});
    }
  }, 60_000);

  it("enforces the current Starter site limit, saves isolated drafts with compare-and-swap, and blocks cross-tenant reads", async () => {
    holder.session = session(ownerA);
    const plan = await client.planConfig.upsert({
      where: { key: "INTERACTIVE_BUSINESS" },
      create: { id: `studio-plan-${stamp}`, key: "INTERACTIVE_BUSINESS", name: "Website Studio — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
      update: {},
    });
    await client.subscription.upsert({
      where: { businessId: businessA.id },
      create: {
        businessId: businessA.id,
        userId: ownerA.id,
        planId: plan.id,
        status: "ACTIVE",
        startAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {
        userId: ownerA.id,
        planId: plan.id,
        status: "ACTIVE",
        startAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const defaultSite = await ensureDefaultStudioWebsite(businessA.id, holder.session);
    const createExtra = await createWebsite(request("/api/studio/websites", "POST", {
      businessId: businessA.id, name: "Campaign site", slug: "campaign",
    }));
    expect(createExtra.status, JSON.stringify(await createExtra.clone().json())).toBe(403);
    const limit = await createExtra.json();
    expect(limit.code).toBe("website_studio_site_limit_reached");
    expect(limit.limit).toBe(1);
    expect(await client.studioWebsite.count({ where: { businessId: businessA.id } })).toBe(1);

    const originalExperience = await client.businessExperience.findUnique({ where: { businessId: businessA.id } });
    const read = await getWebsiteContent(request(`/api/studio/websites/content?websiteId=${defaultSite!.websiteId}`, "GET"));
    expect(read.status).toBe(200);
    const initial = await read.json();
    expect(initial.content.draftDocument.brand.businessName).toBe("Multi-site tenant A");
    expect(initial.content.publishedDocument).toBeNull();
    expect(initial.revisions.length).toBe(1);

    const edited = createExperienceDocument({ categoryKey: "retail", businessName: "Website Studio isolated draft" });
    const save = await saveWebsiteContent(request("/api/studio/websites/content", "PUT", {
      websiteId: defaultSite!.websiteId,
      expectedDraftVersion: initial.content.draftVersion,
      document: edited,
      label: "Update independent website draft",
    }));
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved.draftVersion).toBe(initial.content.draftVersion + 1);

    const staleSave = await saveWebsiteContent(request("/api/studio/websites/content", "PUT", {
      websiteId: defaultSite!.websiteId,
      expectedDraftVersion: initial.content.draftVersion,
      document: edited,
    }));
    expect(staleSave.status).toBe(409);

    const restore = await restoreWebsiteDraft(request("/api/studio/websites/revisions", "POST", {
      websiteId: defaultSite!.websiteId,
      revisionVersion: initial.content.draftVersion,
      expectedDraftVersion: saved.draftVersion,
    }));
    expect(restore.status).toBe(200);
    const restored = await restore.json();
    expect(restored.draftVersion).toBe(saved.draftVersion + 1);

    const reloaded = await getWebsiteContent(request(`/api/studio/websites/content?websiteId=${defaultSite!.websiteId}`, "GET"));
    const next = await reloaded.json();
    expect(next.content.draftDocument.brand.businessName).toBe("Multi-site tenant A");
    expect(next.content.publishedDocument).toBeNull();
    expect(next.revisions).toHaveLength(3);

    const legacyAfter = await client.businessExperience.findUnique({ where: { businessId: businessA.id } });
    expect(legacyAfter.draftJson).toBe(originalExperience.draftJson);
    expect(legacyAfter.draftVersion).toBe(originalExperience.draftVersion);

    holder.session = session(ownerB);
    const crossTenant = await getWebsiteContent(request(`/api/studio/websites/content?websiteId=${defaultSite!.websiteId}`, "GET"));
    expect(crossTenant.status).toBe(403); // The site exists, but the authenticated owner of another business is denied.
  }, 60_000);

  it("serializes concurrent unpublish and restores a default publication with immutable rollback history", async () => {
    holder.session = session(ownerA);
    const defaultSite = await ensureDefaultStudioWebsite(businessA.id, holder.session);
    await ensureStudioWebsiteContent(defaultSite!.websiteId, businessA.id);
    const document = createExperienceDocument({ categoryKey: "retail", businessName: "Published default snapshot" });
    const snapshotJson = JSON.stringify(document);
    await client.studioWebsiteContent.update({
      where: { websiteId: defaultSite!.websiteId },
      data: {
        draftJson: snapshotJson,
        draftVersion: 1,
        historyCursor: 1,
        publishedJson: snapshotJson,
        publishedVersion: 1,
        publishedById: ownerA.id,
        publishedAt: new Date(),
      },
    });
    await client.studioWebsiteVersion.create({
      data: {
        id: `studio-publication-default-${stamp}`,
        websiteId: defaultSite!.websiteId,
        version: 1,
        snapshotJson,
        themeKey: document.themeKey,
        categoryKey: document.categoryKey,
        note: "Initial default publication",
        publishedById: ownerA.id,
      },
    });
    await client.studioWebsite.update({ where: { id: defaultSite!.websiteId }, data: { status: "PUBLISHED" } });
    await client.business.update({ where: { id: businessA.id }, data: { isPublished: true } });
    await client.businessExperience.updateMany({ where: { businessId: businessA.id }, data: { status: "PUBLISHED" } });

    const unpublishBody = {
      websiteId: defaultSite!.websiteId,
      action: "unpublish",
      expectedDraftVersion: 1,
      expectedPublishedVersion: 1,
    };
    const concurrent = await Promise.all([
      changeStudioPublication(request("/api/studio/websites/publish", "POST", unpublishBody)),
      changeStudioPublication(request("/api/studio/websites/publish", "POST", unpublishBody)),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    const afterUnpublish = await client.studioWebsite.findUnique({ where: { id: defaultSite!.websiteId } });
    const afterUnpublishContent = await client.studioWebsiteContent.findUnique({ where: { websiteId: defaultSite!.websiteId } });
    const hiddenBusiness = await client.business.findUnique({ where: { id: businessA.id }, select: { isPublished: true } });
    expect(afterUnpublish.status).toBe("DRAFT");
    expect(afterUnpublishContent.publishedVersion).toBe(1);
    expect(hiddenBusiness.isPublished).toBe(false);

    const restored = await rollbackStudioWebsite(request("/api/studio/websites/rollback", "POST", {
      websiteId: defaultSite!.websiteId,
      targetVersion: 1,
      expectedPublishedVersion: 1,
      expectedDraftVersion: 1,
    }));
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json();
    expect(restoredBody).toMatchObject({ rolledBack: true, version: 2, restoredFromVersion: 1 });
    const [liveBusiness, liveSite, versions, revisions] = await Promise.all([
      client.business.findUnique({ where: { id: businessA.id }, select: { isPublished: true } }),
      client.studioWebsite.findUnique({ where: { id: defaultSite!.websiteId } }),
      client.studioWebsiteVersion.findMany({ where: { websiteId: defaultSite!.websiteId }, orderBy: { version: "asc" } }),
      client.studioWebsiteDraftRevision.findMany({ where: { websiteId: defaultSite!.websiteId }, orderBy: { draftVersion: "asc" } }),
    ]);
    expect(liveBusiness.isPublished).toBe(true);
    expect(liveSite.status).toBe("PUBLISHED");
    expect(versions.map((row: any) => row.version)).toEqual([1, 2]);
    expect(versions[0].snapshotJson).toBe(snapshotJson);
    expect(versions[1].snapshotJson).toBe(snapshotJson);
    expect(revisions.some((row: any) => row.source === "ROLLBACK" && row.draftVersion === 2)).toBe(true);

    const staleRollback = await rollbackStudioWebsite(request("/api/studio/websites/rollback", "POST", {
      websiteId: defaultSite!.websiteId,
      targetVersion: 1,
      expectedPublishedVersion: 1,
      expectedDraftVersion: 1,
    }));
    expect(staleRollback.status).toBe(409);

    holder.session = session(ownerB);
    const foreignRollback = await rollbackStudioWebsite(request("/api/studio/websites/rollback", "POST", {
      websiteId: defaultSite!.websiteId,
      targetVersion: 1,
      expectedPublishedVersion: 2,
      expectedDraftVersion: 2,
    }));
    expect(foreignRollback.status).toBe(403);
  }, 60_000);
});
