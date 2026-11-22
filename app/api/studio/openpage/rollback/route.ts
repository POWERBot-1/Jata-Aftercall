import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioPublicationAccess, StudioPublicationRefused } from "@/lib/experience/publication-access";
import { getInteractiveEntitlement } from "@/lib/experience/entitlement";
import { canTransitionStudioSite } from "@/lib/experience/publication-state";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const BLOCK_TYPES = new Set([
  "navbar", "hero", "features", "pricing", "cta", "footer", "testimonials",
  "stats", "faq", "team", "contact", "newsletter", "logocloud", "divider",
  "banner", "content", "image", "video", "gallery",
]);

function validConfig(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim() || !Array.isArray(value.blocks)) return false;
  const blocksValid = (blocks: unknown[]) => blocks.length <= 250 && blocks.every((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const item = block as Record<string, unknown>;
    return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 120
      && typeof item.type === "string" && BLOCK_TYPES.has(item.type)
      && typeof item.variant === "string" && item.variant.length <= 80
      && !!item.props && typeof item.props === "object" && !Array.isArray(item.props);
  });
  if (!blocksValid(value.blocks)) return false;
  if (value.pages !== undefined) {
    if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 50) return false;
    for (const page of value.pages) {
      if (!page || typeof page !== "object" || Array.isArray(page)) return false;
      const item = page as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string" || !Array.isArray(item.blocks) || !blocksValid(item.blocks)) return false;
    }
  }
  return true;
}

function statusOf(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return status >= 400 && status <= 599 ? status : 500;
}

/** Restore a previous immutable OpenPage publication as a NEW draft and publication version. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const targetVersion = Number(body.targetVersion);
  const expectedDraftVersion = Number(body.expectedDraftVersion);
  const expectedPublishedVersion = Number(body.expectedPublishedVersion);
  if (!websiteId || !Number.isSafeInteger(targetVersion) || targetVersion < 1 ||
      !Number.isSafeInteger(expectedDraftVersion) || expectedDraftVersion < 0 ||
      !Number.isSafeInteger(expectedPublishedVersion) || expectedPublishedVersion < 0) {
    return NextResponse.json({ error: "Choose a saved publication and confirm the current draft and publication versions." }, { status: 400 });
  }

  try {
    const access = await assertStudioPublicationAccess(websiteId, session);
    const [website, business, document, target] = await Promise.all([
      prisma.studioWebsite.findUnique({ where: { id: websiteId }, select: { id: true, status: true } }),
      prisma.business.findUnique({ where: { id: access.businessId }, select: { id: true, status: true } }),
      prisma.openPageSiteDocument.findUnique({ where: { websiteId } }),
      prisma.openPageSitePublication.findUnique({ where: { websiteId_version: { websiteId, version: targetVersion } } }),
    ]);
    if (!website || !business || !document || !target) return NextResponse.json({ error: "The requested OpenPage publication was not found." }, { status: 404 });
    if (document.draftVersion !== expectedDraftVersion || document.publishedVersion !== expectedPublishedVersion) {
      return NextResponse.json({
        error: "This website changed after you reviewed its history. Reload and try again.",
        code: "openpage_rollback_conflict",
        currentDraftVersion: document.draftVersion,
        currentPublishedVersion: document.publishedVersion,
      }, { status: 409 });
    }
    if (business.status === "SUSPENDED") return NextResponse.json({ error: "This business is suspended and cannot be published.", code: "business_suspended" }, { status: 409 });
    if (!canTransitionStudioSite(website.status, "PUBLISHED")) return NextResponse.json({ error: "This website cannot be restored from its current state.", code: "website_state_transition_denied" }, { status: 409 });
    const entitlement = await getInteractiveEntitlement(business.id);
    if (!entitlement.entitled) return NextResponse.json({ error: entitlement.reason, code: "website_studio_entitlement_required" }, { status: 403 });

    let config: unknown;
    try { config = JSON.parse(target.snapshotJson); } catch {
      return NextResponse.json({ error: "The saved publication is invalid JSON.", code: "openpage_publication_invalid" }, { status: 422 });
    }
    if (!validConfig(config)) return NextResponse.json({ error: "The saved publication failed validation.", code: "openpage_publication_invalid" }, { status: 422 });
    const snapshotJson = JSON.stringify(config);
    if (snapshotJson.length > 1_500_000 || /data:image\//i.test(snapshotJson)) {
      return NextResponse.json({ error: "The saved publication contains unsupported inline media or exceeds the document limit.", code: "openpage_media_policy" }, { status: 422 });
    }

    const nextDraftVersion = document.draftVersion + 1;
    const nextPublishedVersion = document.publishedVersion + 1;
    const publishedAt = new Date();
    const restored = await prisma.$transaction(async (tx) => {
      const saved = await tx.openPageSiteDocument.updateMany({
        where: { websiteId, draftVersion: expectedDraftVersion, publishedVersion: expectedPublishedVersion },
        data: {
          draftJson: snapshotJson,
          draftVersion: nextDraftVersion,
          publishedJson: snapshotJson,
          publishedVersion: nextPublishedVersion,
          publishedAt,
          publishedById: session.userId,
        },
      });
      if (saved.count !== 1) return false;
      await tx.openPageSiteRevision.create({
        data: { websiteId, draftVersion: nextDraftVersion, snapshotJson, source: "ROLLBACK", createdById: session.userId },
      });
      await tx.openPageSitePublication.create({
        data: {
          websiteId,
          version: nextPublishedVersion,
          draftVersion: nextDraftVersion,
          snapshotJson,
          note: `Rollback to publication ${targetVersion}`,
          publishedById: session.userId,
          publishedAt,
        },
      });
      const siteChanged = await tx.studioWebsite.updateMany({
        where: { id: websiteId, status: website.status },
        data: { status: "PUBLISHED" },
      });
      if (siteChanged.count !== 1) throw new Error("OPENPAGE_ROLLBACK_SITE_CONFLICT");
      const businessChanged = await tx.business.updateMany({
        where: { id: business.id, status: business.status },
        data: { isPublished: true, status: "ACTIVE" },
      });
      if (businessChanged.count !== 1) throw new Error("OPENPAGE_ROLLBACK_BUSINESS_CONFLICT");
      return true;
    });
    if (!restored) return NextResponse.json({ error: "The website changed during rollback. Reload and try again.", code: "openpage_rollback_conflict" }, { status: 409 });

    await logAudit({ actorId: session.userId, action: "OPENPAGE_WEBSITE_ROLLED_BACK", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: business.id, targetVersion, draftVersion: nextDraftVersion, publishedVersion: nextPublishedVersion } });
    return NextResponse.json({ restored: true, websiteId, draftVersion: nextDraftVersion, publishedVersion: nextPublishedVersion, publishedAt });
  } catch (error) {
    if (error instanceof StudioPublicationRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    const code = (error as { message?: string })?.message;
    if (code === "OPENPAGE_ROLLBACK_SITE_CONFLICT" || code === "OPENPAGE_ROLLBACK_BUSINESS_CONFLICT") {
      return NextResponse.json({ error: "The website or business state changed. Reload before restoring.", code: "openpage_rollback_conflict" }, { status: 409 });
    }
    const status = statusOf(error);
    return NextResponse.json({ error: status === 404 ? "Studio website not found." : status === 403 ? "You do not have permission to restore this website." : "We could not restore this OpenPage publication." }, { status });
  }
}
