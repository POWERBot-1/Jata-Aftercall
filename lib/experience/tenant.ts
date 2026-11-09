import "server-only";
import type { SessionPayload } from "@/lib/auth";
import prisma from "@/lib/db";
import { getBusinessRoleForUser, TenantError, type BusinessRole } from "@/lib/tenant";
import { canStudioRolePerform, type StudioAction, type StudioRole } from "./tenant-policy";

export type StudioWebsiteAccess = {
  websiteId: string;
  businessId: string;
  workspaceId: string;
  slug: string;
  name: string;
  websiteRole: StudioRole;
  workspaceRole: StudioRole;
  businessRole: BusinessRole;
};

/**
 * Resolves and authorizes a Studio website from its opaque ID.
 * The website's workspace/business pair is enforced by a composite database FK.
 * Existing BusinessMember permissions remain the upper bound; workspace and site
 * memberships can only reduce those permissions.
 */
export async function assertStudioWebsiteAccess(
  websiteId: string,
  session: SessionPayload,
  action: StudioAction = "read",
): Promise<StudioWebsiteAccess> {
  if (!websiteId || !session?.userId) {
    throw new TenantError("Studio website access denied", 403);
  }

  const website = await prisma.studioWebsite.findUnique({
    where: { id: websiteId },
    include: {
      workspaceBusiness: {
        include: {
          workspace: {
            select: {
              id: true,
              ownerUserId: true,
              status: true,
              members: {
                where: { userId: session.userId, status: "ACTIVE" },
                select: { role: true },
                take: 1,
              },
            },
          },
          business: { select: { id: true } },
        },
      },
      members: {
        where: { userId: session.userId, status: "ACTIVE" },
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!website || website.status === "SUSPENDED") {
    throw new TenantError("Studio website not found", 404);
  }

  const workspace = website.workspaceBusiness?.workspace;
  const business = website.workspaceBusiness?.business;
  if (!workspace || !business || workspace.status !== "ACTIVE") {
    throw new TenantError("Studio website access denied", 403);
  }

  const businessRole = await getBusinessRoleForUser(
    business.id,
    session,
  );
  if (!businessRole) {
    throw new TenantError("Studio website access denied", 403);
  }

  const platformAdmin = session.role === "ADMIN" && businessRole === "ADMIN";
  const workspaceRole = platformAdmin
    ? "OWNER"
    : workspace.ownerUserId === session.userId
      ? "OWNER"
      : workspace.members[0]?.role;
  const websiteRole = platformAdmin
    ? "OWNER"
    : workspace.ownerUserId === session.userId
      ? "OWNER"
      : website.members[0]?.role;

  if (
    !canStudioRolePerform({
      workspaceRole,
      websiteRole,
      businessRole,
      action,
    })
  ) {
    throw new TenantError("Insufficient Studio website permission", 403);
  }

  return {
    websiteId: website.id,
    businessId: business.id,
    workspaceId: workspace.id,
    slug: website.slug,
    name: website.name,
    websiteRole: websiteRole as StudioRole,
    workspaceRole: workspaceRole as StudioRole,
    businessRole,
  };
}
