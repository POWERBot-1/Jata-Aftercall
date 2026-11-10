import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { ensureStudioWebsiteContent } from "@/lib/experience/site-content";
import { validateExperienceJson } from "@/lib/experience/schema";
import { resolveExperienceProfile } from "@/lib/experience/categories";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
import { logAudit } from "@/lib/audit";
import { TenantError } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function safeStatus(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return status >= 400 && status <= 599 ? status : 500;
}

/**
 * Machine-readable code for every refusal caused by the document itself. Publish already sent
 * this code; save, restore and rollback sent the same refusal with no code at all, so a client
 * could not tell "your document is unsupported" from "we could not reach the database" without
 * parsing prose. Kept as a local constant because this route must not import from another route.
 */
const EXPERIENCE_SCHEMA_INVALID_CODE = "experience_schema_invalid";

/** Read one site's isolated draft and published documents after server-side tenant authorization. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  const websiteId = new URL(request.url).searchParams.get("websiteId")?.trim() || "";
  if (!websiteId) return NextResponse.json({ error: "Choose a website first." }, { status: 400 });

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "read");
    const content = await ensureStudioWebsiteContent(websiteId, access.businessId);
    const revisions = await prisma.studioWebsiteDraftRevision.findMany({
      where: { websiteId },
      orderBy: { draftVersion: "desc" },
      take: 50,
      select: { draftVersion: true, source: true, label: true, createdAt: true, createdById: true },
    });
    const versions = await prisma.studioWebsiteVersion.findMany({
      where: { websiteId },
      orderBy: { version: "desc" },
      take: 50,
      select: { version: true, note: true, publishedAt: true, publishedById: true },
    });
    return NextResponse.json({
      website: { id: access.websiteId, businessId: access.businessId, workspaceId: access.workspaceId, slug: access.slug, name: access.name },
      content: {
        draftDocument: parseJson(content.draftJson),
        publishedDocument: parseJson(content.publishedJson),
        draftVersion: content.draftVersion,
        historyCursor: content.historyCursor,
        publishedVersion: content.publishedVersion,
        publishedAt: content.publishedAt,
        updatedAt: content.updatedAt,
      },
      revisions,
      versions,
    });
  } catch (error) {
    const status = safeStatus(error);
    return NextResponse.json(
      { error: status === 404 ? "Studio website not found." : status === 403 ? "You do not have permission to access this Studio website." : "We could not load this website." },
      { status },
    );
  }
}

/** Save a validated draft with optimistic concurrency and an immutable per-site revision. */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const expectedDraftVersion = Number(body.expectedDraftVersion);
  if (!websiteId || !Number.isSafeInteger(expectedDraftVersion) || expectedDraftVersion < 0) {
    return NextResponse.json({ error: "Choose a website and the draft version you edited." }, { status: 400 });
  }

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "edit");
    const business = await prisma.business.findUnique({
      where: { id: access.businessId },
      select: { category: true },
    });
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

    let serialized: string;
    try { serialized = JSON.stringify(body.document); } catch {
      return NextResponse.json({ error: "The website draft is not valid JSON." }, { status: 400 });
    }
    if (!serialized || serialized === "null") {
      return NextResponse.json({ error: "A website document is required." }, { status: 400 });
    }
    if (containsInlineImageDataUrl(body.document)) {
      return NextResponse.json(
        { error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE },
        { status: 503 },
      );
    }

    // The site's own business is the authority on its category. The draft used to be validated
    // against the business's category and then stored with whatever category the caller put in
    // the body, so a document asking for a different category was accepted and silently changed
    // which sections, catalogue rules and storefront flow this site renders with. Pinning the
    // category here makes the stored document agree with the tenant, and validation below then
    // refuses anything inconsistent instead of quietly rewriting it.
    // Only a plain object is a document. Anything else is refused rather than repaired: pinning a
    // category onto a non-document would turn the caller's payload into a *default* website and
    // store that, which is the one outcome worse than an error.
    const rawDocument = body.document;
    if (!rawDocument || typeof rawDocument !== "object" || Array.isArray(rawDocument)) {
      return NextResponse.json({ error: "A website document is required." }, { status: 400 });
    }
    const requested = rawDocument as Record<string, unknown>;
    // Onboarded tenants still carry free-text categories ("Restaurant"); the document carries a
    // profile key ("food"). Compare and store the resolved profile key, never the raw label.
    const businessCategoryKey = resolveExperienceProfile(business.category).key;
    if (requested.categoryKey !== undefined && resolveExperienceProfile(String(requested.categoryKey)).key !== businessCategoryKey) {
      return NextResponse.json(
        {
          error: "This website belongs to a different kind of business. Nothing was changed.",
          code: EXPERIENCE_SCHEMA_INVALID_CODE,
        },
        { status: 422 },
      );
    }
    const pinned = { ...requested, categoryKey: businessCategoryKey };
    let pinnedJson: string;
    try { pinnedJson = JSON.stringify(pinned); } catch {
      return NextResponse.json({ error: "The website draft is not valid JSON." }, { status: 400 });
    }

    const validated = validateExperienceJson(pinnedJson, businessCategoryKey);
    if (!validated.ok) {
      return NextResponse.json(
        { error: "The website draft failed validation.", code: EXPERIENCE_SCHEMA_INVALID_CODE, issues: validated.issues },
        { status: 422 },
      );
    }

    const current = await ensureStudioWebsiteContent(websiteId, access.businessId);
    if (current.draftVersion !== expectedDraftVersion) {
      return NextResponse.json({
        error: "This website changed in another window. Reload the latest draft before saving.",
        code: "website_draft_version_conflict",
        currentDraftVersion: current.draftVersion,
      }, { status: 409 });
    }

    const snapshotJson = JSON.stringify(validated.document);
    const nextVersion = current.draftVersion + 1;
    const saved = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.studioWebsiteContent.updateMany({
        where: { websiteId, draftVersion: current.draftVersion },
        data: { draftJson: snapshotJson, draftVersion: nextVersion, historyCursor: nextVersion },
      });
      if (changed.count !== 1) return false;

      await tx.studioWebsiteDraftRevision.create({
        data: {
          // Database-generated id: a deterministic `swdr_<site>_<n>` collides with the
          // revision seeded by lib/experience/site-content.ts during migration.
          websiteId,
          draftVersion: nextVersion,
          source: "EDIT",
          label: typeof body.label === "string" ? body.label.trim().slice(0, 120) || "Edited website" : "Edited website",
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

    if (!saved) {
      const latest = await prisma.studioWebsiteContent.findUnique({ where: { websiteId }, select: { draftVersion: true } });
      return NextResponse.json({
        error: "This website changed in another window. Reload the latest draft before saving.",
        code: "website_draft_version_conflict",
        currentDraftVersion: latest?.draftVersion ?? null,
      }, { status: 409 });
    }

    await logAudit({
      actorId: session.userId,
      action: "WEBSITE_STUDIO_SITE_DRAFT_UPDATED",
      targetType: "STUDIO_WEBSITE",
      targetId: websiteId,
      metadata: { websiteId, businessId: access.businessId, draftVersion: nextVersion },
    });

    return NextResponse.json({ saved: true, websiteId, draftVersion: nextVersion, document: validated.document });
  } catch (error) {
    const status = safeStatus(error);
    const message = status === 404
      ? "Studio website not found."
      : status === 403
        ? "You do not have permission to edit this Studio website."
        : status === 400
          ? "Invalid website update."
          : "We could not save this website. Please try again.";
    if (error instanceof TenantError) return NextResponse.json({ error: message }, { status });
    console.error("studio website content update failed");
    return NextResponse.json({ error: message }, { status });
  }
}
