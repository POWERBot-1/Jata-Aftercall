import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  session: { userId: "fixture-user", sessionVersion: 2 } as null | { userId: string; sessionVersion: number },
  grants: vi.fn(async () => [{ id: "should-not-be-read", role: "SUPER_ADMIN", permissionKeys: ["system.health.read"], scopeBusinessId: null }]),
  credential: vi.fn(),
  transaction: vi.fn(),
  auditWrite: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => fixtures.session) }));
vi.mock("@/lib/db", () => ({ default: {
  controlRoleGrant: { findMany: fixtures.grants },
  controlMfaCredential: { findUnique: fixtures.credential },
  $transaction: fixtures.transaction,
} }));
vi.mock("@/lib/control/audit", () => ({ createControlAuditEvent: fixtures.auditWrite }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/control/mfa", () => ({ verifyControlMfaSession: vi.fn(() => true) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));

import { getControlIdentity, requireControlPermission } from "@/lib/control/access";
import { GET as getControlOverview } from "@/app/api/control/overview/route";
import { PATCH as patchControlBusiness } from "@/app/api/control/businesses/route";

describe("owner-approved least-privilege Control access", () => {
  beforeEach(() => {
    fixtures.session = { userId: "fixture-user", sessionVersion: 2 };
    fixtures.credential.mockResolvedValue({ verifiedAt: new Date("2026-11-07T00:00:00.000Z") });
    vi.clearAllMocks();
  });

  it("loads only explicit active database grants for an authenticated session", async () => {
    const result = await getControlIdentity();
    expect(result.ok).toBe(true);
    expect(fixtures.grants).toHaveBeenCalledTimes(1);
  });

  it("requires verified MFA after matching the explicit role grant", async () => {
    fixtures.credential.mockResolvedValue(null);
    const result = await requireControlPermission("system.health.read");
    expect(result).toEqual({ ok: false, status: 403, code: "MFA_REQUIRED" });
    expect(fixtures.grants).toHaveBeenCalledTimes(1);
    expect(fixtures.credential).toHaveBeenCalledTimes(1);
  });

  it("preserves unauthenticated denial before reporting the policy state", async () => {
    fixtures.session = null;
    const result = await getControlIdentity();
    expect(result).toEqual({ ok: false, status: 401, code: "UNAUTHENTICATED" });
    expect(fixtures.grants).not.toHaveBeenCalled();
  });

  it("denies a direct overview API invocation anonymously before grant, MFA, or data access", async () => {
    fixtures.session = null;
    const response = await getControlOverview();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(fixtures.grants).not.toHaveBeenCalled();
    expect(fixtures.credential).not.toHaveBeenCalled();
  });

  it("denies the direct overview API when MFA is not verified", async () => {
    fixtures.credential.mockResolvedValue(null);
    const response = await getControlOverview();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MFA_REQUIRED" });
    expect(fixtures.grants).toHaveBeenCalledTimes(1);
    expect(fixtures.credential).toHaveBeenCalledTimes(1);
  });

  it("denies a cross-tenant business mutation before database lookup, writes, or success audit", async () => {
    const request = new Request("https://jata.example.test/api/control/businesses", {
      method: "PATCH",
      headers: {
        origin: "https://jata.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        businessId: "foreign-tenant-business",
        status: "SUSPENDED",
        confirmation: "SUSPEND",
        reason: "Synthetic cross-tenant denial case.",
      }),
    });
    const response = await patchControlBusiness(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CONTROL_ACCESS_REQUIRED" });
    expect(fixtures.grants).toHaveBeenCalledTimes(1);
    expect(fixtures.credential).not.toHaveBeenCalled();
    expect(fixtures.transaction).not.toHaveBeenCalled();
    expect(fixtures.auditWrite).not.toHaveBeenCalled();
  });

  it("denies a valid same-origin business mutation before database writes or success audit", async () => {
    const request = new Request("https://jata.example.test/api/control/businesses", {
      method: "PATCH",
      headers: {
        origin: "https://jata.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        businessId: "synthetic-business",
        status: "SUSPENDED",
        confirmation: "SUSPEND",
        reason: "Synthetic policy-denial test fixture.",
      }),
    });
    const response = await patchControlBusiness(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "POLICY_PENDING" });
    expect(fixtures.grants).toHaveBeenCalledTimes(1);
    expect(fixtures.credential).not.toHaveBeenCalled();
    expect(fixtures.transaction).not.toHaveBeenCalled();
    expect(fixtures.auditWrite).not.toHaveBeenCalled();
  });
});
