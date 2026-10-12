import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";
const h = vi.hoisted(() => ({ business: null as any, experience: null as any, service: null as any,
  rows: new Map<string, any>(), create: vi.fn(), findService: vi.fn(), analytics: vi.fn(), guard: vi.fn(), session: null as any }));
vi.mock("@/lib/db", () => ({ default: {
  business: { findUnique: async () => h.business }, businessExperience: { findUnique: async () => h.experience }, service: { findFirst: h.findService },
  aIQualityEvent: { create: h.create, findUnique: async ({ where }: any) => h.rows.get(where.id) || null,
    findMany: async ({ where }: any) => [...h.rows.values()].filter((row) => row.businessId === where.businessId) },
} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => h.session }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: h.guard }));
vi.mock("@/lib/analytics", () => ({ recordEvent: h.analytics, hashIp: (ip: string) => ip, hashSession: () => "anonymous-session-hash" }));
import { GET, POST } from "@/app/api/storefront/enquiry/route";
let sequence = 0;
const body = { slug: "owned-pro", serviceId: "owned-service", customerName: "QA Customer", customerPhone: "0712345678", customerEmail: "qa@test.invalid", notes: "Owned request", idempotencyKey: "qa-replay-key-123456" };
function request(input: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://jata.test/api/storefront/enquiry", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++sequence}`, ...headers }, body: JSON.stringify(input) });
}
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://mock:mock@localhost:1/mock_only"); vi.clearAllMocks(); h.rows.clear();
  h.business = { id: "owned-business", isPublished: true, status: "ACTIVE" };
  h.experience = { status: "PUBLISHED", categoryKey: "professional", publishedJson: JSON.stringify(createExperienceDocument({ categoryKey: "professional", businessName: "Owned practice" })) };
  h.service = { id: "owned-service", title: "Authoritative professional service" };
  h.findService.mockImplementation(async () => h.service);
  h.create.mockImplementation(async ({ data }: any) => { if (h.rows.has(data.id)) throw Object.assign(new Error("unique"), { code: "P2002" }); h.rows.set(data.id, { ...data }); return { id: data.id }; });
  h.analytics.mockResolvedValue(undefined);
  h.session = { userId: "owner" }; h.guard.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("durable request-only professional intake", () => {
  it("writes a real request ledger record, uses stored tenant/service, never creates an appointment or payment", async () => {
    const response = await POST(request()); const json = await response.json();
    expect(response.status).toBe(201); expect(json.received).toBe(true); expect(json.enquiry.serviceName).toBe(h.service.title);
    const row = [...h.rows.values()][0]; const stored = JSON.parse(row.metadata);
    expect(h.findService).toHaveBeenCalledWith({ where: { id: body.serviceId, businessId: h.business.id, isActive: true }, select: { id: true, title: true } });
    expect(stored).toMatchObject({ businessId: "owned-business", referenceId: "owned-service", serviceName: h.service.title,
      classification: "GENERAL_INQUIRY", status: "RECEIVED", transactionalOnly: true, customerPhone: body.customerPhone });
    expect(stored).not.toHaveProperty("startAt"); expect(stored).not.toHaveProperty("amount"); expect(stored).not.toHaveProperty("paymentStatus");
    expect(h.analytics).toHaveBeenCalledWith(expect.objectContaining({ eventType: "ENQUIRY_SUBMITTED", subjectId: "owned-service" }));
    expect(JSON.stringify(h.analytics.mock.calls)).not.toContain(body.customerPhone);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("replays an unchanged request once even with concurrent duplicate posts", async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const values = await Promise.all(responses.map((response) => response.json()));
    expect(new Set(values.map((value) => value.enquiry.id)).size).toBe(1); expect(h.rows.size).toBe(1); expect(h.analytics).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed payload using the same idempotency key without overwriting the stored request", async () => {
    await POST(request()); const before = JSON.stringify([...h.rows.values()]);
    expect((await POST(request({ ...body, notes: "A different request" }))).status).toBe(409);
    expect(JSON.stringify([...h.rows.values()])).toBe(before);
  });
  it.each(["businessId", "amount", "depositKES", "status", "serviceName", "date", "preview"])("rejects client authority field %s before any write", async (field) => {
    expect((await POST(request({ ...body, [field]: "FORGED" }))).status).toBe(400); expect(h.create).not.toHaveBeenCalled();
  });
  it("refuses unpublished/suspended/nonprofessional/invalid published snapshots", async () => {
    h.business.isPublished = false; expect((await POST(request())).status).toBe(404);
    h.business.isPublished = true; h.business.status = "SUSPENDED"; expect((await POST(request())).status).toBe(404);
    h.business.status = "ACTIVE"; h.experience.publishedJson = JSON.stringify(createExperienceDocument({ categoryKey: "salon", businessName: "Owned salon" })); expect((await POST(request())).status).toBe(404);
    h.experience.publishedJson = "{invalid"; expect((await POST(request())).status).toBe(404); expect(h.create).not.toHaveBeenCalled();
  });
  it("refuses foreign/inactive/missing services with no write", async () => {
    h.service = null; expect((await POST(request())).status).toBe(404); expect(h.create).not.toHaveBeenCalled();
  });
  it("fails closed on DB errors or a missing database instead of acknowledging an in-memory lead", async () => {
    h.create.mockRejectedValue(new Error("Database unavailable")); expect((await POST(request())).status).toBe(503); expect(h.rows.size).toBe(0);
    delete process.env.DATABASE_URL; h.create.mockClear(); expect((await POST(request())).status).toBe(503); expect(h.create).not.toHaveBeenCalled();
  });
  it("acknowledges the durable record even if separate analytics fail", async () => {
    h.analytics.mockRejectedValue(new Error("metric unavailable")); expect((await POST(request())).status).toBe(201); expect(h.rows.size).toBe(1);
  });
  it("does not echo customer PII in the public receipt and returns no raw request hash", async () => {
    const json = JSON.stringify(await (await POST(request())).json());
    expect(json).not.toContain(body.customerPhone); expect(json).not.toContain(body.customerEmail); expect(json).not.toContain("requestHash");
  });
  it("refuses cross-origin and oversized bodies", async () => {
    expect((await POST(request(body, { origin: "https://foreign.test" }))).status).toBe(403);
    expect((await POST(request(body, { "content-length": "9000" }))).status).toBe(413); expect(h.create).not.toHaveBeenCalled();
  });
});

describe("owner ledger read", () => {
  it("authorizes before reading, refuses anonymous/foreign and returns only owned safe DTO", async () => {
    await POST(request()); const get = new Request("https://jata.test/api/storefront/enquiry?businessId=owned-business");
    h.guard.mockResolvedValue({ ok: false, status: 401, error: "Sign in" }); expect((await GET(get)).status).toBe(401);
    h.guard.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" }); expect((await GET(get)).status).toBe(403);
    h.guard.mockResolvedValue({ ok: true }); const data = await (await GET(get)).json();
    expect(h.guard).toHaveBeenCalledWith(h.session, "owned-business", "read");
    expect(data.enquiries).toHaveLength(1); expect(data.enquiries[0].customerPhone).toBe(body.customerPhone);
    expect(JSON.stringify(data)).not.toContain("requestHash"); expect(JSON.stringify(data)).not.toContain(body.idempotencyKey);
  });
});
