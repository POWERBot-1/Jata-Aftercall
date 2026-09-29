import { describe, expect, it, vi } from "vitest";
import { publicPageDecision, PUBLISH_REQUIRES_PAYMENT, canSetPublished } from "@/lib/publication";
import { SAFE_ERRORS } from "@/lib/safeError";

vi.mock("@/lib/db", () => {
  return {
    default: {
      business: {
        findMany: vi.fn(async ({ where }: any) => {
          if (where?.ownerId === "userA") return [{ id: "bizA" }];
          if (where?.ownerId === "userB") return [{ id: "bizB" }];
          return [];
        }),
        findUnique: vi.fn(),
      },
      businessMember: {
        findMany: vi.fn(async () => []),
      },
    },
  };
});

import { guardTenantMutation } from "@/lib/tenant";

const owner = { userId: "userA", role: "CUSTOMER" };
const other = { userId: "userB", role: "CUSTOMER" };
const admin = { userId: "admin1", role: "ADMIN" };
const unpublished = { isPublished: false, ownerId: "userA", ownerMemberIds: ["userA"] };

describe("publication and preview", () => {
  it("returns not found for an unpublished page with no session", () => {
    expect(publicPageDecision({ business: unpublished, viewer: null })).toBe("not_found");
  });

  it("returns not found for another authenticated tenant", () => {
    expect(publicPageDecision({ business: unpublished, viewer: other })).toBe("not_found");
  });

  it("lets the server-verified owner preview their unpublished page", () => {
    expect(publicPageDecision({ business: unpublished, viewer: owner })).toBe("preview");
  });

  it("lets an admin preview an unpublished page", () => {
    expect(publicPageDecision({ business: unpublished, viewer: admin })).toBe("preview");
  });

  it("shows a published page to the public", () => {
    expect(publicPageDecision({ business: { ...unpublished, isPublished: true }, viewer: null })).toBe("public");
  });

  it("does not accept a URL-supplied owner id as ownership", () => {
    const forgedViewer = { userId: "attacker", role: "CUSTOMER" };
    expect(publicPageDecision({ business: unpublished, viewer: forgedViewer })).toBe("not_found");
  });
});

describe("publication requires verified payment", () => {
  it("pins the payment-before-publication gate", () => {
    expect(PUBLISH_REQUIRES_PAYMENT).toBe(true);
    expect(canSetPublished(true)).toBe(false);
    expect(canSetPublished(true, { verifiedPayment: true })).toBe(true);
  });

  it("always allows unpublishing", () => {
    expect(canSetPublished(false)).toBe(true);
  });
});

describe("tenant mutation guard", () => {
  it("rejects an unauthenticated caller", async () => {
    await expect(guardTenantMutation(null, "bizA")).resolves.toEqual({
      ok: false,
      status: 401,
      error: SAFE_ERRORS.signIn,
    });
  });

  it("rejects a cross-tenant PATCH without leaking isolation internals", async () => {
    const result = await guardTenantMutation(owner as any, "bizB");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toBe(SAFE_ERRORS.noAccess);
    expect(result.error).not.toContain("Tenant isolation");
  });

  it("allows the owner to patch their own business", async () => {
    await expect(guardTenantMutation(owner as any, "bizA")).resolves.toEqual({ ok: true });
  });
});
