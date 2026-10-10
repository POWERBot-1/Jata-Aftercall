/**
 * Publishing (§3, §15, §58, §59)
 *
 * Draft → preview → payment/entitlement check → publish → live.
 *
 * Publishing is a server-side gate, not a UI state: a direct API call from an unpaid or
 * unready business is rejected exactly like a click. The published copy is snapshotted in
 * ExperienceVersion so a future rollback has the data it needs (§15).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { canSetPublished, hasVerifiedPublicationRight } from "@/lib/publication";
import { getBusinessUrl } from "@/lib/url";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import { getInteractiveEntitlement, syncInteractiveEntitlement } from "@/lib/experience/entitlement";
import { findInvalidCatalogueItems, validateForPublication } from "@/lib/experience/validate";

export const dynamic = "force-dynamic";

const DRAFT_CHANGED_CODE = "draft_version_conflict";
const DRAFT_CHANGED_MESSAGE = "Your website changed in another window. Reload to see the latest version, then publish again. Nothing was published.";
const VERSION_REQUIRED_CODE = "draft_version_required";
const VERSION_REQUIRED_MESSAGE = "Reload the page and publish again so we know which version you reviewed.";

type Loaded = Awaited<ReturnType<typeof loadPublishContext>>;

async function loadPublishContext(businessId: string) {
  const [business, experience, productCount, serviceCount, products, paidPayment, subscription] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, slug: true, category: true, phone: true, whatsapp: true, location: true, logoUrl: true, isPublished: true },
    }),
    prisma.businessExperience.findUnique({ where: { businessId } }),
    prisma.product.count({ where: { businessId, isActive: true } }),
    prisma.service.count({ where: { businessId, isActive: true } }),
    prisma.product.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, basePriceKES: true, salePriceKES: true } }),
    prisma.payment.findFirst({ where: { businessId, status: "PAID" }, select: { status: true } }),
    prisma.subscription.findUnique({
      where: { businessId },
      select: { status: true, expiresAt: true, graceUntil: true, plan: { select: { key: true, name: true } } },
    }),
  ]);
  return { business, experience, productCount, serviceCount, products, paidPayment, subscription };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  let businessId = "";
  let action = "publish";
  let expectedDraftVersion = 0;
  try {
    const body = await req.json();
    businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    if (body?.action === "unpublish") action = "unpublish";
    expectedDraftVersion = Number(body?.expectedDraftVersion);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });

  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    const context: Loaded = await loadPublishContext(businessId);
    const { business, experience } = context;
    if (!business) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });

    // Unpublishing is always allowed — never lock an owner out of hiding their site.
    if (action === "unpublish") {
      if (experience) {
        await prisma.businessExperience.update({
          where: { businessId },
          data: { status: "UNPUBLISHED", publishedAt: null },
        });
      }
      await prisma.business.update({ where: { id: businessId }, data: { isPublished: false } });
      await logAudit({ actorId: session.userId, action: "EXPERIENCE_UNPUBLISHED", targetType: "BUSINESS", targetId: businessId });
      return NextResponse.json({ published: false, status: "UNPUBLISHED" });
    }

    if (!experience) return NextResponse.json({ error: "Create your website before publishing it." }, { status: 409 });

    // A publish publishes exactly the draft the owner reviewed. That draft is named by its version, so a
    // stale window cannot publish a newer edit it never saw. Missing version: 428 (a precondition), not 409.
    if (!(Number.isInteger(expectedDraftVersion) && expectedDraftVersion > 0)) {
      return NextResponse.json({ error: VERSION_REQUIRED_MESSAGE, code: VERSION_REQUIRED_CODE }, { status: 428 });
    }

    const isAdmin = session.role === "ADMIN";
    const entitlement = await getInteractiveEntitlement(businessId);
    const document = normalizeExperienceDocument(JSON.parse(experience.draftJson), experience.categoryKey);

    const validation = validateForPublication({
      document,
      business,
      productCount: context.productCount,
      serviceCount: context.serviceCount,
      invalidItems: findInvalidCatalogueItems(context.products),
      entitlement,
      paidPayment: context.paidPayment,
      subscription: context.subscription,
    });

    // Payment-before-publication is enforced with the existing gate (§3) — not a new one.
    const verifiedPayment = hasVerifiedPublicationRight({ paidPayment: context.paidPayment, subscription: context.subscription });
    if (!canSetPublished(true, { isAdmin, verifiedPayment })) {
      return NextResponse.json({
        error: SAFE_ERRORS.publishPaymentRequired,
        published: false,
        validation,
        requires: "PAYMENT",
      }, { status: 403 });
    }
    if (!entitlement.entitled) {
      return NextResponse.json({
        error: entitlement.reason,
        published: false,
        validation,
        requires: "ENTITLEMENT",
      }, { status: 403 });
    }
    if (!validation.ready) {
      return NextResponse.json({
        error: "Your website is not ready to publish yet.",
        published: false,
        validation,
        requires: "VALIDATION",
      }, { status: 409 });
    }

    // Fast path: a stale window is refused before any write. The compare-and-swap below is what makes it safe.
    if (expectedDraftVersion !== Number(experience.draftVersion)) {
      return NextResponse.json({ error: DRAFT_CHANGED_MESSAGE, code: DRAFT_CHANGED_CODE, currentDraftVersion: experience.draftVersion }, { status: 409 });
    }

    const nextVersion = Math.max(1, experience.draftVersion || experience.publishedVersion + 1);
    const publishedAt = new Date();

    // Compare-and-swap: the write applies only if the stored draft is still the one that was validated (same
    // version AND same content). A newer edit in between makes this match no row, and nothing is published.
    const outcome = await prisma.$transaction(async (tx) => {
      const claimed = await tx.businessExperience.updateMany({
        where: { businessId, draftVersion: expectedDraftVersion, draftJson: experience.draftJson },
        data: {
          status: "PUBLISHED",
          publishedJson: JSON.stringify(document),
          publishedVersion: nextVersion,
          draftVersion: nextVersion,
          publishedAt,
          publishedById: session.userId,
        },
      });
      if (claimed.count !== 1) return null;
      const updated = await tx.businessExperience.findUnique({
        where: { businessId },
        select: { id: true, status: true, publishedVersion: true, publishedAt: true },
      });
      if (!updated) return null;
      await tx.experienceVersion.upsert({
        where: { businessId_version: { businessId, version: nextVersion } },
        update: { snapshotJson: JSON.stringify(document), themeKey: document.themeKey, categoryKey: document.categoryKey, publishedAt, publishedById: session.userId },
        create: {
          businessId,
          version: nextVersion,
          snapshotJson: JSON.stringify(document),
          themeKey: document.themeKey,
          categoryKey: document.categoryKey,
          publishedAt,
          publishedById: session.userId,
        },
      });
      await tx.business.update({ where: { id: businessId }, data: { isPublished: true, status: "ACTIVE" } });
      await tx.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "EXPERIENCE_PUBLISHED",
          targetType: "BUSINESS_EXPERIENCE",
          targetId: updated.id,
          metadata: JSON.stringify({ businessId, version: nextVersion, slug: business.slug }),
        },
      });
      return updated;
    });
    if (!outcome) {
      return NextResponse.json({ error: DRAFT_CHANGED_MESSAGE, code: DRAFT_CHANGED_CODE }, { status: 409 });
    }
    const result = outcome;

    await syncInteractiveEntitlement(businessId);

    return NextResponse.json({
      published: true,
      status: result.status,
      version: result.publishedVersion,
      publishedAt: result.publishedAt,
      url: getBusinessUrl(business.slug),
      message: "You’re live 🎉",
    });
  } catch {
    console.error("experience publish failed");
    return NextResponse.json({ error: SAFE_ERRORS.publishFailed }, { status: 500 });
  }
}

/** GET returns the current publish readiness without changing anything (§58). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    const context: Loaded = await loadPublishContext(businessId);
    if (!context.business) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    if (!context.experience) return NextResponse.json({ ready: false, checks: [] });
    const entitlement = await getInteractiveEntitlement(businessId);
    const document = normalizeExperienceDocument(JSON.parse(context.experience.draftJson), context.experience.categoryKey);
    const validation = validateForPublication({
      document,
      business: context.business,
      productCount: context.productCount,
      serviceCount: context.serviceCount,
      invalidItems: findInvalidCatalogueItems(context.products),
      entitlement,
      paidPayment: context.paidPayment,
      subscription: context.subscription,
    });
    return NextResponse.json({ ...validation, entitlement, version: context.experience.draftVersion, publishedVersion: context.experience.publishedVersion });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
