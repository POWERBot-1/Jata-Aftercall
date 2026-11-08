import "server-only";
import { createHash } from "node:crypto";
import type { SessionPayload } from "@/lib/auth";
import prisma from "@/lib/db";
import { assertBusinessOwnership } from "@/lib/tenant";
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

  const businessMembers = await prisma.businessMember.findMany({
    where: { businessId },
    select: { userId: true, role: true },
  });
  const memberRoles = new Map<string, string>();
  memberRoles.set(business.ownerId, "OWNER");
  for (const member of businessMembers) {
    if (member.userId === business.ownerId) continue;
    const role = String(member.role ?? "VIEWER").toUpperCase();
    memberRoles.set(
      member.userId,
      role === "ADMIN" || role === "OWNER"
        ? "ADMIN"
        : role === "MANAGER" || role === "STAFF"
          ? "EDITOR"
          : "VIEWER",
    );
  }

  for (const [userId, role] of memberRoles) {
    const suffix = hash(`${businessId}:${userId}`);
    await prisma.studioWorkspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: link.workspaceId, userId } },
      create: {
        id: `wsm_${suffix}`,
        workspaceId: link.workspaceId,
        userId,
        role,
        status: "ACTIVE",
      },
      update: { role, status: "ACTIVE" },
    });
    await prisma.studioWebsiteMember.upsert({
      where: { websiteId_userId: { websiteId: website.id, userId } },
      create: {
        id: `wsite_${suffix}`,
        websiteId: website.id,
        userId,
        role,
        status: "ACTIVE",
      },
      update: { role, status: "ACTIVE" },
    });
  }

  await assertStudioWebsiteAccess(website.id, session, "read");
  return { websiteId: website.id, workspaceId: link.workspaceId, businessId };
}

function hash(value: string): string {
  return createHash("md5").update(value).digest("hex");
}
