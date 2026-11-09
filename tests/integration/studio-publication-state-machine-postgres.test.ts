/**
 * End-to-end acceptance for the Website Studio 2.0 publication state machine,
 * driven through the REAL route handlers against a migrated PostgreSQL database.
 *
 * This suite exists because the two release-blocking defects found in the cutover
 * were only visible when a route's writes were followed by the public loader's reads:
 *
 *   • unpublishing the DEFAULT site cleared `business.isPublished`, which the loader
 *     also honoured for SECONDARY sites, so a sibling site that was still published
 *     stopped rendering for customers (directive §4: a business-wide flag must not
 *     stand in for per-site publication state);
 *
 *   • the legacy `BusinessExperience` fallback was gated on "no Studio website row
 *     exists" rather than "this website has never published", so merely provisioning
 *     a default Studio site silently took a live customer website offline.
 *
 * Every assertion below reads back through `loadStorefront`, i.e. the same function the
 * public `/b/...` routes call, so a route that writes the wrong state fails here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any, session: null as any }));
vi.mock("@/lib/db", () => ({
  get default() { return holder.client; },
  get prisma() { return holder.client; },
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => holder.session) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

import { createExperienceDocument } from "@/lib/experience/document";
import { loadStorefront } from "@/lib/experience/storefront";
import { POST as publishRoute } from "@/app/api/studio/websites/publish/route";
import { POST as rollbackRoute } from "@/app/api/studio/websites/rollback/route";
import { POST as legacyPublishRoute } from "@/app/api/experience/publish/route";
import { ensureStudioWebsiteContent } from "@/lib/experience/site-content";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `state-machine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let client: any;
let seq = 0;

function request(body: unknown) {
  return new Request("http://localhost/api/studio/websites/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A document that satisfies the REAL publish gate (lib/experience/validate.ts):
 * contact details, a primary visual, a visible hero and a browseable catalogue. The
 * gate is not weakened for this test — the fixture is made genuinely publishable.
 */
function documentFor(name: string, tagline: string) {
  const document = createExperienceDocument({ categoryKey: "retail", businessName: name });
  document.brand.tagline = tagline;
  document.brand.heroImageUrl = "/fixture-hero.jpg";
  document.settings.phone = "+254700000001";
  return document;
}

type Tenant = {
  business: any;
  owner: any;
  defaultSite: any;
  secondarySite: any;
  defaultDoc: any;
  secondaryDoc: any;
  readVersions: (site: any) => Promise<{ draftVersion: number; publishedVersion: number }>;
};

/**
 * Provision a tenant with a paid, entitled publication right (synthetic rows in this
 * isolated database only — no live charge, no provider call) plus one published
 * default site and one published secondary site, both written through the real
 * publish route so the persisted state is exactly what the product produces.
 */
