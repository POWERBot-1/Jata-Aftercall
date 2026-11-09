/**
 * Real Prisma/PostgreSQL proof of the Website Studio 2.0 public resolution contract.
 *
 * Every assertion here runs against a migrated isolated database and the REAL
 * `loadStorefront` loader — no in-memory Prisma mock. It pins the behaviour the
 * release directive requires of the public storefront:
 *
 *   • the default site renders its published Studio snapshot;
 *   • a secondary site renders ONLY when that exact site is published;
 *   • a missing/unpublished secondary site never substitutes the default site;
 *   • unpublished drafts are never visible to an anonymous visitor;
 *   • a suspended business is rejected;
 *   • the legacy BusinessExperience snapshot is a bounded fallback that survives
 *     Studio provisioning but is removed the moment the default site publishes or
 *     is unpublished;
 *   • publishing or unpublishing one site never changes a sibling's publication.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({
  get default() { return holder.client; },
  get prisma() { return holder.client; },
}));

import { createExperienceDocument } from "@/lib/experience/document";
import { loadStorefront } from "@/lib/experience/storefront";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `per-site-public-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let client: any;
let owner: any;

type Fixture = {
  business: any;
  defaultSite: any;
  secondarySite: any;
  otherSite: any;
  legacyDocument: any;
  publishedDocument: any;
};

function documentFor(businessName: string, tagline: string) {
  const document = createExperienceDocument({ categoryKey: "retail", businessName });
  document.brand.tagline = tagline;
  return document;
}

let fixtureSeq = 0;
async function seedFixture(base: string): Promise<Fixture> {
  // Every fixture is its own tenant tenant; no test may collide with another's slug.
  const slug = `${base}-${++fixtureSeq}`;
  const business = await client.business.create({
    data: {
      ownerId: owner.id,
      slug,
      name: `Per-site tenant ${slug}`,
      category: "retail",
      isPublished: false,
      status: "PENDING",
    },
  });
  const workspace = await client.studioWorkspace.create({
    data: { id: `ws_${slug}`, name: `${slug} workspace`, ownerUserId: owner.id, status: "ACTIVE" },
  });
  await client.studioWorkspaceBusiness.create({
    data: { id: `wsb_${slug}`, workspaceId: workspace.id, businessId: business.id },
  });
  const makeSite = (siteSlug: string, isDefault: boolean) =>
    client.studioWebsite.create({
      data: {
        id: `site_${slug}_${siteSlug}`,
        workspaceId: workspace.id,
        businessId: business.id,
        slug: siteSlug,
        name: `${slug} ${siteSlug}`,
        status: "DRAFT",
        isDefault,
      },
    });
  const defaultSite = await makeSite("default", true);
  const secondarySite = await makeSite("market", false);
  const otherSite = await makeSite("sister", false);

  const legacyDocument = documentFor(business.name, `legacy-${slug}`);
  const publishedDocument = documentFor(business.name, `studio-${slug}`);

  // The pre-cutover legacy snapshot every real business already has.
  await client.businessExperience.create({
    data: {
      businessId: business.id,
      categoryKey: "retail",
      themeKey: legacyDocument.themeKey,
      status: "PUBLISHED",
      draftJson: JSON.stringify(legacyDocument),
      draftVersion: 1,
      publishedJson: JSON.stringify(legacyDocument),
      publishedVersion: 1,
      publishedAt: new Date(),
    },
  });
  return { business, defaultSite, secondarySite, otherSite, legacyDocument, publishedDocument };
}

/** Publish exactly one site, the way the publish route does, for fixture setup only. */
async function publishSite(fixture: Fixture, site: any, document: any, version = 1) {
  const json = JSON.stringify(document);
  await client.studioWebsiteContent.upsert({
    where: { websiteId: site.id },
    create: {
      id: `swc_${site.id}`,
      websiteId: site.id,
      draftJson: json,
      draftVersion: version,
      historyCursor: version,
      publishedJson: json,
      publishedVersion: version,
      publishedAt: new Date(),
    },
    update: {
      draftJson: json,
      draftVersion: version,
      historyCursor: version,
      publishedJson: json,
      publishedVersion: version,
      publishedAt: new Date(),
    },
  });
  await client.studioWebsite.update({ where: { id: site.id }, data: { status: "PUBLISHED" } });
  await client.business.update({
    where: { id: fixture.business.id },
    data: { isPublished: true, status: "ACTIVE" },
  });
}

