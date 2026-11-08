import { vi } from "vitest";
import type { RolePermissionLevel } from "@/lib/tenant";

// Vitest runs server modules in Node; Next's marker package must not throw during test imports.
vi.mock("server-only", () => ({}));

/**
 * Legacy Studio route suites mock the business-level tenant guard and use an in-memory
 * Prisma surface. Delegate the new site guard to that same mock in those tests. The
 * dedicated Website Studio PostgreSQL tenant suite explicitly exercises the real workspace/site
 * authorization path through its own database client.
 */
vi.mock("@/lib/experience/ensure-default-website", async () => {
  const tenant = await import("@/lib/tenant");
  const mapAction = (action: string): RolePermissionLevel => {
    if (action === "edit") return "configure";
    if (action === "publish") return "publish";
    if (action === "manage_workspace") return "manage_settings";
    return "read";
  };
  const guardStudioWebsiteMutation = vi.fn(async (
    session: unknown,
    businessId: string | null | undefined,
    action: "read" | "edit" | "publish" | "manage_workspace" = "read",
  ) => {
    if (typeof tenant.guardTenantMutation === "function") {
      return tenant.guardTenantMutation(session as any, businessId, mapAction(action));
    }
    if (typeof tenant.assertBusinessOwnership === "function") {
      try {
        await tenant.assertBusinessOwnership(businessId, session as any);
        return { ok: true as const };
      } catch (error) {
        const status = Number((error as { status?: unknown })?.status) || 403;
        return { ok: false as const, status, error: "You do not have permission to access this Studio website." };
      }
    }
    return { ok: true as const };
  });
  const assertDefaultStudioWebsiteAccess = vi.fn(async (
    businessId: string,
    session: unknown,
    action = "read",
  ) => {
    const guard = await guardStudioWebsiteMutation(session, businessId, action as any);
    if (!guard.ok) {
      throw Object.assign(new Error(guard.error), { status: guard.status });
    }
    return { websiteId: "test-site", businessId, workspaceId: "test-workspace" };
  });
  const ensureDefaultStudioWebsite = vi.fn(async (businessId: string, session: unknown) => {
    if (typeof tenant.assertBusinessOwnership === "function") {
      await tenant.assertBusinessOwnership(businessId, session as any);
    }
    return { websiteId: "test-site", businessId, workspaceId: "test-workspace" };
  });
  return { guardStudioWebsiteMutation, assertDefaultStudioWebsiteAccess, ensureDefaultStudioWebsite };
});
