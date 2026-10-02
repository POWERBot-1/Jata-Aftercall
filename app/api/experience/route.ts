/**
 * Experience API (§14–§16, §37, §58)
 *
 * Draft editing for one tenant. Every request is authenticated and ownership-checked
 * server-side; a businessId from another account is rejected before any data is read.
 * Draft edits never touch what customers see (§15).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation, TenantError } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { getExperienceProfile, isCategoryKey } from "@/lib/experience/categories";
import {
  addSection,
  createExperienceDocument,
  duplicateSection,
  hasUnpublishedChanges,
  moveSection,
  normalizeExperienceDocument,
  removeSection,
  updateSection,
} from "@/lib/experience/document";
import { isValidThemeKey } from "@/lib/experience/themes";
import { getInteractiveEntitlement } from "@/lib/experience/entitlement";
import { validateForPublication, findInvalidCatalogueItems } from "@/lib/experience/validate";
import { isSectionType } from "@/lib/experience/sections";

export const dynamic = "force-dynamic";

type SectionOp = "add" | "remove" | "move" | "duplicate" | "toggle" | "update";

function parseDocument(json: string | null | undefined, fallbackCategory?: string) {
  if (!json) return null;
  try {
    return normalizeExperienceDocument(JSON.parse(json), fallbackCategory);
  } catch {
    return null;
  }
}

/** Load everything the editor and the publish gate need, scoped to one tenant. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });

  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    const [business, experience, productCount, serviceCount, products] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, slug: true, category: true, phone: true, whatsapp: true, location: true, logoUrl: true, isPublished: true, description: true },
      }),
      prisma.businessExperience.findUnique({ where: { businessId } }),
      prisma.product.count({ where: { businessId, isActive: true } }),
      prisma.service.count({ where: { businessId, isActive: true } }),
      prisma.product.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, basePriceKES: true, salePriceKES: true } }),
    ]);
    if (!business) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });

    const draft = parseDocument(experience?.draftJson, experience?.categoryKey ?? business.category);
    const published = parseDocument(experience?.publishedJson, experience?.categoryKey ?? business.category);
    const categoryKey = experience?.categoryKey || (draft?.categoryKey as string) || business.category || "other";
    const profile = getExperienceProfile(categoryKey);
    const entitlement = await getInteractiveEntitlement(businessId);
    const paidPayment = await prisma.payment.findFirst({ where: { businessId, status: "PAID" }, select: { status: true } });
    const subscription = await prisma.subscription.findUnique({
      where: { businessId },
      select: { status: true, expiresAt: true, graceUntil: true, plan: { select: { key: true, name: true, priceKES: true } } },
    });

    const document = draft || createExperienceDocument({
      categoryKey,
      businessName: business.name,
      description: business.description,
      phone: business.phone,
      whatsapp: business.whatsapp,
      location: business.location,
      themeKey: experience?.themeKey,
    });

    const validation = validateForPublication({
      document,
      business,
      productCount,
      serviceCount,
      invalidItems: findInvalidCatalogueItems(products),
      entitlement,
      paidPayment,
      subscription,
    });

    return NextResponse.json({
      business,
      profile,
      experience: experience
        ? {
            id: experience.id,
            status: experience.status,
            categoryKey: experience.categoryKey,
            themeKey: experience.themeKey,
            draftVersion: experience.draftVersion,
            publishedVersion: experience.publishedVersion,
            publishedAt: experience.publishedAt,
            updatedAt: experience.updatedAt,
          }
        : null,
      document,
      publishedDocument: published,
      hasDraft: Boolean(experience),
      hasUnpublishedChanges: hasUnpublishedChanges(experience?.draftJson, experience?.publishedJson),
      entitlement,
      subscription,
      counts: { products: productCount, services: serviceCount },
      validation,
    });
  } catch {
    console.error("experience read failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

/** Create the draft website for a business that has chosen its category. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const categoryKey = isCategoryKey(body?.categoryKey) ? body.categoryKey : null;
    if (!categoryKey) return NextResponse.json({ error: "Choose the type of business you run." }, { status: 400 });

    const existing = await prisma.businessExperience.findUnique({ where: { businessId } });
    if (existing) {
      const document = normalizeExperienceDocument(
        { ...parseDocument(existing.draftJson, existing.categoryKey), categoryKey, themeKey: body?.themeKey || existing.themeKey },
        categoryKey,
      );
      const profile = getExperienceProfile(categoryKey);
      const updated = await prisma.businessExperience.update({
        where: { businessId },
        data: {
          categoryKey,
          themeKey: isValidThemeKey(body?.themeKey) ? body.themeKey : profile.defaultThemeKey,
          draftJson: JSON.stringify(document),
          draftVersion: { increment: 1 },
        },
      });
      return NextResponse.json({ experience: updated, document, idempotent: true });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, description: true, phone: true, whatsapp: true, location: true, category: true },
    });
    if (!business) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });

    const document = createExperienceDocument({
      categoryKey,
      businessName: business.name,
      description: business.description,
      phone: business.phone,
      whatsapp: business.whatsapp,
      location: business.location,
      themeKey: typeof body?.themeKey === "string" ? body.themeKey : null,
    });

    const experience = await prisma.businessExperience.create({
      data: {
        businessId,
        categoryKey,
        themeKey: document.themeKey,
        draftJson: JSON.stringify(document),
        draftVersion: 1,
        status: "DRAFT",
      },
    });
    await logAudit({ actorId: session.userId, action: "EXPERIENCE_CREATED", targetType: "BUSINESS_EXPERIENCE", targetId: experience.id, metadata: { businessId, categoryKey } });

    return NextResponse.json({ experience, document }, { status: 201 });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("experience create failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

/**
 * Apply an edit. Supports either a whole normalized document or a single section operation,
 * so a phone on a slow connection sends a few bytes rather than the entire site.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const experience = await prisma.businessExperience.findUnique({ where: { businessId } });
    if (!experience) return NextResponse.json({ error: "Create your website before editing it." }, { status: 409 });

    let document = parseDocument(experience.draftJson, experience.categoryKey);
    if (!document) document = createExperienceDocument({ categoryKey: experience.categoryKey, businessName: "" });

    const op = typeof body?.op === "string" ? (body.op as SectionOp) : null;
    if (op) {
      const sectionId = typeof body?.sectionId === "string" ? body.sectionId : "";
      switch (op) {
        case "add":
          if (!isSectionType(body?.type)) return NextResponse.json({ error: "That section type is not supported." }, { status: 400 });
          document = addSection(document, body.type);
          break;
        case "remove":
          document = removeSection(document, sectionId);
          break;
        case "move":
          document = moveSection(document, sectionId, body?.direction === "up" ? "up" : "down");
          break;
        case "duplicate":
          document = duplicateSection(document, sectionId);
          break;
        case "toggle": {
          const section = document.sections.find((entry) => entry.id === sectionId);
          if (section) document = updateSection(document, sectionId, { visible: !section.visible });
          break;
        }
        case "update":
          document = updateSection(document, sectionId, body?.patch && typeof body.patch === "object" ? body.patch : {});
          break;
        default:
          return NextResponse.json({ error: "Unsupported edit." }, { status: 400 });
      }
    } else if (body?.document && typeof body.document === "object") {
      document = normalizeExperienceDocument({ ...body.document, categoryKey: document.categoryKey }, document.categoryKey);
    } else {
      // Partial updates: brand, settings, theme, category.
      const next = {
        ...document,
        brand: body?.brand ? { ...document.brand, ...body.brand } : document.brand,
        settings: body?.settings ? { ...document.settings, ...body.settings } : document.settings,
        themeKey: isValidThemeKey(body?.themeKey) ? body.themeKey : document.themeKey,
        categoryKey: isCategoryKey(body?.categoryKey) ? body.categoryKey : document.categoryKey,
      };
      document = normalizeExperienceDocument(next, next.categoryKey);
    }

    document.updatedAt = new Date().toISOString();
    const updated = await prisma.businessExperience.update({
      where: { businessId },
      data: {
        categoryKey: document.categoryKey,
        themeKey: document.themeKey,
        draftJson: JSON.stringify(document),
        draftVersion: { increment: 1 },
      },
      select: { id: true, draftVersion: true, publishedVersion: true, status: true, updatedAt: true },
    });

    return NextResponse.json({ experience: updated, document, saved: true });
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: SAFE_ERRORS.noAccess }, { status: error.status });
    }
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("experience update failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