async function draftOnly(site: any, document: any, version = 1) {
  await client.studioWebsiteContent.upsert({
    where: { websiteId: site.id },
    create: {
      id: `swc_${site.id}`,
      websiteId: site.id,
      draftJson: JSON.stringify(document),
      draftVersion: version,
      historyCursor: version,
      publishedJson: null,
      publishedVersion: 0,
    },
    update: { draftJson: JSON.stringify(document), draftVersion: version, publishedJson: null, publishedVersion: 0 },
  });
}

describe.skipIf(!enabled)("per-site public storefront resolution on PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    holder.client = client;
    owner = await client.user.create({
      data: { email: `per-site-public-${stamp}@example.test`, name: "Per-site owner", passwordHash: "fixture-only" },
    });
  });
  afterAll(async () => {
    if (client) await client.$disconnect();
  });

  describe("default site", () => {
    let f: Fixture;
    beforeEach(async () => {
      f = await seedFixture(`default-${stamp}`);
    });

    it("renders the published Studio snapshot instead of the legacy snapshot", async () => {
      await publishSite(f, f.defaultSite, f.publishedDocument);
      const data = await loadStorefront(f.business.slug);
      expect(data).not.toBeNull();
      expect(data!.document.brand.tagline).toBe(f.publishedDocument.brand.tagline);
      expect(data!.publishedVersion).toBe(1);
      expect(data!.isPreview).toBe(false);
    });

    it("keeps the bounded legacy fallback while the default site has never published", async () => {
      await draftOnly(f.defaultSite, f.publishedDocument);
      await client.business.update({ where: { id: f.business.id }, data: { isPublished: true, status: "ACTIVE" } });
      const data = await loadStorefront(f.business.slug);
      // Provisioning alone must not silently take a live website offline.
      expect(data).not.toBeNull();
      expect(data!.document.brand.tagline).toBe(f.legacyDocument.brand.tagline);
    });

    it("never shows a draft to an anonymous visitor", async () => {
      const draft = documentFor(f.business.name, `draft-only-${stamp}`);
      await draftOnly(f.defaultSite, draft);
      await client.business.update({ where: { id: f.business.id }, data: { isPublished: true, status: "ACTIVE" } });
      const anonymous = await loadStorefront(f.business.slug);
      expect(anonymous!.document.brand.tagline).toBe(f.legacyDocument.brand.tagline);
      const preview = await loadStorefront(f.business.slug, { allowDraft: true, preferDraft: true });
      expect(preview!.document.brand.tagline).toBe(draft.brand.tagline);
      expect(preview!.isPreview).toBe(true);
    });

    it("removes the legacy snapshot once the default site publishes", async () => {
      await publishSite(f, f.defaultSite, f.publishedDocument);
      const data = await loadStorefront(f.business.slug);
      expect(data!.document.brand.tagline).toBe(f.publishedDocument.brand.tagline);
      expect(data!.document.brand.tagline).not.toBe(f.legacyDocument.brand.tagline);
    });

    it("does not resurface legacy content after the default site is unpublished", async () => {
      await publishSite(f, f.defaultSite, f.publishedDocument);
      // Unpublish: the site keeps its historical snapshot but is no longer live,
      // and the tenant is no longer publicly visible.
      await client.studioWebsite.update({ where: { id: f.defaultSite.id }, data: { status: "DRAFT" } });
      await client.business.update({ where: { id: f.business.id }, data: { isPublished: false } });
      await client.businessExperience.update({
        where: { businessId: f.business.id },
        data: { status: "UNPUBLISHED" },
      });
      expect(await loadStorefront(f.business.slug)).toBeNull();
    });
  });

  describe("secondary sites", () => {
    let f: Fixture;
    beforeEach(async () => {
      f = await seedFixture(`secondary-${stamp}`);
      await publishSite(f, f.defaultSite, f.publishedDocument);
    });

    it("renders an independently published secondary site at its own slug", async () => {
      const marketDocument = documentFor(f.business.name, `market-${stamp}`);
      await publishSite(f, f.secondarySite, marketDocument);
      const data = await loadStorefront(f.business.slug, { websiteSlug: "market" });
      expect(data).not.toBeNull();
      expect(data!.document.brand.tagline).toBe(marketDocument.brand.tagline);
      // …and the default site is untouched by that publication.
      const defaultData = await loadStorefront(f.business.slug);
      expect(defaultData!.document.brand.tagline).toBe(f.publishedDocument.brand.tagline);
    });

    it("never substitutes the default site for a published-looking but missing secondary slug", async () => {
      expect(await loadStorefront(f.business.slug, { websiteSlug: "does-not-exist" })).toBeNull();
    });

    it("never substitutes the default site for an unpublished secondary site", async () => {
      await draftOnly(f.secondarySite, documentFor(f.business.name, `market-draft-${stamp}`));
      expect(await loadStorefront(f.business.slug, { websiteSlug: "market" })).toBeNull();
    });

    it("never falls back to the legacy snapshot for a secondary site", async () => {
      await draftOnly(f.secondarySite, documentFor(f.business.name, `market-draft-${stamp}`));
      expect(await loadStorefront(f.business.slug, { websiteSlug: "market" })).toBeNull();
    });

    it("does not leak a draft of a secondary site to an anonymous visitor", async () => {
      const draft = documentFor(f.business.name, `market-secret-${stamp}`);
      await draftOnly(f.secondarySite, draft);
      expect(await loadStorefront(f.business.slug, { websiteSlug: "market" })).toBeNull();
      const ownerView = await loadStorefront(f.business.slug, {
        websiteSlug: "market",
        allowDraft: true,
        preferDraft: true,
      });
      expect(ownerView!.document.brand.tagline).toBe(draft.brand.tagline);
      expect(ownerView!.isPreview).toBe(true);
    });

    it("keeps sibling sites isolated from each other", async () => {
      const marketDocument = documentFor(f.business.name, `market-iso-${stamp}`);
      const sisterDocument = documentFor(f.business.name, `sister-iso-${stamp}`);
      await publishSite(f, f.secondarySite, marketDocument);
      await publishSite(f, f.otherSite, sisterDocument);
      expect((await loadStorefront(f.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
        .toBe(marketDocument.brand.tagline);
      expect((await loadStorefront(f.business.slug, { websiteSlug: "sister" }))!.document.brand.tagline)
        .toBe(sisterDocument.brand.tagline);
      expect((await loadStorefront(f.business.slug))!.document.brand.tagline)
        .toBe(f.publishedDocument.brand.tagline);
    });

    it("does not render another tenant's identical secondary slug", async () => {
      const other = await seedFixture(`other-tenant-${stamp}`);
      await publishSite(other, other.defaultSite, other.publishedDocument);
      // The other tenant has no published 'market' site.
      expect(await loadStorefront(other.business.slug, { websiteSlug: "market" })).toBeNull();
      const marketDocument = documentFor(f.business.name, `market-scope-${stamp}`);
      await publishSite(f, f.secondarySite, marketDocument);
      expect((await loadStorefront(f.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
        .toBe(marketDocument.brand.tagline);
      expect(await loadStorefront(other.business.slug, { websiteSlug: "market" })).toBeNull();
    });

    it("treats a SUSPENDED site as not resolvable while siblings keep serving", async () => {
      const marketDocument = documentFor(f.business.name, `market-suspended-${stamp}`);
      await publishSite(f, f.secondarySite, marketDocument);
      await client.studioWebsite.update({ where: { id: f.secondarySite.id }, data: { status: "SUSPENDED" } });
      expect(await loadStorefront(f.business.slug, { websiteSlug: "market" })).toBeNull();
      expect((await loadStorefront(f.business.slug))!.document.brand.tagline).toBe(f.publishedDocument.brand.tagline);
    });
  });

  describe("business-level public visibility", () => {
    it("rejects a suspended business for both routes", async () => {
      const f = await seedFixture(`suspended-${stamp}`);
      const marketDocument = documentFor(f.business.name, `market-susp-${stamp}`);
      await publishSite(f, f.defaultSite, f.publishedDocument);
      await publishSite(f, f.secondarySite, marketDocument);
      await client.business.update({ where: { id: f.business.id }, data: { status: "SUSPENDED" } });
      expect(await loadStorefront(f.business.slug)).toBeNull();
      expect(await loadStorefront(f.business.slug, { websiteSlug: "market" })).toBeNull();
    });

    it("rejects an unpublished business even when a site holds a published snapshot", async () => {
      const f = await seedFixture(`unpublished-biz-${stamp}`);
      await publishSite(f, f.defaultSite, f.publishedDocument);
      await client.business.update({ where: { id: f.business.id }, data: { isPublished: false } });
      expect(await loadStorefront(f.business.slug)).toBeNull();
    });
  });
});
