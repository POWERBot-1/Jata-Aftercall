/** Real disposable Postgres art-direction preview/apply/publication/history. Auth session mocked; no provider/upload calls. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";
import { createExperienceDocument } from "@/lib/experience/document";
import { buildArtDirectedCandidate } from "@/lib/experience/artDirector";

const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), getSession: async () => auth.session }));
import { POST as preview } from "@/app/api/experience/variant/route";
import { PATCH as edit } from "@/app/api/experience/route";
import { POST as publish } from "@/app/api/experience/publish/route";
import { POST as restore } from "@/app/api/experience/versions/route";
import { loadStorefront } from "@/lib/experience/storefront";

const p = realPrismaConfigured ? sharedPrisma() : null;
const req = (path: string, body: unknown) => new Request(`https://jata.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
describe.skipIf(!realPrismaConfigured)("real Prisma: v2 art direction", () => {
  let owner: any, business: any, product: any, source: ReturnType<typeof createExperienceDocument>;
  const snapshot = () => p.businessExperience.findUnique({ where: { businessId: business.id } });
  const payload = (expectedDraftVersion = 1) => ({ businessId: business.id, expectedDraftVersion });
  beforeEach(async () => {
    ({ owner, business } = await seedBusiness(p, { isPublished: false, status: "PENDING", logoUrl: "/fixture-logo.jpg" }));
    source = createExperienceDocument({ categoryKey: "food", businessName: business.name, phone: business.phone });
    source.brand.heroImageUrl = "/fixture-image.jpg";
    await p.businessExperience.update({ where: { businessId: business.id }, data: { draftJson: JSON.stringify(source), draftVersion: 1, status: "DRAFT", publishedJson: null, publishedVersion: 0 } });
    product = await seedProduct(p, business.id, { basePriceKES: 149, name: `Authoritative ${uid()}` });
    auth.session = { userId: owner.id, email: owner.email, role: "CUSTOMER" };
  });
  afterAll(async () => { if (p) await p.$disconnect(); });
  async function entitlement() {
    const plan = await p.planConfig.upsert({ where: { key: "INTERACTIVE_BUSINESS" }, update: {}, create: { key: "INTERACTIVE_BUSINESS", name: "Website Studio", priceKES: 999, durationDays: 30 } });
    await p.subscription.create({ data: { businessId: business.id, userId: owner.id, planId: plan.id, status: "ACTIVE", expiresAt: new Date(Date.now() + 86400000) } });
    await p.payment.create({ data: { reference: `art-fixture-${uid()}`, businessId: business.id, userId: owner.id, planId: plan.id, amount: 99900, currency: "KES", status: "PAID" } });
  }
  it("previews a safe v2 structure from real owned catalogue counts without saving any revision", async () => {
    const before = await snapshot();
    const response = await preview(req("/api/experience/variant", { businessId: business.id, seed: "owner:preview", family: "product-first", brief: { goal: "sell" } }));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.candidate.version).toBe(2); expect(body.candidate.artDirection.family).toBe("product-first");
    expect(body.providerCalled).toBe(false); expect(body.saved).toBe(false);
    expect((await snapshot()).draftJson).toBe(before.draftJson);
    expect(await p.experienceDraftRevision.count({ where: { businessId: business.id } })).toBe(0);
    expect((await p.product.findUnique({ where: { id: product.id } })).basePriceKES).toBe(149);
  });
  it("rejects anonymous/foreign-tenant preview/apply before exposing the owner's content", async () => {
    auth.session = null;
    expect((await preview(req("/api/experience/variant", { businessId: business.id }))).status).toBe(401);
    const other = await seedBusiness(p); auth.session = { userId: other.owner.id, email: other.owner.email, role: "CUSTOMER" };
    expect((await preview(req("/api/experience/variant", { businessId: business.id, brief: { goal: "invalid" } }))).status).toBe(403);
    const directed = buildArtDirectedCandidate(source, "owner:foreign").document;
    expect((await edit(req("/api/experience", { ...payload(), document: directed }))).status).toBe(403);
    expect(JSON.parse((await snapshot()).draftJson).version).toBe(1);
  });
  it("applies only the reviewed draft version, records history and preserves authoritative commerce", async () => {
    const candidate = buildArtDirectedCandidate(source, "owner:apply", { family: "marketplace" }).document;
    expect((await edit(req("/api/experience", { ...payload(), document: candidate }))).status).toBe(200);
    const after = await snapshot(); expect(after.draftVersion).toBe(2); expect(JSON.parse(after.draftJson).artDirection.family).toBe("marketplace");
    expect(after.publishedJson).toBeNull();
    expect((await edit(req("/api/experience", { ...payload(), document: candidate }))).status).toBe(409);
    expect(await p.experienceDraftRevision.count({ where: { businessId: business.id } })).toBe(1);
    const actual = await p.product.findUnique({ where: { id: product.id } }); expect(actual.name).toBe(product.name); expect(actual.basePriceKES).toBe(149);
  });
  it("refuses raw/executable/unknown v2 recipes without any write", async () => {
    const candidate = buildArtDirectedCandidate(source, "owner:unsafe").document;
    const response = await edit(req("/api/experience", { ...payload(), document: { ...candidate, artDirection: { ...candidate.artDirection, shader: "alert(1)" } } }));
    expect(response.status).toBe(400); expect((await snapshot()).draftVersion).toBe(1);
    expect(await p.experienceDraftRevision.count({ where: { businessId: business.id } })).toBe(0);
  });
  it("an unpaid v2 candidate cannot publish or make the business public", async () => {
    const candidate = buildArtDirectedCandidate(source, "owner:unpaid").document;
    expect((await edit(req("/api/experience", { ...payload(), document: candidate }))).status).toBe(200);
    expect((await publish(req("/api/experience/publish", payload(2)))).status).toBe(403);
    expect((await p.business.findUnique({ where: { id: business.id } })).isPublished).toBe(false);
    expect((await snapshot()).publishedJson).toBeNull();
  });
  it("publishes entitled v2 HTML config, then restores v1 to draft without altering live v2 or prices", async () => {
    await entitlement();
    expect((await publish(req("/api/experience/publish", payload()))).status).toBe(200);
    const candidate = buildArtDirectedCandidate(source, "owner:live", { family: "editorial" }).document;
    expect((await edit(req("/api/experience", { ...payload(), document: candidate }))).status).toBe(200);
    expect((await publish(req("/api/experience/publish", payload(2)))).status).toBe(200);
    const live = (await snapshot()).publishedJson;
    const storefront = await loadStorefront(business.slug);
    expect(storefront.document.artDirection.family).toBe("editorial"); expect(storefront.theme.treatment.heroStyle).toBe("split");
    expect(storefront.items.find((item) => item.id === product.id).price).toBe(149);
    expect((await restore(req("/api/experience/versions", { ...payload(2), version: 1 }))).status).toBe(200);
    const restored = await snapshot(); expect(restored.draftVersion).toBe(3); expect(JSON.parse(restored.draftJson).version).toBe(1); expect(restored.publishedJson).toBe(live);
  });
});
