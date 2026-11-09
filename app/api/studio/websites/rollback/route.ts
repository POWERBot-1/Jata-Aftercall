import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { validateExperienceJson } from "@/lib/experience/schema";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
import { logAudit } from "@/lib/audit";

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
  if (!websiteId || !Number.isSafeInteger(targetVersion) || targetVersion < 1 ||
      !Number.isSafeInteger(expectedPublishedVersion) || expectedPublishedVersion < 0) {
    return NextResponse.json({ error: "Choose a published version and confirm the version currently live." }, { status: 400 });
  }

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "publish");
    const [target, current, business] = await Promise.all([
      prisma.studioWebsiteVersion.findUnique({ where: { websiteId_version: { websiteId, version: targetVersion } } }),
      prisma.studioWebsiteContent.findUnique({ where: { websiteId } }),
      prisma.business.findUnique({ where: { id: access.businessId }, select: { category: true } }),
    ]);
    if (!target || !current || !business) return NextResponse.json({ error: "The requested publication was not found for this website." }, { status: 404 });
    if (current.publishedVersion !== expectedPublishedVersion) {
      return NextResponse.json({ error: "This website was published elsewhere. Reload its publication history.", code: "website_publish_conflict", currentPublishedVersion: current.publishedVersion }, { status: 409 });
    }
    const validated = validateExperienceJson(target.snapshotJson, business.category);
    if (!validated.ok) return NextResponse.json({ error: "That historical publication is no longer valid for this renderer.", issues: validated.issues }, { status: 422 });
    if (containsInlineImageDataUrl(validated.document)) {
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }

    const nextVersion = current.publishedVersion + 1;
    const nextDraftVersion = current.draftVersion + 1;
    const snapshotJson = JSON.stringify(validated.document);
    const publishedAt = new Date();
    const saved = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.studioWebsiteContent.updateMany({
        where: { websiteId, publishedVersion: expectedPublishedVersion },
        data: {
          publishedJson: snapshotJson, publishedVersion: nextVersion, publishedAt,
          publishedById: session.userId, draftJson: snapshotJson,
          draftVersion: nextDraftVersion, historyCursor: nextDraftVersion,
        },
      });
      if (changed.count !== 1) return false;
      await tx.studioWebsiteVersion.create({
        data: {
          id: `swv_${websiteId}_${nextVersion}`, websiteId, version: nextVersion,
          snapshotJson, themeKey: validated.document.themeKey, categoryKey: validated.document.categoryKey,
          note: `Rollback to publication ${targetVersion}`, publishedById: session.userId, publishedAt,
        },
      });
      await tx.studioWebsiteDraftRevision.create({
        data: {
          id: `swdr_${websiteId}_${nextDraftVersion}`, websiteId, draftVersion: nextDraftVersion,
          source: "ROLLBACK", label: `Restored published version ${targetVersion}`,
          snapshotJson, createdById: session.userId,
        },
      });
      await tx.studioWebsite.update({ where: { id: websiteId }, data: { status: "PUBLISHED" } });
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Publication changed during rollback. Reload and retry.", code: "website_publish_conflict" }, { status: 409 });

    await logAudit({ actorId: session.userId, action: "STUDIO_WEBSITE_ROLLED_BACK", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: access.businessId, websiteId, targetVersion, publishedVersion: nextVersion } });
    return NextResponse.json({ rolledBack: true, websiteId, version: nextVersion, restoredFromVersion: targetVersion, publishedAt });
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    const safeStatus = status >= 400 && status <= 599 ? status : 500;
    return NextResponse.json({ error: safeStatus === 403 ? "You do not have permission to roll back this website." : safeStatus === 404 ? "Studio website not found." : "We could not roll back this website." }, { status: safeStatus });
  }
}
