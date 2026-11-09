import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { validateExperienceJson } from "@/lib/experience/schema";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
import { logAudit } from "@/lib/audit";
import { canTransitionStudioSite } from "@/lib/experience/publication-state";

export const dynamic = "force-dynamic";

/** Roll back one site by publishing an immutable historical snapshot as a new version. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const targetVersion = Number(body.targetVersion);
  const expectedPublishedVersion = Number(body.expectedPublishedVersion);
  const expectedDraftVersion = Number(body.expectedDraftVersion);
  if (!websiteId || !Number.isSafeInteger(targetVersion) || targetVersion < 1 ||
      !Number.isSafeInteger(expectedPublishedVersion) || expectedPublishedVersion < 0 ||
      !Number.isSafeInteger(expectedDraftVersion) || expectedDraftVersion < 0) {
    return NextResponse.json({ error: "Choose a published version and confirm the version currently live." }, { status: 400 });
  }

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "publish");
    const [target, current, business, website] = await Promise.all([
      prisma.studioWebsiteVersion.findUnique({ where: { websiteId_version: { websiteId, version: targetVersion } } }),
      prisma.studioWebsiteContent.findUnique({ where: { websiteId } }),
      prisma.business.findUnique({ where: { id: access.businessId }, select: { id: true, category: true } }),
      prisma.studioWebsite.findUnique({ where: { id: websiteId }, select: { isDefault: true, status: true } }),
    ]);
    if (!target || !current || !business || !website) return NextResponse.json({ error: "The requested publication was not found for this website." }, { status: 404 });
    if (current.publishedVersion !== expectedPublishedVersion || current.draftVersion !== expectedDraftVersion) {
      return NextResponse.json({ error: "This website changed after you reviewed it. Reload its draft and publication history.", code: "website_publish_conflict", currentPublishedVersion: current.publishedVersion, currentDraftVersion: current.draftVersion }, { status: 409 });
    }
    let categoryKey: string | undefined;
    try {
      const parsed = JSON.parse(target.snapshotJson) as { categoryKey?: unknown };
      if (typeof parsed?.categoryKey === "string") categoryKey = parsed.categoryKey;
    } catch { /* schema validation below returns the safe failure */ }
    const validated = validateExperienceJson(target.snapshotJson, categoryKey);
    if (!validated.ok) return NextResponse.json({ error: "That historical publication is no longer valid for this renderer.", issues: validated.issues }, { status: 422 });
    if (containsInlineImageDataUrl(validated.document)) {
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }

    // The next draft revision number must clear BOTH the content row's cursor and any
    // revision already stored for this website. `StudioWebsiteDraftRevision` is unique on
    // (websiteId, draftVersion), so deriving it from the content cursor alone can collide
    // with an existing revision (for example after a draft save that was later superseded)
    // and turn a legitimate rollback into a 500. Versions are never rewritten to dodge the
    // collision; the new revision simply takes the next free number.
    const highestRevision = await prisma.studioWebsiteDraftRevision.findFirst({
      where: { websiteId },
      orderBy: { draftVersion: "desc" },
      select: { draftVersion: true },
    });
    if (!canTransitionStudioSite(website.status, "PUBLISHED")) {
      return NextResponse.json({
        error: "A suspended website must be reinstated before its owner can restore a publication.",
        code: "website_state_transition_denied",
      }, { status: 409 });
    }

    const nextVersion = current.publishedVersion + 1;
    const nextDraftVersion = Math.max(current.draftVersion, Number(highestRevision?.draftVersion ?? 0)) + 1;
    const snapshotJson = JSON.stringify(validated.document);
    const publishedAt = new Date();
    const saved = await prisma.$transaction(async (tx: any) => {
      // Claim the exact state observed above before changing content. This prevents a
      // stale rollback from reviving a site an operator suspended while the request ran.
      const siteChanged = await tx.studioWebsite.updateMany({
        where: { id: websiteId, status: website.status },
        data: { status: "PUBLISHED" },
      });
      if (siteChanged.count !== 1) return false;

      const changed = await tx.studioWebsiteContent.updateMany({
        where: { websiteId, publishedVersion: expectedPublishedVersion, draftVersion: expectedDraftVersion },
        data: {
          publishedJson: snapshotJson, publishedVersion: nextVersion, publishedAt,
          publishedById: session.userId, draftJson: snapshotJson,
          draftVersion: nextDraftVersion, historyCursor: nextDraftVersion,
        },
      });
      if (changed.count !== 1) throw new Error("STUDIO_WEBSITE_ROLLBACK_CONFLICT");
      await tx.studioWebsiteVersion.create({
        data: {
          // Database-generated id: a deterministic one collides with a version migrated from
          // the legacy row (lib/experience/site-content.ts seeds `swv_<site>_<n>`).
          websiteId, version: nextVersion,
          snapshotJson, themeKey: validated.document.themeKey, categoryKey: validated.document.categoryKey,
          note: `Rollback to publication ${targetVersion}`, publishedById: session.userId, publishedAt,
        },
      });
      await tx.studioWebsiteDraftRevision.create({
        data: {
          websiteId, draftVersion: nextDraftVersion,
          source: "ROLLBACK", label: `Restored published version ${targetVersion}`,
          snapshotJson, createdById: session.userId,
        },
      });
      // Business.isPublished is the tenant-wide outer route gate. Restoring ANY
      // website (including a secondary site after the last publication was taken down)
      // must reopen it; per-site status still decides which URL is visible.
      await tx.business.update({ where: { id: business.id }, data: { isPublished: true, status: "ACTIVE" } });
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Publication changed during rollback. Reload and retry.", code: "website_publish_conflict" }, { status: 409 });

    await logAudit({ actorId: session.userId, action: "STUDIO_WEBSITE_ROLLED_BACK", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: access.businessId, websiteId, targetVersion, publishedVersion: nextVersion } });
    return NextResponse.json({ rolledBack: true, websiteId, version: nextVersion, restoredFromVersion: targetVersion, publishedAt });
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    const message = (error as { message?: string })?.message;
    const safeStatus = message === "STUDIO_WEBSITE_ROLLBACK_CONFLICT" ? 409 : status >= 400 && status <= 599 ? status : 500;
    return NextResponse.json({
      error: safeStatus === 403 ? "You do not have permission to roll back this website." : safeStatus === 404 ? "Studio website not found." : safeStatus === 409 ? "The website changed during rollback. Reload its publication history and try again." : "We could not roll back this website.",
      ...(safeStatus === 409 ? { code: "website_publish_conflict" } : {}),
    }, { status: safeStatus });
  }
}
