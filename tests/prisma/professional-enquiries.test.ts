/** Real disposable DB persistence/replay/tenant guards. Owner session mocked here; real cookies are verified separately in required browser CI. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";
import { createExperienceDocument } from "@/lib/experience/document";
const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (original) => ({ ...await original<typeof import("@/lib/auth")>(), getSession: async () => auth.session }));
import { POST, GET } from "@/app/api/storefront/enquiry/route";
import { listProfessionalEnquiries } from "@/lib/experience/enquiries";
const p = realPrismaConfigured ? sharedPrisma() : null;
let ip = 30;
describe.skipIf(!realPrismaConfigured)("real Prisma: request-only professional enquiries", () => {
  const created: { id: string; ownerId: string }[] = [];
  let business: any, owner: any, service: any;
  const payload = () => ({ slug: business.slug, serviceId: service.id, customerName: "QA Customer", customerPhone: "0712345678", notes: "Owned request only", idempotencyKey: `qa-enquiry-${uid()}` });
  const post = (body: unknown) => POST(new Request("https://jata.test/api/storefront/enquiry", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` }, body: JSON.stringify(body) }));
  beforeEach(async () => {
    vi.stubEnv("VERCEL", "1"); // Synthetic X-Forwarded-For headers model the trusted platform edge.
    ({ business, owner } = await seedBusiness(p, { category: "professional", isPublished: true, status: "ACTIVE" }));
    created.push({ id: business.id, ownerId: owner.id });
    const doc = createExperienceDocument({ categoryKey: "professional", businessName: business.name, phone: business.phone });
    await p.businessExperience.update({ where: { businessId: business.id }, data: { status: "PUBLISHED", categoryKey: "professional", publishedJson: JSON.stringify(doc) } });
    service = await p.service.create({ data: { businessId: business.id, title: "Authoritative quote service", pricingType: "QUOTE", priceFrom: null, bookingEnabled: false, isActive: true, depositKES: 500 } });
    auth.session = { userId: owner.id, email: owner.email, role: "CUSTOMER" };
  });
  afterAll(async () => {
    if (!p) return;
    for (const fixture of created) { await p.business.deleteMany({ where: { id: fixture.id, ownerId: fixture.ownerId } }); await p.user.deleteMany({ where: { id: fixture.ownerId } }); }
    await p.$disconnect();
    vi.unstubAllEnvs();
  });
  it("durably stores only the owned service request, with no fake booking/order/payment or deposit change", async () => {
    const result = await post(payload()); expect(result.status).toBe(201); const response = await result.json();
    const saved = await p.aIQualityEvent.findUniqueOrThrow({ where: { id: response.enquiry.id } });
    const record = JSON.parse(saved.metadata);
    expect(saved.businessId).toBe(business.id); expect(record.referenceId).toBe(service.id); expect(record.serviceName).toBe(service.title);
    expect(record.transactionalOnly).toBe(true); expect(record.status).toBe("RECEIVED"); expect(record).not.toHaveProperty("startAt");
    expect(await p.booking.count({ where: { businessId: business.id } })).toBe(0);
    expect(await p.order.count({ where: { businessId: business.id } })).toBe(0); expect(await p.payment.count({ where: { businessId: business.id } })).toBe(0);
    expect((await p.service.findUnique({ where: { id: service.id } })).depositKES).toBe(500);
    expect((await listProfessionalEnquiries(business.id))[0].id).toBe(response.enquiry.id);
  });
  it("handles concurrent duplicate/retry with one primary-key persisted request and no duplicate analytics", async () => {
    const body = payload(); const responses = await Promise.all([post(body), post(body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const values = await Promise.all(responses.map((response) => response.json())); expect(new Set(values.map((value) => value.enquiry.id)).size).toBe(1);
    expect(await p.aIQualityEvent.count({ where: { businessId: business.id, eventType: "LEAD_GENERAL_INQUIRY" } })).toBe(1);
    expect(await p.analyticsEvent.count({ where: { businessId: business.id, eventType: "ENQUIRY_SUBMITTED" } })).toBe(1);
    expect((await post({ ...body, notes: "Changed requirements" })).status).toBe(409);
  });
  it("rejects foreign service IDs and forged tenant/money fields without writes", async () => {
    const other = await seedBusiness(p); created.push({ id: other.business.id, ownerId: other.owner.id });
    const foreign = await p.service.create({ data: { businessId: other.business.id, title: "Foreign private service", isActive: true } });
    expect((await post({ ...payload(), serviceId: foreign.id })).status).toBe(404);
    expect((await post({ ...payload(), businessId: other.business.id, amount: 1 })).status).toBe(400);
    expect(await p.aIQualityEvent.count({ where: { businessId: business.id, eventType: "LEAD_GENERAL_INQUIRY" } })).toBe(0);
  });
  it("rejects inactive services and draft-only or suspended businesses", async () => {
    await p.service.update({ where: { id: service.id }, data: { isActive: false } }); expect((await post(payload())).status).toBe(404);
    await p.service.update({ where: { id: service.id }, data: { isActive: true } });
    await p.business.update({ where: { id: business.id }, data: { isPublished: false } }); expect((await post(payload())).status).toBe(404);
    await p.business.update({ where: { id: business.id }, data: { isPublished: true, status: "SUSPENDED" } }); expect((await post(payload())).status).toBe(404);
    expect(await p.aIQualityEvent.count({ where: { businessId: business.id, eventType: "LEAD_GENERAL_INQUIRY" } })).toBe(0);
  });
  it("only the owning authenticated tenant receives customer contacts and no private replay hash", async () => {
    await post(payload()); const req = () => new Request(`https://jata.test/api/storefront/enquiry?businessId=${business.id}`);
    auth.session = null; expect((await GET(req())).status).toBe(401);
    const other = await seedBusiness(p); created.push({ id: other.business.id, ownerId: other.owner.id });
    auth.session = { userId: other.owner.id, email: other.owner.email, role: "CUSTOMER" }; expect((await GET(req())).status).toBe(403);
    auth.session = { userId: owner.id, email: owner.email, role: "CUSTOMER" };
    const response = await GET(req()); expect(response.status).toBe(200); const data = await response.json();
    expect(data.enquiries[0].customerPhone).toBe("0712345678"); expect(JSON.stringify(data)).not.toContain("requestHash");
  });
});