async function provisionPublishedTenant(): Promise<Tenant> {
  const slug = `sm-${stamp}-${++seq}`;
  const owner = await client.user.create({
    data: { email: `${slug}@example.test`, name: `Owner ${slug}`, passwordHash: "fixture-only" },
  });
  holder.session = { userId: owner.id, email: owner.email, role: "CUSTOMER", name: owner.name };

  const business = await client.business.create({
    // A live pre-cutover tenant: its legacy BusinessExperience is already public.
    data: { ownerId: owner.id, slug, name: `Tenant ${slug}`, category: "retail", isPublished: true, status: "ACTIVE" },
  });
  const plan = await client.planConfig.upsert({
    where: { key: "INTERACTIVE_BUSINESS" },
    update: {},
    create: { key: "INTERACTIVE_BUSINESS", name: "Website Studio", priceKES: 999, durationDays: 30 },
  });
  await client.subscription.create({
    data: { businessId: business.id, userId: owner.id, planId: plan.id, status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await client.payment.create({
    data: {
      reference: `sm-fixture-${slug}`, businessId: business.id, userId: owner.id,
      planId: plan.id, amount: 99900, currency: "KES", status: "PAID",
    },
  });

  const workspace = await client.studioWorkspace.create({
    data: { id: `ws_${slug}`, name: `${slug} workspace`, ownerUserId: owner.id, status: "ACTIVE" },
  });
  await client.studioWorkspaceBusiness.create({ data: { id: `wsb_${slug}`, workspaceId: workspace.id, businessId: business.id } });
  const makeSite = (siteSlug: string, isDefault: boolean) =>
    client.studioWebsite.create({
      data: {
        id: `site_${slug}_${siteSlug}`, workspaceId: workspace.id, businessId: business.id,
        slug: siteSlug, name: `${slug} ${siteSlug}`, status: "DRAFT", isDefault,
      },
    });
  const defaultSite = await makeSite("default", true);
  const secondarySite = await makeSite("market", false);
  for (const site of [defaultSite, secondarySite]) {
    await client.studioWebsiteMember.create({
      data: { id: `m_${site.id}`, websiteId: site.id, userId: owner.id, role: "OWNER", status: "ACTIVE" },
    });
  }
  await client.studioWorkspaceMember.create({
    data: { id: `wm_${slug}`, workspaceId: workspace.id, userId: owner.id, role: "OWNER", status: "ACTIVE" },
  });

  const defaultDoc = documentFor(business.name, `default-${slug}`);
  const secondaryDoc = documentFor(business.name, `market-${slug}`);

  // A legacy pre-cutover snapshot, as every real business already has today.
  await client.businessExperience.create({
    data: {
      businessId: business.id, categoryKey: "retail", themeKey: defaultDoc.themeKey,
      status: "PUBLISHED", draftJson: JSON.stringify(defaultDoc), draftVersion: 1,
      publishedJson: JSON.stringify(defaultDoc), publishedVersion: 1, publishedAt: new Date(),
    },
  });
  // Provision content through the REAL helper the app uses. It materialises the site's
  // content row AND mints the migrated version/revision rows (`swv_<site>_1`,
  // `swdr_<site>_1`) that a naive create with a deterministic id would collide with.
  await ensureStudioWebsiteContent(defaultSite.id, business.id);
  await ensureStudioWebsiteContent(secondarySite.id, business.id);
  await client.studioWebsiteContent.update({
    where: { websiteId: defaultSite.id },
    data: { draftJson: JSON.stringify(defaultDoc), draftVersion: 1, historyCursor: 1 },
  });
  await client.studioWebsiteContent.update({
    where: { websiteId: secondarySite.id },
    data: { draftJson: JSON.stringify(secondaryDoc), draftVersion: 1, historyCursor: 1 },
  });
  // The suite asserts the STATE MACHINE's behaviour, not particular numbers, so the
  // expected versions are read back from the rows the provisioning path actually wrote
  // (a migrated site inherits publishedVersion 1 from the legacy row).
  const readVersions = async (site: any) => {
    const content = await client.studioWebsiteContent.findUnique({ where: { websiteId: site.id } });
    return { draftVersion: Number(content.draftVersion), publishedVersion: Number(content.publishedVersion) };
  };

  // One active product so the catalogue check passes for a genuinely ready site.
  await client.product.create({
    data: { businessId: business.id, name: `${slug} shelf item`, basePriceKES: 500, isActive: true },
  });
  return { business, owner, defaultSite, secondarySite, defaultDoc, secondaryDoc, readVersions };
}

async function publish(site: any, expectedDraftVersion: number, expectedPublishedVersion = 0) {
  return publishRoute(request({ websiteId: site.id, expectedDraftVersion, expectedPublishedVersion, action: "publish" }));
}

async function unpublish(site: any, expectedDraftVersion: number, expectedPublishedVersion: number) {
  return publishRoute(request({
    websiteId: site.id, expectedDraftVersion, expectedPublishedVersion, action: "unpublish",
  }));
}

async function rollback(site: any, targetVersion: number, expectedDraftVersion: number, expectedPublishedVersion: number) {
  return rollbackRoute(request({
    websiteId: site.id, targetVersion, expectedDraftVersion, expectedPublishedVersion,
  }));
}

async function legacyUnpublish(businessId: string) {
  return legacyPublishRoute(new Request("http://localhost/api/experience/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, action: "unpublish" }),
  }));
}

async function legacyPublish(businessId: string, expectedDraftVersion: number) {
  return legacyPublishRoute(new Request("http://localhost/api/experience/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, expectedDraftVersion }),
  }));
}

describe.skipIf(!enabled)("publication state machine through the real routes on PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    holder.client = client;
  });
  afterAll(async () => {
    if (client) await client.$disconnect();
  });

  it("publishes each site independently and renders each at its own URL", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);

    const site = await client.studioWebsite.findUnique({ where: { id: t.secondarySite.id } });
    expect(site.status).toBe("PUBLISHED");
    expect((await loadStorefront(t.business.slug))!.document.brand.tagline).toBe(t.defaultDoc.brand.tagline);
    expect((await loadStorefront(t.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
      .toBe(t.secondaryDoc.brand.tagline);
  });

  it("publishes a newer default draft without touching a sibling's published snapshot", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);
    const siblingBefore = await client.studioWebsiteContent.findUnique({ where: { websiteId: t.secondarySite.id } });

    const newer = documentFor(t.business.name, `default-v2-${stamp}`);
    const d1 = await t.readVersions(t.defaultSite);
    await client.studioWebsiteContent.update({
      where: { websiteId: t.defaultSite.id },
      data: { draftJson: JSON.stringify(newer), draftVersion: d1.draftVersion + 1, historyCursor: d1.draftVersion + 1 },
    });
    // A draft save must never alter what customers see.
    expect((await loadStorefront(t.business.slug))!.document.brand.tagline).toBe(t.defaultDoc.brand.tagline);

    const d2 = await t.readVersions(t.defaultSite);
    expect((await publish(t.defaultSite, d2.draftVersion, d2.publishedVersion)).status).toBe(200);
    expect((await loadStorefront(t.business.slug))!.document.brand.tagline).toBe(newer.brand.tagline);

    const siblingAfter = await client.studioWebsiteContent.findUnique({ where: { websiteId: t.secondarySite.id } });
    expect(siblingAfter.publishedVersion).toBe(siblingBefore.publishedVersion);
    expect(siblingAfter.publishedJson).toBe(siblingBefore.publishedJson);
    expect((await loadStorefront(t.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
      .toBe(t.secondaryDoc.brand.tagline);
  });

  it("keeps a published sibling live when the DEFAULT site is unpublished, and never revives the legacy page", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);

    const d1 = await t.readVersions(t.defaultSite);
    const response = await unpublish(t.defaultSite, d1.draftVersion, d1.publishedVersion);
    expect(response.status).toBe(200);

    // The takedown is explicit, so it is recorded as UNPUBLISHED, never as DRAFT.
    expect((await client.studioWebsite.findUnique({ where: { id: t.defaultSite.id } })).status).toBe("UNPUBLISHED");
    // The default URL is gone — and the tenant's old legacy snapshot does NOT reappear.
    expect(await loadStorefront(t.business.slug)).toBeNull();
    // The tenant stays publicly routable because a sibling is still live.
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(true);
    // …and that sibling still renders for customers.
    expect((await loadStorefront(t.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
      .toBe(t.secondaryDoc.brand.tagline);
  });

  it("keeps the default site live when a SECONDARY site is unpublished", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);

    const s1 = await t.readVersions(t.secondarySite);
    expect((await unpublish(t.secondarySite, s1.draftVersion, s1.publishedVersion)).status).toBe(200);

    expect(await loadStorefront(t.business.slug, { websiteSlug: "market" })).toBeNull();
    expect((await loadStorefront(t.business.slug))!.document.brand.tagline).toBe(t.defaultDoc.brand.tagline);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(true);
  });

  it("clears tenant visibility only when the last published site is unpublished", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);

    const s1 = await t.readVersions(t.secondarySite);
    expect((await unpublish(t.secondarySite, s1.draftVersion, s1.publishedVersion)).status).toBe(200);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(true);

    const d1 = await t.readVersions(t.defaultSite);
    expect((await unpublish(t.defaultSite, d1.draftVersion, d1.publishedVersion)).status).toBe(200);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(false);
    expect(await loadStorefront(t.business.slug)).toBeNull();
    expect(await loadStorefront(t.business.slug, { websiteSlug: "market" })).toBeNull();
  });

  it("rejects publishing a site an operator has suspended", async () => {
    const t = await provisionPublishedTenant();
    const s0 = await t.readVersions(t.secondarySite);
    await client.studioWebsite.update({ where: { id: t.secondarySite.id }, data: { status: "SUSPENDED" } });
    const response = await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await client.studioWebsite.findUnique({ where: { id: t.secondarySite.id } })).status).toBe("SUSPENDED");
  });

  it("refuses a stale unpublish compare-and-swap", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    const d1 = await t.readVersions(t.defaultSite);
    const response = await unpublish(t.defaultSite, d1.draftVersion + 99, d1.publishedVersion);
    expect(response.status).toBe(409);
    expect((await client.studioWebsite.findUnique({ where: { id: t.defaultSite.id } })).status).toBe("PUBLISHED");
  });

  it("does not let per-site publish reactivate a suspended business", async () => {
    const t = await provisionPublishedTenant();
    const s0 = await t.readVersions(t.secondarySite);
    await client.business.update({ where: { id: t.business.id }, data: { status: "SUSPENDED" } });
    const response = await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion);
    expect(response.status).toBe(409);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).status).toBe("SUSPENDED");
    expect((await client.studioWebsite.findUnique({ where: { id: t.secondarySite.id } })).status).toBe("DRAFT");
  });

  it("does not let rollback reactivate a suspended business or alter its site", async () => {
    const t = await provisionPublishedTenant();
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);
    const current = await t.readVersions(t.secondarySite);
    const before = await client.studioWebsiteContent.findUnique({ where: { websiteId: t.secondarySite.id } });
    await client.business.update({ where: { id: t.business.id }, data: { status: "SUSPENDED" } });
    const response = await rollback(t.secondarySite, current.publishedVersion, current.draftVersion, current.publishedVersion);
    const after = await client.studioWebsiteContent.findUnique({ where: { websiteId: t.secondarySite.id } });
    expect(response.status).toBe(409);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).status).toBe("SUSPENDED");
    expect((await client.studioWebsite.findUnique({ where: { id: t.secondarySite.id } })).status).toBe("PUBLISHED");
    expect(after.publishedJson).toBe(before.publishedJson);
    expect(after.publishedVersion).toBe(before.publishedVersion);
    expect(after.draftJson).toBe(before.draftJson);
    expect(after.draftVersion).toBe(before.draftVersion);
  });

  it("does not let the legacy publish UI reactivate a suspended business", async () => {
    const t = await provisionPublishedTenant();
    const experience = await client.businessExperience.findUnique({ where: { businessId: t.business.id } });
    await client.business.update({ where: { id: t.business.id }, data: { status: "SUSPENDED" } });
    const response = await legacyPublish(t.business.id, experience.draftVersion);
    expect(response.status).toBe(409);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).status).toBe("SUSPENDED");
    expect((await client.businessExperience.findUnique({ where: { businessId: t.business.id } })).status).toBe("PUBLISHED");
  });

  it("keeps a published secondary site live when the legacy default-site UI unpublishes", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);

    const response = await legacyUnpublish(t.business.id);
    expect(response.status).toBe(200);
    expect((await client.studioWebsite.findUnique({ where: { id: t.defaultSite.id } })).status).toBe("UNPUBLISHED");
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(true);
    expect(await loadStorefront(t.business.slug)).toBeNull();
    expect((await loadStorefront(t.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
      .toBe(t.secondaryDoc.brand.tagline);
  });

  it("reopens the tenant public gate when rollback restores the last unpublished secondary site", async () => {
    const t = await provisionPublishedTenant();
    const d0 = await t.readVersions(t.defaultSite);
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);

    const d1 = await t.readVersions(t.defaultSite);
    expect((await unpublish(t.defaultSite, d1.draftVersion, d1.publishedVersion)).status).toBe(200);
    const s1 = await t.readVersions(t.secondarySite);
    expect((await unpublish(t.secondarySite, s1.draftVersion, s1.publishedVersion)).status).toBe(200);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(false);
    expect(await loadStorefront(t.business.slug, { websiteSlug: "market" })).toBeNull();

    const current = await t.readVersions(t.secondarySite);
    const restored = await rollback(t.secondarySite, current.publishedVersion, current.draftVersion, current.publishedVersion);
    expect(restored.status).toBe(200);
    expect((await client.business.findUnique({ where: { id: t.business.id } })).isPublished).toBe(true);
    expect((await loadStorefront(t.business.slug, { websiteSlug: "market" }))!.document.brand.tagline)
      .toBe(t.secondaryDoc.brand.tagline);
    expect(await loadStorefront(t.business.slug)).toBeNull();
  });

  it("refuses rollback of an operator-suspended site without changing its content", async () => {
    const t = await provisionPublishedTenant();
    const s0 = await t.readVersions(t.secondarySite);
    expect((await publish(t.secondarySite, s0.draftVersion, s0.publishedVersion)).status).toBe(200);
    await client.studioWebsite.update({ where: { id: t.secondarySite.id }, data: { status: "SUSPENDED" } });
    const current = await t.readVersions(t.secondarySite);
    const before = await client.studioWebsiteContent.findUnique({ where: { websiteId: t.secondarySite.id } });
    const response = await rollback(t.secondarySite, current.publishedVersion, current.draftVersion, current.publishedVersion);
    const after = await client.studioWebsiteContent.findUnique({ where: { websiteId: t.secondarySite.id } });
    expect(response.status).toBe(409);
    expect((await client.studioWebsite.findUnique({ where: { id: t.secondarySite.id } })).status).toBe("SUSPENDED");
    expect(after.publishedJson).toBe(before.publishedJson);
    expect(after.publishedVersion).toBe(before.publishedVersion);
    expect(after.draftJson).toBe(before.draftJson);
    expect(after.draftVersion).toBe(before.draftVersion);
  });

  it("does not resurrect a legacy snapshot when a provisioned site has never published", async () => {
    const t = await provisionPublishedTenant();
    // No publish call at all: the site exists (DRAFT) and the legacy row is live.
    const data = await loadStorefront(t.business.slug);
    // Provisioning alone must not silently take the customer's existing website offline.
    expect(data).not.toBeNull();
    expect(data!.document.brand.tagline).toBe(t.defaultDoc.brand.tagline);
    // …but after the first real publication the site's own snapshot is the source.
    const d0 = await t.readVersions(t.defaultSite);
    expect((await publish(t.defaultSite, d0.draftVersion, d0.publishedVersion)).status).toBe(200);
    expect((await client.studioWebsite.findUnique({ where: { id: t.defaultSite.id } })).status).toBe("PUBLISHED");
  });
});
