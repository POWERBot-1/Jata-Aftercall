import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { ensureStudioWebsiteContent } from "@/lib/experience/site-content";
import { validateExperienceJson } from "@/lib/experience/schema";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
import { getInteractiveEntitlement, syncInteractiveEntitlement } from "@/lib/experience/entitlement";
import { findInvalidCatalogueItems, validateForPublication } from "@/lib/experience/validate";
import { hasVerifiedPublicationRight, canSetPublished } from "@/lib/publication";
import { hasTeamFreeAccessForBusiness } from "@/lib/team-access";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function statusOf(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return status >= 400 && status <= 599 ? status : 500;
}

/** Publish only the exact authorized site's reviewed draft; siblings and legacy sites are untouched. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const expectedDraftVersion = Number(body.expectedDraftVersion);
  const action = body.action === "unpublish" ? "unpublish" : "publish";
  if (!websiteId) return NextResponse.json({ error: "Choose a website first." }, { status: 400 });

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "publish");
    const [website, business] = await Promise.all([
      prisma.studioWebsite.findUnique({ where: { id: websiteId }, select: { id: true, slug: true, status: true, isDefault: true } }),
      prisma.business.findUnique({
        where: { id: access.businessId },
        select: { id: true, name: true, slug: true, category: true, phone: true, whatsapp: true, location: true, logoUrl: true, isPublished: true },
      }),
    ]);
    if (!website || !business) return NextResponse.json({ error: "Studio website not found." }, { status: 404 });

    if (action === "unpublish") {
      await prisma.$transaction(async (tx: any) => {
        await tx.studioWebsite.update({ where: { id: websiteId }, data: { status: "DRAFT" } });
        // Public business visibility is shared by the legacy route. Hide it as well so an
        // older published snapshot cannot leak through during the transition.
        if (website.isDefault) {
          await tx.business.update({ where: { id: business.id }, data: { isPublished: false } });
          await tx.businessExperience.updateMany({ where: { businessId: business.id }, data: { status: "UNPUBLISHED" } });
        }
      });
      await logAudit({ actorId: session.userId, action: "STUDIO_WEBSITE_UNPUBLISHED", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: business.id } });
      return NextResponse.json({ published: false, websiteId, status: "DRAFT" });
    }

    if (!Number.isSafeInteger(expectedDraftVersion) || expectedDraftVersion < 1) {
      return NextResponse.json({ error: "Reload the website and publish the exact draft version you reviewed.", code: "draft_version_required" }, { status: 428 });
    }

    const content = await ensureStudioWebsiteContent(websiteId, business.id);
    if (content.draftVersion !== expectedDraftVersion || !content.draftJson) {
      return NextResponse.json({ error: "This website changed. Reload the latest draft before publishing.", code: "website_draft_version_conflict", currentDraftVersion: content.draftVersion }, { status: 409 });
    }
    const schema = validateExperienceJson(content.draftJson, business.category);
    if (!schema.ok) return NextResponse.json({ error: "The website draft failed validation.", code: "experience_schema_invalid", issues: schema.issues }, { status: 422 });
    if (containsInlineImageDataUrl(schema.document)) {
      return NextResponse.json({ error: INLINE_MEDIA_PERSISTENCE_MESSAGE, code: INLINE_MEDIA_PERSISTENCE_CODE }, { status: 503 });
    }

    const [productCount, serviceCount, products, paidPayment, subscription] = await Promise.all([
      prisma.product.count({ where: { businessId: business.id, isActive: true } }),
      prisma.service.count({ where: { businessId: business.id, isActive: true } }),
      prisma.product.findMany({ where: { businessId: business.id, isActive: true }, select: { id: true, name: true, basePriceKES: true, salePriceKES: true, salePriceStartsAt: true, salePriceEndsAt: true } }),
      prisma.payment.findFirst({ where: { businessId: business.id, status: "PAID" }, select: { status: true } }),
      prisma.subscription.findUnique({ where: { businessId: business.id }, select: { status: true, expiresAt: true, graceUntil: true, plan: { select: { key: true, name: true } } } }),
    ]);
    const isAdmin = session.role === "ADMIN";
    const teamFreeAccess = isAdmin ? false : await hasTeamFreeAccessForBusiness(business.id);
    const entitlement = await getInteractiveEntitlement(business.id);
    const validation = validateForPublication({
      document: schema.document, business, productCount, serviceCount,
      invalidItems: findInvalidCatalogueItems(products), entitlement, paidPayment, subscription, teamFreeAccess,
    });
    const verifiedPayment = hasVerifiedPublicationRight({ paidPayment, subscription }, new Date(), { teamFreeAccess });
    if (!canSetPublished(true, { isAdmin, verifiedPayment, teamFreeAccess })) {
      return NextResponse.json({ error: "A verified publication payment or approved access is required.", requires: "PAYMENT", validation }, { status: 403 });
    }
    if (!entitlement.entitled) return NextResponse.json({ error: entitlement.reason, requires: "ENTITLEMENT", validation }, { status: 403 });
    if (!validation.ready) return NextResponse.json({ error: "This website is not ready to publish.", requires: "VALIDATION", validation }, { status: 409 });

    const snapshotJson = JSON.stringify(schema.document);
    const nextVersion = Math.max(1, content.publishedVersion + 1);
    const publishedAt = new Date();
    const result = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.studioWebsiteContent.updateMany({
        where: { websiteId, draftVersion: expectedDraftVersion, draftJson: content.draftJson, publishedVersion: content.publishedVersion },
        data: { publishedJson: snapshotJson, publishedVersion: nextVersion, publishedAt, publishedById: session.userId },
      });
      if (changed.count !== 1) return false;
      await tx.studioWebsiteVersion.create({
        data: {
          id: `swv_${websiteId}_${nextVersion}`, websiteId, version: nextVersion,
          snapshotJson, themeKey: schema.document.themeKey, categoryKey: schema.document.categoryKey,
          note: typeof body.note === "string" ? body.note.slice(0, 160) : "Published from Website Studio",
          publishedById: session.userId, publishedAt,
        },
      });
      await tx.studioWebsite.update({ where: { id: websiteId }, data: { status: "PUBLISHED" } });
      // Public business visibility is the outer gate for all /b routes. A first
      // secondary-site publication must make that tenant publicly routable too.
      await tx.business.update({ where: { id: business.id }, data: { isPublished: true, status: "ACTIVE" } });
      if (website.isDefault) {
        await tx.businessExperience.updateMany({ where: { businessId: business.id }, data: { status: "UNPUBLISHED" } });
      }
      return true;
    });
    if (!result) return NextResponse.json({ error: "The draft or publication changed during publish. Reload and try again.", code: "website_publish_conflict" }, { status: 409 });

    await logAudit({ actorId: session.userId, action: "STUDIO_WEBSITE_PUBLISHED", targetType: "STUDIO_WEBSITE", targetId: websiteId, metadata: { businessId: business.id, websiteId, version: nextVersion, slug: website.slug } });
    await syncInteractiveEntitlement(business.id);
    return NextResponse.json({ published: true, websiteId, version: nextVersion, publishedAt, url: website.isDefault ? `/b/${business.slug}` : `/b/${business.slug}/${website.slug}` });
  } catch (error) {
    const status = statusOf(error);
    return NextResponse.json({ error: status === 403 ? "You do not have permission to publish this website." : status === 404 ? "Studio website not found." : "We could not publish this website." }, { status });
  }
}
