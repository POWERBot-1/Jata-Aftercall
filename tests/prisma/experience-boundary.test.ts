/** Real Prisma/PostgreSQL tenant, draft, publication and restore boundaries. No DB or tenant mocks. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";
import { createExperienceDocument } from "@/lib/experience/document";

const mocks = vi.hoisted(() => ({ session: { current: null as any } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()), getSession: async () => mocks.session.current,
}));

import { GET as services } from "@/app/api/services/route";
import { PATCH as edit } from "@/app/api/experience/route";
import { POST as publish } from "@/app/api/experience/publish/route";
import { POST as restore } from "@/app/api/experience/versions/route";
import { loadStorefront } from "@/lib/experience/storefront";

const p = realPrismaConfigured ? sharedPrisma() : null;
const req = (path: string, body: unknown) => new Request(`https://jata.test${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe.skipIf(!realPrismaConfigured)("real Prisma: Website Studio foundation boundaries", () => {
  let business: any;
  let owner: any;
  let document: ReturnType<typeof createExperienceDocument>;

  beforeEach(async () => {
    // BusinessStatus and ExperienceStatus are separate enums; an unpublished business
    // is PENDING, while its experience is DRAFT. Keep this fixture schema-type-checked.
    const draftBusiness = { isPublished: false, status: "PENDING", logoUrl: "/fixture-logo.jpg" } satisfies
      Pick<Prisma.BusinessUncheckedCreateInput, "isPublished" | "status" | "logoUrl">;
    ({ business, owner } = await seedBusiness(p, draftBusiness));
    document = createExperienceDocument({ categoryKey: "food", businessName: business.name, phone: business.phone });
    document.brand.heroImageUrl = "/fixture-hero.jpg";
    await p.businessExperience.update({ where: { businessId: business.id }, data: {
      status: "DRAFT", draftJson: JSON.stringify(document), draftVersion: 1,
      publishedJson: null, publishedVersion: 0,
    } });
    await seedProduct(p, business.id);
    await p.service.create({ data: { businessId: business.id, title: "Private draft service", priceFrom: 300 } });
    mocks.session.current = null;
  });
  afterAll(async () => { if (p) await p.$disconnect(); });
  const signIn = () => { mocks.session.current = { userId: owner.id, email: owner.email, role: "CUSTOMER" }; };
  const snapshot = () => p.businessExperience.findUnique({ where: { businessId: business.id } });

  async function fixtureEntitlement() {
    // Synthetic PAID evidence in an ISOLATED test DB, not a live charge or provider HTTP proof.
    const plan = await p.planConfig.upsert({ where: { key: "INTERACTIVE_BUSINESS" }, update: {}, create: {
      key: "INTERACTIVE_BUSINESS", name: "Website Studio", priceKES: 999, durationDays: 30,
    } });
    await p.subscription.create({ data: {
      businessId: business.id, userId: owner.id, planId: plan.id, status: "ACTIVE",
      expiresAt: new Date(Date.now() + 86400000),
    } });
    await p.payment.create({ data: {
      reference: `studio-fixture-${uid()}`, businessId: business.id, userId: owner.id,
      planId: plan.id, amount: 99900, currency: "KES", status: "PAID",
    } });
  }

  it("anonymous and cross-tenant callers cannot read draft services", async () => {
    const url = new Request(`https://jata.test/api/services?businessId=${business.id}`);
    expect((await services(url)).status).toBe(404);
    const other = await seedBusiness(p);
    mocks.session.current = { userId: other.owner.id, email: other.owner.email, role: "CUSTOMER" };
    expect((await services(url)).status).toBe(404);
    signIn();
    const response = await services(url);
    expect(response.status).toBe(200);
    expect((await response.json()).services.map((entry: any) => entry.businessId)).toEqual([business.id]);
  });

  it("unpublished business flag blocks storefront reads even with an old published snapshot", async () => {
    await p.businessExperience.update({ where: { businessId: business.id }, data: { status: "PUBLISHED", publishedJson: JSON.stringify(document) } });
    expect(await loadStorefront(business.slug)).toBeNull();
    const data = await loadStorefront(business.slug, { allowDraft: true }); // trusted owner-authorized caller option
    expect(data?.isPreview).toBe(true);
  });

  it("owner draft preview reads do not mutate or publish any version", async () => {
    const before = await snapshot();
    const data = await loadStorefront(business.slug, { allowDraft: true, preferDraft: true });
    expect(data?.isPreview).toBe(true);
    expect(data?.items.every((item) => item.name.startsWith("Chicken"))).toBe(true);
    expect((await snapshot()).draftJson).toBe(before.draftJson);
    expect((await snapshot()).publishedJson).toBeNull();
    expect(await p.experienceVersion.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("cross-tenant whole-document writes fail with real ownership checks", async () => {
    const other = await seedBusiness(p);
    mocks.session.current = { userId: other.owner.id, email: other.owner.email, role: "CUSTOMER" };
    const before = await snapshot();
    expect((await edit(req("/api/experience", { businessId: business.id, expectedDraftVersion: 1, document }))).status).toBe(403);
    expect((await snapshot()).draftJson).toBe(before.draftJson);
  });

  it("malformed/unsupported configuration cannot replace a draft", async () => {
    signIn();
    const before = await snapshot();
    expect((await edit(req("/api/experience", { businessId: business.id, expectedDraftVersion: 1, document: { ...document, version: 2 } }))).status).toBe(400);
    expect((await snapshot()).draftVersion).toBe(1);
    expect((await snapshot()).draftJson).toBe(before.draftJson);
  });

  it("unpaid owner cannot publish and no snapshot or business-publication change is written", async () => {
    signIn();
    expect((await publish(req("/api/experience/publish", { businessId: business.id, expectedDraftVersion: 1 }))).status).toBe(403);
    expect((await snapshot()).publishedJson).toBeNull();
    expect((await p.business.findUnique({ where: { id: business.id } })).isPublished).toBe(false);
    expect(await p.experienceVersion.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("invalid stored JSON is refused, not repaired and published", async () => {
    signIn();
    await fixtureEntitlement();
    await p.businessExperience.update({ where: { businessId: business.id }, data: { draftJson: "{broken" } });
    const response = await publish(req("/api/experience/publish", { businessId: business.id, expectedDraftVersion: 1 }));
    expect(response.status).toBe(409);
    expect((await response.json()).requires).toBe("SCHEMA");
    expect((await snapshot()).publishedJson).toBeNull();
    expect(await p.experienceVersion.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("entitled publication snapshots, editing and restore affect draft only until explicit republish", async () => {
    signIn();
    await fixtureEntitlement();
    const body = (version: number) => ({ businessId: business.id, expectedDraftVersion: version });
    expect((await publish(req("/api/experience/publish", body(1)))).status).toBe(200);
    const firstLive = (await snapshot()).publishedJson;
    const changed = { ...document, brand: { ...document.brand, tagline: "Updated owner-reviewed direction" } };
    expect((await edit(req("/api/experience", { ...body(1), document: changed }))).status).toBe(200);
    expect((await snapshot()).publishedJson).toBe(firstLive);
    expect((await publish(req("/api/experience/publish", body(2)))).status).toBe(200);
    const secondLive = (await snapshot()).publishedJson;
    expect(secondLive).not.toBe(firstLive);
    expect((await restore(req("/api/experience/versions", { ...body(2), version: 1 }))).status).toBe(200);
    const after = await snapshot();
    expect(after.draftVersion).toBe(3);
    expect(after.publishedJson).toBe(secondLive);
    expect(JSON.parse(after.draftJson).brand.tagline).not.toBe(changed.brand.tagline);
    expect(await p.experienceVersion.count({ where: { businessId: business.id } })).toBe(2);
  });
});
