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

function validateNativeConfig(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 160 || !Array.isArray(value.blocks)) return false;
  const validBlocks = (blocks: unknown[]) => blocks.length <= 250 && blocks.every((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const item = block as Record<string, unknown>;
    return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 120
      && typeof item.type === "string" && BLOCK_TYPES.has(item.type)
      && typeof item.variant === "string" && item.variant.length <= 80
      && !!item.props && typeof item.props === "object" && !Array.isArray(item.props);
  });
  if (!validBlocks(value.blocks)) return false;
  if (value.pages !== undefined) {
    if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 50) return false;
    for (const page of value.pages) {
      if (!page || typeof page !== "object" || Array.isArray(page)) return false;
      const item = page as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string" || !Array.isArray(item.blocks) || !validBlocks(item.blocks)) return false;
    }
  }
  return true;
}

function statusOf(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return status >= 400 && status <= 599 ? status : 500;
}

/** Publish/unpublish an exact, tenant-authorized OpenPage draft without using an external deploy provider. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const expectedDraftVersion = Number(body.expectedDraftVersion);
  const expectedPublishedVersion = Number(body.expectedPublishedVersion);
  const action = body.action === "unpublish" ? "unpublish" : "publish";
  if (!websiteId || !Number.isSafeInteger(expectedDraftVersion) || expectedDraftVersion < 0 ||
      !Number.isSafeInteger(expectedPublishedVersion) || expectedPublishedVersion < 0) {
    return NextResponse.json({ error: "Reload the website and confirm its draft and publication versions." }, { status: 400 });
  }

  try {
    const access = await assertStudioPublicationAccess(websiteId, session);
    const [website, business, document] = await Promise.all([
      prisma.studioWebsite.findUnique({ where: { id: websiteId }, select: { id: true, slug: true, status: true, isDefault: true } }),
      prisma.business.findUnique({ where: { id: access.businessId }, select: { id: true, slug: true, status: true } }),
      prisma.openPageSiteDocument.findUnique({ where: { websiteId } }),
    ]);
    if (!website || !business || !document) return NextResponse.json({ error: "OpenPage website or saved draft not found." }, { status: 404 });
    if (document.draftVersion !== expectedDraftVersion || document.publishedVersion !== expectedPublishedVersion) {
      return NextResponse.json({
        error: "The website changed after you reviewed it. Reload the latest draft and publication state.",
        code: "openpage_publish_conflict",
        currentDraftVersion: document.draftVersion,
        currentPublishedVersion: document.publishedVersion,
      }, { status: 409 });
    }

    if (action === "unpublish") {
      if (website.status !== "PUBLISHED") return NextResponse.json({ error: "This website is not currently published.", code: "openpage_not_published" }, { status: 409 });
      const changed = await prisma.$transaction(async (tx) => {
        const site = await tx.studioWebsite.updateMany({
          where: { id: websiteId, status: "PUBLISHED" },
          data: { status: "UNPUBLISHED" },
        });
        if (site.count !== 1) return false;
        const stillPublished = await tx.studioWebsite.count({ where: { businessId: business.id, status: "PUBLISHED" } });
        if (stillPublished === 0) await tx.business.updateMany({ where: { id: business.id, status: business.status }, data: { isPublished: false } });
        return true;
      });
      if (!changed) return NextResponse.json({ error: "Publication state changed. Reload and try again.", code: "openpage_publish_conflict" }, { status: 409 });
      await logAudit({ actorId: session.userId, action: "OPENPAGE_WEBSITE_UNPUBLISHED", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: business.id, expectedDraftVersion, expectedPublishedVersion } });
      return NextResponse.json({ published: false, websiteId, status: "UNPUBLISHED" });
    }

    if (business.status === "SUSPENDED") return NextResponse.json({ error: "This business is suspended and cannot be published.", code: "business_suspended" }, { status: 409 });
    if (!canTransitionStudioSite(website.status, "PUBLISHED")) return NextResponse.json({ error: "This website cannot transition to published from its current state.", code: "website_state_transition_denied" }, { status: 409 });
    if (expectedDraftVersion < 1 || !document.draftJson) return NextResponse.json({ error: "Save a draft before publishing.", code: "openpage_draft_required" }, { status: 428 });

    const entitlement = await getInteractiveEntitlement(business.id);
    if (!entitlement.entitled) return NextResponse.json({ error: entitlement.reason, code: "website_studio_entitlement_required" }, { status: 403 });

    let config: unknown;
    try { config = JSON.parse(document.draftJson); } catch {
      return NextResponse.json({ error: "The saved OpenPage document is invalid JSON.", code: "openpage_document_invalid" }, { status: 422 });
    }
    if (!validateNativeConfig(config)) return NextResponse.json({ error: "The saved OpenPage document failed validation.", code: "openpage_document_invalid" }, { status: 422 });
    const snapshotJson = JSON.stringify(config);
    if (snapshotJson.length > 1_500_000 || /data:image\\//i.test(snapshotJson)) {
      return NextResponse.json({ error: "The document exceeds the safe publishing limits or contains inline image data. Use JATA media URLs.", code: "openpage_media_policy" }, { status: 422 });
    }

    const nextVersion = document.publishedVersion + 1;
    const publishedAt = new Date();
    const published = await prisma.$transaction(async (tx) => {
      const saved = await tx.openPageSiteDocument.updateMany({
        where: { websiteId, draftVersion: expectedDraftVersion, publishedVersion: expectedPublishedVersion, draftJson: document.draftJson },
        data: { publishedJson: snapshotJson, publishedVersion: nextVersion, publishedAt, publishedById: session.userId },
      });
      if (saved.count !== 1) return false;
      await tx.openPageSitePublication.create({
        data: { websiteId, version: nextVersion, draftVersion: expectedDraftVersion, snapshotJson, note: typeof body.note === "string" ? body.note.slice(0, 160) : "Published from Website Studio", publishedById: session.userId, publishedAt },
      });
      const site = await tx.studioWebsite.updateMany({
        where: { id: websiteId, status: website.status },
        data: { status: "PUBLISHED" },
      });
      if (site.count !== 1) throw new Error("OPENPAGE_WEBSITE_STATE_CONFLICT");
      const tenant = await tx.business.updateMany({
        where: { id: business.id, status: business.status },
        data: { isPublished: true, status: "ACTIVE" },
      });
      if (tenant.count !== 1) throw new Error("OPENPAGE_BUSINESS_STATE_CONFLICT");
      return true;
    });
    if (!published) return NextResponse.json({ error: "The draft changed during publication. Reload and try again.", code: "openpage_publish_conflict" }, { status: 409 });

    await logAudit({ actorId: session.userId, action: "OPENPAGE_WEBSITE_PUBLISHED", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: business.id, websiteId, version: nextVersion, slug: website.slug } });
    return NextResponse.json({
      published: true,
      websiteId,
      version: nextVersion,
      publishedAt,
      url: website.isDefault ? `/b/${business.slug}` : `/b/${business.slug}/${website.slug}`,
    });
  } catch (error) {
    if (error instanceof StudioPublicationRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    const code = (error as { message?: string })?.message;
    if (code === "OPENPAGE_WEBSITE_STATE_CONFLICT" || code === "OPENPAGE_BUSINESS_STATE_CONFLICT") {
      return NextResponse.json({ error: "The website or business state changed. Reload before publishing again.", code: "openpage_publish_conflict" }, { status: 409 });
    }
    const status = statusOf(error);
    return NextResponse.json({ error: status === 404 ? "Studio website not found." : status === 403 ? "You do not have permission to publish this website." : "We could not publish this OpenPage website." }, { status });
  }
}
