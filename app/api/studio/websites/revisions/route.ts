import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { validateExperienceJson } from "@/lib/experience/schema";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Restore a same-site draft revision as a new revision; never rewinds or overwrites history. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const revisionVersion = Number(body.revisionVersion);
  const expectedDraftVersion = Number(body.expectedDraftVersion);
  if (!websiteId || !Number.isSafeInteger(revisionVersion) || revisionVersion < 1 ||
      !Number.isSafeInteger(expectedDraftVersion) || expectedDraftVersion < 0) {
    return NextResponse.json({ error: "Choose a revision and the draft version you reviewed." }, { status: 400 });
  }

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "edit");
    const [revision, current, business] = await Promise.all([
      prisma.studioWebsiteDraftRevision.findUnique({
        where: { websiteId_draftVersion: { websiteId, draftVersion: revisionVersion } },
      }),
      prisma.studioWebsiteContent.findUnique({ where: { websiteId } }),
      prisma.business.findUnique({ where: { id: access.businessId }, select: { category: true } }),
    ]);
    if (!revision) return NextResponse.json({ error: "That revision is not available for this website." }, { status: 404 });
    if (!current || current.draftVersion !== expectedDraftVersion) {
      return NextResponse.json({
        error: "This website changed in another window. Reload before restoring a revision.",
        code: "website_draft_version_conflict",
        currentDraftVersion: current?.draftVersion ?? null,
      }, { status: 409 });
    }

    const validated = validateExperienceJson(revision.snapshotJson, business?.category);
    if (!validated.ok) return NextResponse.json({ error: "That revision cannot be restored safely.", issues: validated.issues }, { status: 422 });
    if (containsInlineImageDataUrl(validated.document)) {
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }

    const nextVersion = current.draftVersion + 1;
    const snapshotJson = JSON.stringify(validated.document);
    const restored = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.studioWebsiteContent.updateMany({
        where: { websiteId, draftVersion: current.draftVersion },
        data: { draftJson: snapshotJson, draftVersion: nextVersion, historyCursor: nextVersion },
      });
      if (changed.count !== 1) return false;
      await tx.studioWebsiteDraftRevision.create({
        data: {
          id: `swdr_${websiteId}_${nextVersion}`,
          websiteId,
          draftVersion: nextVersion,
          source: "RESTORE",
          label: `Restored revision ${revisionVersion}`,
          snapshotJson,
          createdById: session.userId,
        },
      });
      const stale = await tx.studioWebsiteDraftRevision.findMany({
        where: { websiteId },
        orderBy: { draftVersion: "desc" },
        skip: 50,
        select: { id: true },
      });
      if (stale.length) {
        await tx.studioWebsiteDraftRevision.deleteMany({
          where: { websiteId, id: { in: stale.map((item: { id: string }) => item.id) } },
        });
      }
      return true;
    });
    if (!restored) return NextResponse.json({ error: "This website changed in another window. Reload before restoring a revision.", code: "website_draft_version_conflict" }, { status: 409 });

    await logAudit({
      actorId: session.userId,
      action: "WEBSITE_STUDIO_SITE_DRAFT_RESTORED",
      targetType: "STUDIO_WEBSITE",
      targetId: websiteId,
      metadata: { websiteId, businessId: access.businessId, revisionVersion, draftVersion: nextVersion },
    });
    return NextResponse.json({ restored: true, websiteId, draftVersion: nextVersion, document: validated.document });
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    const safeStatus = status >= 400 && status <= 599 ? status : 500;
    return NextResponse.json({
      error: safeStatus === 404 ? "Studio website not found." : safeStatus === 403 ? "You do not have permission to restore this website." : "We could not restore that revision.",
    }, { status: safeStatus });
  }
}
