import { createHash } from "node:crypto";
import type { SessionPayload } from "@/lib/auth";
import prisma from "@/lib/db";
import { assertBusinessOwnership, TenantError } from "@/lib/tenant";
import { assertStudioWebsiteAccess } from "./tenant";

/**
 * Creates the default Studio control-plane identity on first owner entry.
 * It never creates/changes a BusinessExperience, entitlement, subscription,
 * payment, product, order, inventory row, or public Business Page record.
 */
export async function ensureDefaultStudioWebsite(
  businessId: string,
  session: SessionPayload,
) {
  await assertBusinessOwnership(businessId, session);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, ownerId: true, name: true },
  });
  if (!business) return null;

  const existingLink = await prisma.studioWorkspaceBusiness.findUnique({
    where: { businessId },
    select: { workspaceId: true },
  });
  const workspaceId = existingLink?.workspaceId ?? `ws_${hash(businessId)}`;

  if (!existingLink) {
    await prisma.studioWorkspace.upsert({
      where: { id: workspaceId },
      create: {
        id: workspaceId,
        name: `${business.name} Workspace`,
        ownerUserId: business.ownerId,
        status: "ACTIVE",
      },
      update: {},
    });
  }

  const link = await prisma.studioWorkspaceBusiness.upsert({
    where: { businessId },
    create: {
      id: `wsb_${hash(businessId)}`,
      workspaceId,
      businessId,
    },
    update: {},
    select: { workspaceId: true },
  });

  const website = await prisma.studioWebsite.upsert({
    where: { businessId_slug: { businessId, slug: "default" } },
    create: {
      id: `site_${hash(businessId)}`,
      workspaceId: link.workspaceId,
      businessId,
      slug: "default",
      name: `${business.name} Website`,
      status: "DRAFT",
      isDefault: true,
    },
    update: {
      workspaceId: link.workspaceId,
    },
    select: { id: true },
  });

  const [businessMembers, workspace] = await Promise.all([
    prisma.businessMember.findMany({
      where: { businessId },
      select: { userId: true, role: true },
    }),
    prisma.studioWorkspace.findUnique({
      where: { id: link.workspaceId },
      select: { ownerUserId: true },
    }),
  ]);
  if (!workspace) throw new TenantError("Studio workspace not found", 404);
  const memberRoles = new Map<string, { workspaceRole: string; websiteRole: string }>();
  memberRoles.set(business.ownerId, {
    workspaceRole: workspace.ownerUserId === business.ownerId ? "OWNER" : "ADMIN",
    websiteRole: "OWNER",
  });
  for (const member of businessMembers) {
    if (member.userId === business.ownerId) continue;
    const role = String(member.role ?? "VIEWER").toUpperCase();
    const studioRole = role === "ADMIN" || role === "OWNER"
      ? "ADMIN"
      : role === "MANAGER" || role === "STAFF"
        ? "EDITOR"
        : "VIEWER";
    memberRoles.set(member.userId, { workspaceRole: studioRole, websiteRole: studioRole });
  }

  for (const [userId, roles] of memberRoles) {
    const suffix = hash(`${businessId}:${userId}`);
    await prisma.studioWorkspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: link.workspaceId, userId } },
      create: {
        id: `wsm_${suffix}`,
        workspaceId: link.workspaceId,
        userId,
        role: roles.workspaceRole,
        status: "ACTIVE",
      },
      update: { role: roles.workspaceRole },
    });
    await prisma.studioWebsiteMember.upsert({
      where: { websiteId_userId: { websiteId: website.id, userId } },
      create: {
        id: `wsite_${suffix}`,
        websiteId: website.id,
        userId,
        role: roles.websiteRole,
        status: "ACTIVE",
      },
      update: { role: roles.websiteRole },
    });
  }

  await assertStudioWebsiteAccess(website.id, session, "read");
  return { websiteId: website.id, workspaceId: link.workspaceId, businessId };
}

function hash(value: string): string {
  return createHash("md5").update(value).digest("hex");
}


export async function assertDefaultStudioWebsiteAccess(
  businessId: string,
  session: SessionPayload,
  action: "read" | "edit" | "publish" | "manage_workspace" = "read",
) {
  const site = await ensureDefaultStudioWebsite(businessId, session);
  if (!site) throw new TenantError("Studio website not found", 404);
  return assertStudioWebsiteAccess(site.websiteId, session, action);
}

export async function guardStudioWebsiteMutation(
  session: SessionPayload | null,
  businessId: string | null | undefined,
  action: "read" | "edit" | "publish" | "manage_workspace" = "read",
) {
  if (!session) return { ok: false as const, status: 401, error: "Please sign in to continue." };
  if (!businessId) return { ok: false as const, status: 400, error: "Choose a business first." };
  try {
    await assertDefaultStudioWebsiteAccess(businessId, session, action);
    return { ok: true as const };
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    return {
      ok: false as const,
      status: status >= 400 && status <= 599 ? status : 403,
      error: status === 404 ? "Studio website not found." : "You do not have permission to access this Studio website.",
    };
  }
}
