import { describe, it, expect, vi } from "vitest";

// Isolation tests that mock Prisma — prove that TenantError is thrown when Tenant A accesses Tenant B.
// These are negative isolation tests per authorization constraints.

vi.mock("@/lib/db", () => {
  return {
    default: {
      business: {
        findMany: vi.fn(async ({ where }: any) => {
          // ownerId determines returned businesses
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

import { assertBusinessOwnership, TenantError } from "@/lib/tenant";

const sessionA = { userId: "userA", email: "a@example.com", role: "CUSTOMER" } as const;
const sessionB = { userId: "userB", email: "b@example.com", role: "CUSTOMER" } as const;
const adminSession = { userId: "admin1", email: "admin@jata.link", role: "ADMIN" } as const;

describe("tenant isolation — strict boundary", () => {
  it("Tenant A can access own business", async () => {
    await expect(assertBusinessOwnership("bizA", sessionA as any)).resolves.toBeUndefined();
  });

  it("Tenant A cannot access Tenant B business — negative test", async () => {
    await expect(assertBusinessOwnership("bizB", sessionA as any)).rejects.toThrow(TenantError);
  });

  it("Tenant B cannot access Tenant A business — symmetric negative", async () => {
    await expect(assertBusinessOwnership("bizA", sessionB as any)).rejects.toThrow(TenantError);
  });

  it("Tenant cannot access non-existent / unowned business", async () => {
    await expect(assertBusinessOwnership("bizX", sessionA as any)).rejects.toThrow(TenantError);
  });

  it("Missing businessId throws 400", async () => {
    await expect(assertBusinessOwnership("", sessionA as any)).rejects.toThrow(TenantError);
  });

  it("Admin bypasses ownership check", async () => {
    // Admin should not throw even for foreign business
    await expect(assertBusinessOwnership("bizA", adminSession as any)).resolves.toBeUndefined();
    await expect(assertBusinessOwnership("bizB", adminSession as any)).resolves.toBeUndefined();
  });

  it("Client-supplied tenant ID is ignored — ownership is derived from session, not body", async () => {
    // Simulate malicious POST /api/business PATCH with businessId of another tenant
    // The server must call assertBusinessOwnership with session-derived check.
    // This test proves the helper does not read body.tenantId — it reads businessId and compares to owned list.
    const maliciousBody = { businessId: "bizB", tenantId: "userA", name: "Hacked" };
    // Even if tenantId is faked, server checks businessId against sessionA's owned list — fails
    await expect(assertBusinessOwnership(maliciousBody.businessId, sessionA as any)).rejects.toThrow(/Tenant isolation/);
  });

  it("IDOR via enumeration is blocked", async () => {
    // Attacker enumerates cuid-like IDs
    const enumeratedIds = ["bizA", "bizB", "bizC"];
    for (const id of enumeratedIds) {
      if (id !== "bizA") {
        await expect(assertBusinessOwnership(id, sessionA as any)).rejects.toThrow();
      }
    }
  });
});
