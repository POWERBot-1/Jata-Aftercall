/**
 * Owner directive 2026-10-27 Phase 3A — nominated contact number server-side validation.
 *
 * POST /api/business previously applied only a loose length gate to `phone` and none to
 * `whatsapp`; PATCH /api/business accepted arbitrary phone/whatsapp strings (trim-only), so a
 * stored number could produce broken tel:/wa.me destinations on the public page. Both write
 * paths now enforce the same Kenyan rule the public contact actions use (lib/phone), while
 * empty input still clears the field and the owner's display format is preserved at rest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeKePhone, getWhatsAppUrl } from "@/lib/phone";

const mocks = vi.hoisted(() => ({
  session: { userId: "owner-a", role: "CUSTOMER" } as any,
  guardResult: { ok: true } as any,
  guard: vi.fn(),
  businessFind: vi.fn(),
  businessCreate: vi.fn(),
  businessUpdate: vi.fn(),
  memberCreate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: mocks.guard }));
vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: mocks.businessFind, create: mocks.businessCreate, update: mocks.businessUpdate },
    businessMember: { create: mocks.memberCreate },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
import { PATCH, POST } from "@/app/api/business/route";

function request(method: string, body: unknown) {
  return new Request("https://jataaftercall.co.ke/api/business", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/business nominated contact number", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "owner-a", role: "CUSTOMER" };
    mocks.businessFind.mockResolvedValue(null);
    mocks.businessCreate.mockImplementation(async ({ data }: any) => ({ id: "biz-a", ownerId: "owner-a", ...data }));
  });

  it("accepts the official demo format 0724317010 and defaults WhatsApp to the same number", async () => {
    const response = await POST(request("POST", { name: "Nyumbani Kitchen", phone: "0724317010" }));
    expect(response.status).toBe(201);
    const data = mocks.businessCreate.mock.calls[0][0].data;
    expect(data.phone).toBe("0724317010");
    expect(data.whatsapp).toBe("0724317010");
  });

  it.each([
    ["0724 317 010", "0724 317 010"],
    ["+254 724 317 010", "+254 724 317 010"],
    ["254724317010", "254724317010"],
    ["724317010", "724317010"],
  ])("accepts Kenyan format %s and keeps the owner's display format at rest", async (input, stored) => {
    const response = await POST(request("POST", { name: "Cafe", phone: input }));
    expect(response.status).toBe(201);
    const data = mocks.businessCreate.mock.calls[0][0].data;
    expect(data.phone).toBe(stored);
    // Point-of-use normalisation (the existing convention) still yields a working destination.
    expect(normalizeKePhone(data.phone)).toBe("254724317010");
    expect(getWhatsAppUrl(data.phone)).toBe("https://wa.me/254724317010");
  });

  it.each([["123"], ["0800123456"], ["+1 555 0100 123456"], ["not-a-phone"]])(
    "rejects non-Kenyan or malformed phone %s with 400 and never writes a row",
    async (phone) => {
      const response = await POST(request("POST", { name: "Cafe", phone }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("Kenyan mobile") });
      expect(mocks.businessCreate).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed WhatsApp number even when the phone number is valid", async () => {
    const response = await POST(request("POST", { name: "Cafe", phone: "0724317010", whatsapp: "call-me-maybe" }));
    expect(response.status).toBe(400);
    expect(mocks.businessCreate).not.toHaveBeenCalled();
  });

  it("rejects non-string phone payloads instead of coercing them", async () => {
    const response = await POST(request("POST", { name: "Cafe", phone: 724317010 }));
    expect(response.status).toBe(400);
    expect(mocks.businessCreate).not.toHaveBeenCalled();
  });

  it("still permits onboarding without a contact number (null, filled in later from settings)", async () => {
    const response = await POST(request("POST", { name: "Cafe" }));
    expect(response.status).toBe(201);
    const data = mocks.businessCreate.mock.calls[0][0].data;
    expect(data.phone).toBeNull();
    expect(data.whatsapp).toBeNull();
  });
});

describe("PATCH /api/business nominated contact number", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "owner-a", role: "CUSTOMER" };
    mocks.guardResult = { ok: true };
    mocks.guard.mockResolvedValue({ ok: true });
    mocks.businessUpdate.mockImplementation(async ({ data }: any) => ({ id: "biz-a", ...data }));
  });

  it("requires authentication", async () => {
    mocks.session = null;
    expect((await PATCH(request("PATCH", { businessId: "biz-a", phone: "0724317010" }))).status).toBe(401);
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("validates a nominated number update through the tenant guard before writing", async () => {
    const response = await PATCH(request("PATCH", { businessId: "biz-a", phone: "0724317010" }));
    expect(response.status).toBe(200);
    expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner-a" }), "biz-a", "read");
    const data = mocks.businessUpdate.mock.calls[0][0].data;
    expect(data.phone).toBe("0724317010");
    expect(normalizeKePhone(data.phone)).toBe("254724317010");
    expect(getWhatsAppUrl(data.phone, "Hello")).toBe("https://wa.me/254724317010?text=Hello");
  });

  it.each([["123"], ["0800123456"], ["+44 20 7946 0958"], [42]])(
    "rejects invalid phone update %s with 400 and performs no write",
    async (phone) => {
      const response = await PATCH(request("PATCH", { businessId: "biz-a", phone }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("Kenyan mobile") });
      expect(mocks.businessUpdate).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid WhatsApp update independently of the phone field", async () => {
    const response = await PATCH(request("PATCH", { businessId: "biz-a", whatsapp: "ping me" }));
    expect(response.status).toBe(400);
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("allows clearing the nominated number (empty string -> null)", async () => {
    const response = await PATCH(request("PATCH", { businessId: "biz-a", phone: "", whatsapp: "" }));
    expect(response.status).toBe(200);
    const data = mocks.businessUpdate.mock.calls[0][0].data;
    expect(data.phone).toBeNull();
    expect(data.whatsapp).toBeNull();
  });

  it("updates WhatsApp alone when only that field is sent, leaving phone out of the write set", async () => {
    const response = await PATCH(request("PATCH", { businessId: "biz-a", whatsapp: "0724317010" }));
    expect(response.status).toBe(200);
    const data = mocks.businessUpdate.mock.calls[0][0].data;
    expect(data).toEqual({ whatsapp: "0724317010" });
  });

  it("defers to the tenant guard so a cross-tenant edit is rejected before validation", async () => {
    mocks.guard.mockResolvedValue({ ok: false, status: 403, error: "You don't have access to that business." });
    const response = await PATCH(request("PATCH", { businessId: "stranger-biz", phone: "0724317010" }));
    expect(response.status).toBe(403);
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });
});
