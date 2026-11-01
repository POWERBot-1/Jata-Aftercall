import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  session: { userId: "fixture-user", sessionVersion: 2 } as null | { userId: string; sessionVersion: number },
  grants: vi.fn(async () => [{ id: "should-not-be-read", role: "SUPER_ADMIN", permissionKeys: ["system.health.read"], scopeBusinessId: null }]),
  credential: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => fixtures.session) }));
vi.mock("@/lib/db", () => ({ default: {
  controlRoleGrant: { findMany: fixtures.grants },
  controlMfaCredential: { findUnique: fixtures.credential },
} }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));

import { getControlIdentity, requireControlPermission } from "@/lib/control/access";
import { GET as getControlOverview } from "@/app/api/control/overview/route";

describe("pending Control role policy fails closed", () => {
  beforeEach(() => {
    fixtures.session = { userId: "fixture-user", sessionVersion: 2 };
    vi.clearAllMocks();
  });

  it("keeps an authenticated identity with a nominal broad grant blocked while owner policy is pending", async () => {
    const result = await getControlIdentity();
    expect(result).toEqual({ ok: false, status: 403, code: "POLICY_PENDING" });
    expect(fixtures.grants).not.toHaveBeenCalled();
  });

  it("denies protected routes before MFA or data access even if a capability would otherwise match", async () => {
    const result = await requireControlPermission("system.health.read");
    expect(result).toEqual({ ok: false, status: 403, code: "POLICY_PENDING" });
    expect(fixtures.grants).not.toHaveBeenCalled();
    expect(fixtures.credential).not.toHaveBeenCalled();
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

  it("denies the direct overview API for an authenticated synthetic session while owner policy is pending", async () => {
    const response = await getControlOverview();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "POLICY_PENDING" });
    expect(fixtures.grants).not.toHaveBeenCalled();
    expect(fixtures.credential).not.toHaveBeenCalled();
  });
});
