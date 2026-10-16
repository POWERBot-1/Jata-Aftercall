/**
 * Fail-closed publish/unpublish authorization (§3, §5, §15, §46)
 *
 * Publishing — in either direction — mutates protected state (public site visibility,
 * ExperienceVersion snapshots, the platform's publication record). This suite pins the
 * server-side authorization contract for every layer that can reach those writes:
 *
 *   - unknown or corrupted roles normalize to NO role (never a privileged default)
 *   - failed role lookups resolve to NO role (never "OWNER" via an error path)
 *   - guardTenantMutation denies non-read actions when there is no role to evaluate
 *   - experience publish/unpublish requires the publish-level role, not just ownership
 *   - business PATCH treats `isPublished` flips as publish-level, name edits as reads
 *   - AI Front Desk publish (object-form assertBusinessRole) denies without a publish role
 *
 * The real @/lib/tenant is used throughout; only auth, db, audit and the AI publish
 * side effect are mocked so every check runs against production authorization code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  session: null as any,
  ownerOf: {} as Record<string, string>,
  memberships: [] as Array<{ userId: string; businessId: string; role: string | null }>,
  roleLookupCalls: 0,
  failRoleLookupAt: 0,
  business: {
    id: "biz-1", name: "Choma Place", slug: "choma-place", category: "Food & Restaurant",
    phone: "0722000000", whatsapp: null, location: "Kilimani", logoUrl: "/logo.png", isPublished: false,
  },
  experience: null as any,
  productCount: 2,
  products: [
    { id: "p1", name: "Chicken", basePriceKES: 900, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null },
    { id: "p2", name: "Fries", basePriceKES: 300, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null },
  ],
  paidPayment: null as { status: string } | null,
  subscription: null as any,
  entitlementRow: { status: "ACTIVE" } as { status: string } | null,
  businessUpdate: vi.fn(async (args: any) => ({ id: args?.where?.id ?? "biz-1", ...(args?.data ?? {}) })),
  experienceUpdate: vi.fn(async () => ({ id: "exp-1", status: "UNPUBLISHED", publishedAt: null })),
  experienceUpdateMany: vi.fn(async () => ({ count: 1 })),
  auditCreate: vi.fn(async () => ({})),
  transaction: vi.fn(),
  logAudit: vi.fn(async () => ({})),
  publishAI: vi.fn(async () => ({ ok: true, frontDeskId: "fd-1" })),
}));

function signIn(userId: string, platformRole = "CUSTOMER") {
  st.session = { userId, email: `${userId}@example.test`, role: platformRole };
}

function activeSubscription() {
  return {
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 10 * 86400000),
    graceUntil: null,
    plan: { key: "INTERACTIVE_BUSINESS", name: "Interactive Business", priceKES: 4999, durationDays: 30 },
  };
}

function validExperience() {
  return {
    id: "exp-1", businessId: "biz-1", status: "DRAFT", categoryKey: "food", themeKey: "food-grill",
    draftJson: JSON.stringify({
      categoryKey: "food", themeKey: "food-grill",
      brand: { businessName: "Choma Place", heroImageUrl: "/hero.jpg" },
      settings: { phone: "0722000000", deliveryFeeKES: 200 },
      sections: [
        { id: "nav", type: "navigation", visible: true },
        { id: "hero", type: "hero", visible: true },
        { id: "menu", type: "menu", visible: true },
      ],
    }),
    publishedJson: null, draftVersion: 3, publishedVersion: 0,
  };
}

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => st.session),
  getCurrentUser: vi.fn(async () =>
    st.session ? { ...st.session, id: st.session.userId } : null,
  ),
}));

vi.mock("@/lib/audit", () => ({ logAudit: st.logAudit }));

vi.mock("@/lib/ai-readiness", () => ({ publishAIBusinessFrontDesk: st.publishAI }));

vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findFirst: vi.fn(async ({ where }: any) =>
        where?.ownerId && st.ownerOf[where.id] === where.ownerId ? { id: where.id } : null,
      ),
      findUnique: vi.fn(async ({ where }: any) =>
        st.ownerOf[where?.id]
          ? { ...st.business, id: where.id, ownerId: st.ownerOf[where.id] }
          : null,
      ),
      findMany: vi.fn(async ({ where }: any) =>
        where?.ownerId
          ? Object.entries(st.ownerOf)
              .filter(([, ownerId]) => ownerId === where.ownerId)
              .map(([id]) => ({ id }))
          : [],
      ),
      update: st.businessUpdate,
    },
    businessMember: {
      findMany: vi.fn(async (args: any) => {
        const rows = st.memberships.filter((m) => m.userId === args?.where?.userId);
        if (args?.select?.role) {
          st.roleLookupCalls += 1;
          if (st.failRoleLookupAt && st.roleLookupCalls === st.failRoleLookupAt) {
            throw new Error("simulated role lookup failure");
          }
          return rows.map(({ businessId, role }) => ({ businessId, role }));
        }
        return rows.map(({ businessId }) => ({ businessId }));
      }),
      upsert: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
    },
    businessExperience: {
      findUnique: vi.fn(async () => st.experience),
      update: st.experienceUpdate,
      updateMany: st.experienceUpdateMany,
    },
    product: { count: vi.fn(async () => st.productCount), findMany: vi.fn(async () => st.products) },
    service: { count: vi.fn(async () => 0) },
    payment: { findFirst: vi.fn(async () => st.paidPayment) },
    subscription: { findUnique: vi.fn(async () => st.subscription) },
    interactiveBusinessEntitlement: {
      findUnique: vi.fn(async () => st.entitlementRow),
      upsert: vi.fn(async () => ({})),
    },
    experienceVersion: { upsert: vi.fn(async () => ({})) },
    auditEvent: { create: st.auditCreate },
    $transaction: st.transaction,
  },
}));

import { POST as experiencePublishPOST } from "@/app/api/experience/publish/route";
import { PATCH as businessPatch } from "@/app/api/business/route";
import { POST as aiPublishPOST } from "@/app/api/ai/publish/route";
import {
  assertBusinessRole,
  canBusinessRolePerform,
  getBusinessRoleForUser,
  guardTenantMutation,
  normalizeBusinessRole,
} from "@/lib/tenant";
import { SAFE_ERRORS } from "@/lib/safeError";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  st.session = null;
  st.ownerOf = {};
  st.memberships = [];
  st.roleLookupCalls = 0;
  st.failRoleLookupAt = 0;
  st.business = {
    id: "biz-1", name: "Choma Place", slug: "choma-place", category: "Food & Restaurant",
    phone: "0722000000", whatsapp: null, location: "Kilimani", logoUrl: "/logo.png", isPublished: false,
  };
  st.experience = null;
  st.productCount = 2;
  st.paidPayment = null;
  st.subscription = null;
  st.entitlementRow = { status: "ACTIVE" };
  st.businessUpdate.mockClear();
  st.experienceUpdate.mockClear();
  st.experienceUpdateMany.mockClear();
  st.auditCreate.mockClear();
  st.logAudit.mockClear();
  st.publishAI.mockClear();
  st.transaction.mockImplementation(async (work: any) =>
    work({
      businessExperience: {
        updateMany: st.experienceUpdateMany,
        findUnique: vi.fn(async () => ({
          id: "exp-1", status: "PUBLISHED", publishedVersion: 3, publishedAt: new Date(),
        })),
        update: st.experienceUpdate,
      },
      experienceVersion: { upsert: vi.fn(async () => ({})) },
      business: { update: st.businessUpdate },
      auditEvent: { create: st.auditCreate },
    }),
  );
});

describe("normalizeBusinessRole — unknown input is never privileged (§46)", () => {
  it("returns null for unknown role names (previously defaulted to OWNER)", () => {
    expect(normalizeBusinessRole("HACKER")).toBeNull();
    expect(normalizeBusinessRole("superuser")).toBeNull();
    expect(normalizeBusinessRole("owner_admin")).toBeNull();
  });

  it("returns null for empty, non-string, and blank input", () => {
    expect(normalizeBusinessRole("")).toBeNull();
    expect(normalizeBusinessRole("   ")).toBeNull();
    expect(normalizeBusinessRole(null)).toBeNull();
    expect(normalizeBusinessRole(undefined)).toBeNull();
    expect(normalizeBusinessRole(123)).toBeNull();
    expect(normalizeBusinessRole({ role: "OWNER" })).toBeNull();
  });

  it("still normalizes every real role, including lowercase with padding", () => {
    expect(normalizeBusinessRole("owner")).toBe("OWNER");
    expect(normalizeBusinessRole(" owner ")).toBe("OWNER");
    expect(normalizeBusinessRole("ADMIN")).toBe("ADMIN");
    expect(normalizeBusinessRole("manager")).toBe("MANAGER");
    expect(normalizeBusinessRole("staff")).toBe("STAFF");
    expect(normalizeBusinessRole("viewer")).toBe("VIEWER");
  });
});

describe("getBusinessRoleForUser — fail-closed resolution (§46)", () => {
  beforeEach(() => {
    st.ownerOf["biz-1"] = "owner1";
  });

  it("resolves the direct owner to OWNER (legitimate access keeps working)", async () => {
    await expect(getBusinessRoleForUser("biz-1", { userId: "owner1", email: "o@x", role: "CUSTOMER" }))
      .resolves.toBe("OWNER");
  });

  it("short-circuits platform ADMIN sessions", async () => {
    await expect(getBusinessRoleForUser("biz-1", { userId: "anyone", email: "a@x", role: "ADMIN" }))
      .resolves.toBe("ADMIN");
  });

  it("resolves a member's stored MANAGER role", async () => {
    st.memberships.push({ userId: "manager1", businessId: "biz-1", role: "MANAGER" });
    await expect(getBusinessRoleForUser("biz-1", { userId: "manager1", email: "m@x", role: "CUSTOMER" }))
      .resolves.toBe("MANAGER");
  });

  it("returns null for an unknown stored role (previously defaulted to OWNER)", async () => {
    st.memberships.push({ userId: "weird1", businessId: "biz-1", role: "SUPERVISOR" });
    await expect(getBusinessRoleForUser("biz-1", { userId: "weird1", email: "w@x", role: "CUSTOMER" }))
      .resolves.toBeNull();
  });

  it("returns null for an empty stored role (previously defaulted to OWNER)", async () => {
    st.memberships.push({ userId: "empty1", businessId: "biz-1", role: "" });
    await expect(getBusinessRoleForUser("biz-1", { userId: "empty1", email: "e@x", role: "CUSTOMER" }))
      .resolves.toBeNull();
  });

  it("returns null when the role lookup itself fails (previously defaulted to OWNER)", async () => {
    st.memberships.push({ userId: "member1", businessId: "biz-1", role: "MANAGER" });
    st.failRoleLookupAt = 1;
    await expect(getBusinessRoleForUser("biz-1", { userId: "member1", email: "m@x", role: "CUSTOMER" }))
      .resolves.toBeNull();
  });

  it("returns null for a cross-tenant caller with no relationship", async () => {
    await expect(getBusinessRoleForUser("biz-1", { userId: "attacker", email: "a@x", role: "CUSTOMER" }))
      .resolves.toBeNull();
  });

  it("returns null for missing ids instead of guessing", async () => {
    await expect(getBusinessRoleForUser("", { userId: "owner1", email: "o@x", role: "CUSTOMER" }))
      .resolves.toBeNull();
    await expect(getBusinessRoleForUser("biz-1", { userId: "", email: "o@x", role: "CUSTOMER" }))
      .resolves.toBeNull();
  });
});

describe("guardTenantMutation — publish-level actions deny on missing role (§46)", () => {
  const owner = { userId: "owner1", email: "o@x", role: "CUSTOMER" };
  const viewer = { userId: "viewer1", email: "v@x", role: "CUSTOMER" };

  beforeEach(() => {
    st.ownerOf["biz-1"] = "owner1";
    st.memberships.push({ userId: "viewer1", businessId: "biz-1", role: "VIEWER" });
  });

  it("rejects an unauthenticated caller with 401", async () => {
    await expect(guardTenantMutation(null, "biz-1", "publish")).resolves.toEqual({
      ok: false, status: 401, error: SAFE_ERRORS.signIn,
    });
  });

  it("rejects a cross-tenant caller with 403", async () => {
    const result = await guardTenantMutation({ ...owner, userId: "attacker" } as any, "biz-1", "publish");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toBe(SAFE_ERRORS.noAccess);
  });

  it("rejects a VIEWER for publish even on their own tenant", async () => {
    const result = await guardTenantMutation(viewer as any, "biz-1", "publish");
    expect(result).toEqual({ ok: false, status: 403, error: SAFE_ERRORS.noAccess });
  });

  it("rejects publish when the role lookup fails — previously returned ok:true (§46 regression)", async () => {
    st.memberships.push({ userId: "flaky1", businessId: "biz-1", role: "MANAGER" });
    st.failRoleLookupAt = 1;
    const result = await guardTenantMutation({ ...viewer, userId: "flaky1" } as any, "biz-1", "publish");
    expect(result).toEqual({ ok: false, status: 403, error: SAFE_ERRORS.noAccess });
  });

  it("allows the owner's publish", async () => {
    await expect(guardTenantMutation(owner as any, "biz-1", "publish")).resolves.toEqual({ ok: true });
  });

  it("allows a platform ADMIN's publish", async () => {
    await expect(
      guardTenantMutation({ userId: "admin1", email: "a@x", role: "ADMIN" } as any, "biz-1", "publish"),
    ).resolves.toEqual({ ok: true });
  });

  it("keeps read access working for a VIEWER (no over-blocking)", async () => {
    await expect(guardTenantMutation(viewer as any, "biz-1", "read")).resolves.toEqual({ ok: true });
  });
});

describe("assertBusinessRole (object form) — AI Front Desk publish primitive (§46)", () => {
  beforeEach(() => {
    st.ownerOf["biz-1"] = "owner1";
    st.memberships.push({ userId: "manager1", businessId: "biz-1", role: "MANAGER" });
    st.memberships.push({ userId: "weird1", businessId: "biz-1", role: "SUPERVISOR" });
  });

  it("grants publish to the direct owner", async () => {
    await expect(
      assertBusinessRole({ userId: "owner1", businessId: "biz-1", userRole: "CUSTOMER", action: "publish" }),
    ).resolves.toEqual({ allowed: true, role: "OWNER" });
  });

  it("denies publish to a MANAGER (weight 30 < publish 40)", async () => {
    await expect(
      assertBusinessRole({ userId: "manager1", businessId: "biz-1", userRole: "CUSTOMER", action: "publish" }),
    ).resolves.toEqual({ allowed: false, role: "MANAGER" });
  });

  it("denies publish when the stored role is unknown — previously normalize gave OWNER", async () => {
    await expect(
      assertBusinessRole({ userId: "weird1", businessId: "biz-1", userRole: "CUSTOMER", action: "publish" }),
    ).resolves.toEqual({ allowed: false, role: null });
  });

  it("denies publish for a cross-tenant caller with no relationship", async () => {
    await expect(
      assertBusinessRole({ userId: "attacker", businessId: "biz-1", userRole: "CUSTOMER", action: "publish" }),
    ).resolves.toEqual({ allowed: false, role: null });
  });

  it("denies publish when the role lookup fails", async () => {
    st.failRoleLookupAt = 1;
    await expect(
      assertBusinessRole({ userId: "manager1", businessId: "biz-1", userRole: "CUSTOMER", action: "publish" }),
    ).resolves.toEqual({ allowed: false, role: null });
  });
});

describe("POST /api/experience/publish — role gate on both directions (§5, §15)", () => {
  beforeEach(() => {
    st.ownerOf["biz-1"] = "owner1";
    st.memberships.push(
      { userId: "manager1", businessId: "biz-1", role: "MANAGER" },
      { userId: "viewer1", businessId: "biz-1", role: "VIEWER" },
      { userId: "weird1", businessId: "biz-1", role: "SUPERVISOR" },
    );
  });

  it("requires a session (401)", async () => {
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", expectedDraftVersion: 3 }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a cross-tenant publish with 403 and no writes", async () => {
    signIn("attacker");
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", expectedDraftVersion: 3 }),
    );
    expect(response.status).toBe(403);
    expect(st.experienceUpdateMany).not.toHaveBeenCalled();
    expect(st.businessUpdate).not.toHaveBeenCalled();
    expect(st.transaction).not.toHaveBeenCalled();
    expect(st.logAudit).not.toHaveBeenCalled();
  });

  it("refuses a cross-tenant unpublish with 403 and no writes", async () => {
    signIn("attacker");
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", action: "unpublish" }),
    );
    expect(response.status).toBe(403);
    expect(st.experienceUpdate).not.toHaveBeenCalled();
    expect(st.businessUpdate).not.toHaveBeenCalled();
    expect(st.logAudit).not.toHaveBeenCalled();
  });

  it("refuses a MANAGER publish — ownership alone is not enough", async () => {
    signIn("manager1");
    st.experience = validExperience();
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", expectedDraftVersion: 3 }),
    );
    expect(response.status).toBe(403);
    expect(st.transaction).not.toHaveBeenCalled();
    expect(st.businessUpdate).not.toHaveBeenCalled();
  });

  it("refuses a VIEWER unpublish — hiding the site needs the publish role too", async () => {
    signIn("viewer1");
    st.experience = validExperience();
    st.business.isPublished = true;
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", action: "unpublish" }),
    );
    expect(response.status).toBe(403);
    expect(st.experienceUpdate).not.toHaveBeenCalled();
    expect(st.businessUpdate).not.toHaveBeenCalled();
    expect(st.logAudit).not.toHaveBeenCalled();
  });

  it("refuses publish when the stored role is unknown — previously defaulted to OWNER", async () => {
    signIn("weird1");
    st.experience = validExperience();
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", expectedDraftVersion: 3 }),
    );
    expect(response.status).toBe(403);
    expect(st.transaction).not.toHaveBeenCalled();
  });

  it("refuses publish when the role lookup fails", async () => {
    signIn("manager1");
    st.experience = validExperience();
    st.failRoleLookupAt = 1;
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", expectedDraftVersion: 3 }),
    );
    expect(response.status).toBe(403);
    expect(st.transaction).not.toHaveBeenCalled();
  });

  it("still lets the owner unpublish without payment or entitlement (§15)", async () => {
    signIn("owner1");
    st.experience = validExperience();
    st.business.isPublished = true;
    st.paidPayment = null;
    st.subscription = { status: "PENDING", expiresAt: null, graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS", name: "Interactive Business" } };
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", action: "unpublish" }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).published).toBe(false);
    expect(st.experienceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UNPUBLISHED" }) }),
    );
    expect(st.businessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPublished: false }) }),
    );
  });

  it("still lets the owner publish a paid, entitled, complete website through the real role gate", async () => {
    signIn("owner1");
    st.experience = validExperience();
    st.paidPayment = { status: "PAID" };
    st.subscription = activeSubscription();
    const response = await experiencePublishPOST(
      jsonRequest("https://jata.test/api/experience/publish", { businessId: "biz-1", expectedDraftVersion: 3 }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.published).toBe(true);
    expect(st.experienceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED" }) }),
    );
    expect(st.businessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPublished: true }) }),
    );
    expect(st.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "EXPERIENCE_PUBLISHED" }) }),
    );
  });
});

describe("PATCH /api/business — isPublished flips are publish-level (§5, §15)", () => {
  beforeEach(() => {
    st.ownerOf["biz-1"] = "owner1";
    st.memberships.push(
      { userId: "viewer1", businessId: "biz-1", role: "VIEWER" },
      { userId: "manager1", businessId: "biz-1", role: "MANAGER" },
    );
  });

  it("requires a session (401)", async () => {
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", isPublished: true }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a VIEWER flipping isPublished and never touches the row", async () => {
    signIn("viewer1");
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", isPublished: true }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(SAFE_ERRORS.noAccess);
    expect(st.businessUpdate).not.toHaveBeenCalled();
    expect(st.logAudit).not.toHaveBeenCalled();
  });

  it("refuses isPublished:false (unpublish) for a VIEWER too", async () => {
    signIn("viewer1");
    st.business.isPublished = true;
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", isPublished: false }),
    );
    expect(response.status).toBe(403);
    expect(st.businessUpdate).not.toHaveBeenCalled();
  });

  it("refuses isPublished when the role lookup fails — previously passed the read guard (§46 regression)", async () => {
    signIn("viewer1");
    st.failRoleLookupAt = 1;
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", isPublished: true }),
    );
    expect(response.status).toBe(403);
    expect(st.businessUpdate).not.toHaveBeenCalled();
  });

  it("refuses a cross-tenant isPublished flip with 403", async () => {
    signIn("attacker");
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", isPublished: true }),
    );
    expect(response.status).toBe(403);
    expect(st.businessUpdate).not.toHaveBeenCalled();
  });

  it("lets the owner publish with verified payment", async () => {
    signIn("owner1");
    st.paidPayment = { status: "PAID" };
    st.subscription = activeSubscription();
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", isPublished: true }),
    );
    expect(response.status).toBe(200);
    expect(st.businessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPublished: true }) }),
    );
    expect(st.logAudit).toHaveBeenCalled();
  });

  it("keeps ordinary non-publish edits working for members (read-level guard)", async () => {
    signIn("manager1");
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", name: "New Name" }),
    );
    expect(response.status).toBe(200);
    expect(st.businessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "New Name" }) }),
    );
  });

  it("does not perform the publish payment check when isPublished is absent", async () => {
    signIn("viewer1");
    const response = await businessPatch(
      jsonRequest("https://jata.test/api/business", { businessId: "biz-1", name: "Read Only Edit" }),
    );
    expect(response.status).toBe(200);
    expect(st.businessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Read Only Edit" }) }),
    );
  });
});

describe("POST /api/ai/publish — object-form role check on the route (§5, §15)", () => {
  beforeEach(() => {
    st.ownerOf["biz-1"] = "owner1";
    st.memberships.push(
      { userId: "manager1", businessId: "biz-1", role: "MANAGER" },
      { userId: "weird1", businessId: "biz-1", role: "SUPERVISOR" },
    );
  });

  it("requires authentication (401)", async () => {
    const response = await aiPublishPOST(
      jsonRequest("https://jata.test/api/ai/publish", { businessId: "biz-1" }),
    );
    expect(response.status).toBe(401);
    expect(st.publishAI).not.toHaveBeenCalled();
  });

  it("requires businessId (400)", async () => {
    signIn("owner1");
    const response = await aiPublishPOST(jsonRequest("https://jata.test/api/ai/publish", {}));
    expect(response.status).toBe(400);
  });

  it("denies a MANAGER member before any publish side effect", async () => {
    signIn("manager1");
    const response = await aiPublishPOST(
      jsonRequest("https://jata.test/api/ai/publish", { businessId: "biz-1" }),
    );
    expect(response.status).toBe(403);
    expect(st.publishAI).not.toHaveBeenCalled();
  });

  it("denies a cross-tenant caller before any publish side effect", async () => {
    signIn("attacker");
    const response = await aiPublishPOST(
      jsonRequest("https://jata.test/api/ai/publish", { businessId: "biz-1" }),
    );
    expect(response.status).toBe(403);
    expect(st.publishAI).not.toHaveBeenCalled();
  });

  it("denies an unknown stored role — previously normalize gave OWNER (§46 regression)", async () => {
    signIn("weird1");
    const response = await aiPublishPOST(
      jsonRequest("https://jata.test/api/ai/publish", { businessId: "biz-1" }),
    );
    expect(response.status).toBe(403);
    expect(st.publishAI).not.toHaveBeenCalled();
  });

  it("denies when the role lookup fails", async () => {
    signIn("manager1");
    st.failRoleLookupAt = 1;
    const response = await aiPublishPOST(
      jsonRequest("https://jata.test/api/ai/publish", { businessId: "biz-1" }),
    );
    expect(response.status).toBe(403);
    expect(st.publishAI).not.toHaveBeenCalled();
  });

  it("allows the direct owner through to the publish operation", async () => {
    signIn("owner1");
    const response = await aiPublishPOST(
      jsonRequest("https://jata.test/api/ai/publish", { businessId: "biz-1" }),
    );
    expect(response.status).toBe(200);
    expect(st.publishAI).toHaveBeenCalledWith({ businessId: "biz-1", actorId: "owner1" });
  });
});

describe("weight table guardrails", () => {
  it("publish requires ADMIN or OWNER level (weight >= 40)", () => {
    expect(canBusinessRolePerform("OWNER", "publish")).toBe(true);
    expect(canBusinessRolePerform("ADMIN", "publish")).toBe(true);
    expect(canBusinessRolePerform("MANAGER", "publish")).toBe(false);
    expect(canBusinessRolePerform("STAFF", "publish")).toBe(false);
    expect(canBusinessRolePerform("VIEWER", "publish")).toBe(false);
    expect(canBusinessRolePerform(null, "publish")).toBe(false);
    expect(canBusinessRolePerform(undefined, "publish")).toBe(false);
  });
});
