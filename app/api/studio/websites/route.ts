import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { ensureDefaultStudioWebsite } from "@/lib/experience/ensure-default-website";
import { ensureStudioWebsiteContent } from "@/lib/experience/site-content";
import { getWebsiteStudioEntitlements } from "@/lib/experience/studio-plan-entitlements";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function statusOf(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return status >= 400 && status <= 599 ? status : 500;
}

/** List websites belonging to one business after authorization against its default site. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  const businessId = new URL(request.url).searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: "Choose a business first." }, { status: 400 });

  try {
    const defaultSite = await ensureDefaultStudioWebsite(businessId, session);
    if (!defaultSite) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    const access = await assertStudioWebsiteAccess(defaultSite.websiteId, session, "read");
    const websites = await prisma.studioWebsite.findMany({
      where: { workspaceId: access.workspaceId, businessId: access.businessId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, slug: true, name: true, status: true, isDefault: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ websites });
  } catch (error) {
    const status = statusOf(error);
    return NextResponse.json({ error: status === 404 ? "Business not found." : status === 403 ? "You do not have permission to view these websites." : "We could not load your websites." }, { status });
  }
}

/** Create a new independent site by copying the default site's current draft, never its live state. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!businessId || name.length < 2 || name.length > 100 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60 || slug === "default") {
    return NextResponse.json({ error: "Enter a website name and a unique lowercase URL slug." }, { status: 400 });
  }

  try {
    const defaultSite = await ensureDefaultStudioWebsite(businessId, session);
    if (!defaultSite) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    const ownerAccess = await assertStudioWebsiteAccess(defaultSite.websiteId, session, "manage_workspace");
    const plan = await getWebsiteStudioEntitlements(businessId);
    if (!plan.entitled || !plan.limits) {
      return NextResponse.json({
        error: "Activate the Website Studio plan before adding another website.",
        code: "website_studio_plan_required",
      }, { status: 402 });
    }
    const existingWebsiteCount = await prisma.studioWebsite.count({ where: { businessId } });
    if (existingWebsiteCount >= plan.limits.maxWebsitesPerBusiness) {
      return NextResponse.json({
        error: "Your current Website Studio plan includes one website for this business. Upgrade to a multi-site Website Studio tier when available.",
        code: "website_studio_site_limit_reached",
        limit: plan.limits.maxWebsitesPerBusiness,
        current: existingWebsiteCount,
      }, { status: 403 });
    }
    const [sourceContent, sourceMembers] = await Promise.all([
      ensureStudioWebsiteContent(defaultSite.websiteId, businessId),
      prisma.studioWebsiteMember.findMany({
        where: { websiteId: defaultSite.websiteId, status: "ACTIVE" },
        select: { userId: true, role: true },
      }),
    ]);

    const created = await prisma.$transaction(async (tx: any) => {
      const website = await tx.studioWebsite.create({
        data: {
          id: `site_${randomUUID().replace(/-/g, "")}`,
          workspaceId: ownerAccess.workspaceId,
          businessId,
          slug,
          name,
          status: "DRAFT",
          isDefault: false,
        },
        select: { id: true, workspaceId: true, businessId: true, slug: true, name: true, status: true, isDefault: true },
      });
      await tx.studioWebsiteMember.createMany({
        data: sourceMembers.map((member: { userId: string; role: string }) => ({
          websiteId: website.id,
          userId: member.userId,
          role: member.role,
          status: "ACTIVE",
        })),
        skipDuplicates: true,
      });
      await tx.studioWebsiteContent.create({
        data: {
          id: `swc_${website.id}`,
          websiteId: website.id,
          draftJson: sourceContent.draftJson,
          publishedJson: null,
          draftVersion: sourceContent.draftJson ? 1 : 0,
          historyCursor: sourceContent.draftJson ? 1 : 0,
          publishedVersion: 0,
        },
      });
      if (sourceContent.draftJson) {
        await tx.studioWebsiteDraftRevision.create({
          data: {
            id: `swdr_${website.id}_1`,
            websiteId: website.id,
            draftVersion: 1,
            source: "CLONE",
            label: "Copied from the default website draft",
            snapshotJson: sourceContent.draftJson,
            createdById: session.userId,
          },
        });
      }
      return website;
    });

    await logAudit({
      actorId: session.userId,
      action: "WEBSITE_STUDIO_SITE_CREATED",
      targetType: "STUDIO_WEBSITE",
      targetId: created.id,
      metadata: { websiteId: created.id, businessId, slug },
    });
    return NextResponse.json({ website: created }, { status: 201 });
  } catch (error) {
    const status = statusOf(error);
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "That website URL is already in use for this business." }, { status: 409 });
    }
    return NextResponse.json({
      error: status === 404 ? "Business not found." : status === 403 ? "Only the workspace owner can create websites." : "We could not create this website.",
    }, { status });
  }
}
