import prisma from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";
import { getBusinessRoleForUser } from "@/lib/tenant";
import { assertStudioWebsiteAccess, type StudioWebsiteAccess } from "@/lib/experience/tenant";

/**
 * Access guard for the *owner* publication actions (publish, unpublish, rollback).
 *
 * `assertStudioWebsiteAccess` deliberately hides a suspended website behind a 404: a
 * suspended site must not be discoverable, and reading one tells the caller nothing. That is
 * right for reads but wrong here. An owner whose site an operator has just suspended needs to
 * be told *that*, in words they can act on, rather than a "not found" suggesting their data
 * is gone — and the refusal has to name the publication state, because changing publication
 * is exactly what an operator suspension is meant to prevent.
 *
 * So this wrapper separates two questions the 404 conflates:
 *
 * - is this caller entitled to this site at all? If not, the answer stays 404, and nothing
 *   about a suspended site is revealed to anyone who was not already entitled to it;
 * - if they are entitled, is the site (or its business) suspended? Then 409, with a code the
 *   UI can act on, and no write.
 *
 * The entitlement re-check mirrors `assertStudioWebsiteAccess` field for field. It is
 * deliberately kept in one place with a comment pointing at the original, so a change to the
 * membership rules there has one obvious place to be mirrored.
 */
export class StudioPublicationRefused extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function assertStudioPublicationAccess(
  websiteId: string,
  session: SessionPayload,
): Promise<StudioWebsiteAccess> {
  let suspended: { status: string; businessId: string } | null = null;
  try {
    return await assertStudioWebsiteAccess(websiteId, session, "publish");
  } catch (error) {
    if (Number((error as { status?: unknown })?.status) !== 404) throw error;
    suspended = await prisma.studioWebsite.findUnique({
      where: { id: websiteId },
      select: { status: true, businessId: true },
    });
    // Not suspended → the original 404 was the honest answer.
    if (!suspended || suspended.status !== "SUSPENDED") {
      throw new StudioPublicationRefused("Studio website not found", 404, "studio_website_not_found");
    }
  }

  const access = await authorizeEntitledWebsite(websiteId, session);
  const business = await prisma.business.findUnique({
    where: { id: access.businessId },
    select: { status: true },
  });
  if (business?.status === "SUSPENDED") {
    throw new StudioPublicationRefused(
      "This business is suspended. An authorized operator must reinstate it before publication can change.",
      409,
      "business_suspended",
    );
  }
  throw new StudioPublicationRefused(
    "This website has been suspended by an operator. It must be reinstated before its publication can change.",
    409,
    "website_suspended",
  );
}

/**
 * The entitlement checks of `assertStudioWebsiteAccess`, with suspension treated as a fact
 * rather than as absence. Returns the access record; refuses 404 for a caller with no claim.
 */
async function authorizeEntitledWebsite(websiteId: string, session: SessionPayload): Promise<StudioWebsiteAccess> {
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
              members: { where: { userId: session.userId, status: "ACTIVE" }, select: { role: true }, take: 1 },
            },
          },
          business: { select: { id: true } },
        },
      },
      members: { where: { userId: session.userId, status: "ACTIVE" }, select: { role: true }, take: 1 },
    },
  });
  const workspace = website?.workspaceBusiness?.workspace;
  const business = website?.workspaceBusiness?.business;
  if (!website || !workspace || !business || workspace.status !== "ACTIVE") {
    throw new StudioPublicationRefused("Studio website not found", 404, "studio_website_not_found");
  }

  const businessRole = await getBusinessRoleForUser(business.id, session);
  if (!businessRole) {
    throw new StudioPublicationRefused("Studio website not found", 404, "studio_website_not_found");
  }

  const platformAdmin = session.role === "ADMIN" && businessRole === "ADMIN";
  const workspaceRole = platformAdmin ? "OWNER" : workspace.ownerUserId === session.userId ? "OWNER" : workspace.members[0]?.role;
  const websiteRole = platformAdmin ? "OWNER" : workspace.ownerUserId === session.userId ? "OWNER" : website.members[0]?.role;
  if (!workspaceRole || !websiteRole) {
    throw new StudioPublicationRefused("Studio website not found", 404, "studio_website_not_found");
  }

  return {
    websiteId: website.id,
    businessId: business.id,
    workspaceId: workspace.id,
    slug: (website as { slug?: string }).slug ?? "",
    name: (website as { name?: string }).name ?? "",
    websiteRole: websiteRole as StudioWebsiteAccess["websiteRole"],
    workspaceRole: workspaceRole as StudioWebsiteAccess["workspaceRole"],
    businessRole,
  };
}
