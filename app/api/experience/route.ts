/**
 * Experience API (§14–§16, §37, §58)
 *
 * Draft editing for one tenant. Every request is authenticated and ownership-checked
 * server-side; a businessId from another account is rejected before any data is read.
 * Draft edits never touch what customers see (§15).
 */

import { NextResponse } from "next/server";
import { historyBasisFor, seedNewDocument } from "@/lib/experience/variant";
import { diversityReport } from "@/lib/experience/diversity";
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
import { isSectionType, sectionLabel } from "@/lib/experience/sections";
import { applyStudioFix, STUDIO_FIX_IDS, type StudioFixId } from "@/lib/studio/fixes";
import { describeDraftChange, recordDraftRevision, draftCursorOf } from "@/lib/experience/history";

export const dynamic = "force-dynamic";

type SectionOp = "add" | "remove" | "move" | "duplicate" | "toggle" | "update" | "studio-fix";

function parseDocument(json: string | null | undefined, fallbackCategory?: string) {
  if (!json) return null;
  try {
    return normalizeExperienceDocument(JSON.parse(json), fallbackCategory);
  } catch {
    return null;
  }
}

const DRAFT_CHANGED_CODE = "draft_version_conflict";
const DRAFT_CHANGED_MESSAGE = "Your website changed in another window. Reload to see the latest draft, then try again. Nothing was overwritten.";
const VERSION_REQUIRED_CODE = "draft_version_required";
const VERSION_REQUIRED_MESSAGE = "This change needs the draft version it was made from. Reload the page and try again. Nothing was changed.";

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
      // A change of business type rewrites the draft, so it follows the same rule as PATCH: a
      // client that read version N must send N, and the write is a compare-and-swap on it.
      const expectedDraftVersion = Number(body?.expectedDraftVersion);
      // Creating a website is the only thing this form does for a business with no draft. For a business
      // that already has one, a change must name the version it was made from, so a stale window that
      // still shows "create" cannot silently rewrite a newer draft.
      if (!(Number.isInteger(expectedDraftVersion) && expectedDraftVersion > 0)) {
        return NextResponse.json({ error: VERSION_REQUIRED_MESSAGE, code: VERSION_REQUIRED_CODE }, { status: 428 });
      }
      if (expectedDraftVersion !== Number(existing.draftVersion)) {
        return NextResponse.json({ error: DRAFT_CHANGED_MESSAGE, code: DRAFT_CHANGED_CODE, currentDraftVersion: existing.draftVersion }, { status: 409 });
      }
      const nextVersion = Math.max(1, Number(existing.draftVersion) || 1) + 1;
      const updated = await prisma.businessExperience
        .update({
          where: { businessId, draftVersion: existing.draftVersion },
          data: {
            categoryKey,
            themeKey: isValidThemeKey(body?.themeKey) ? body.themeKey : profile.defaultThemeKey,
            draftJson: JSON.stringify(document),
            draftVersion: nextVersion,
            historyCursor: nextVersion,
          },
        })
        .catch((error: unknown) => {
          if ((error as { code?: string })?.code === "P2025") return null;
          throw error;
        });
      if (!updated) {
        return NextResponse.json({ error: DRAFT_CHANGED_MESSAGE, code: DRAFT_CHANGED_CODE }, { status: 409 });
      }
      await recordDraftRevision(prisma, {
        businessId,
        draftVersion: nextVersion,
        discardAfter: draftCursorOf(existing),
        document,
        label: `Changed your business type to ${profile.label}`,
        source: "EDIT",
        createdById: session.userId,
      });
      return NextResponse.json({ experience: updated, document, idempotent: true });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, description: true, phone: true, whatsapp: true, location: true, category: true },
    });
    if (!business) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });

    // The new draft is seeded so later regenerations are reproducible. A brand-new business has no
    // published history to compare against, so the diversity status says so instead of claiming a check.
    const seeded = seedNewDocument(
      createExperienceDocument({
      categoryKey,
      businessName: business.name,
      description: business.description,
      phone: business.phone,
      whatsapp: business.whatsapp,
      location: business.location,
      themeKey: typeof body?.themeKey === "string" ? body.themeKey : null,
      }),
      businessId,
    );
    const document = seeded.document;

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
    await recordDraftRevision(prisma, {
      businessId,
      draftVersion: 1,
      discardAfter: 0,
      document,
      label: "Created your website",
      source: "SYSTEM",
      createdById: session.userId,
    });

    // Informational only. The default layout is deterministic (nothing is generated to choose from), so
    // nothing is blocked. If this business has published versions, the new draft is compared with them.
    let publishedDocuments: ReturnType<typeof normalizeExperienceDocument>[] = [];
    try {
      const versions = await prisma.experienceVersion.findMany({
        where: { businessId },
        orderBy: { version: "desc" },
        take: 5,
        select: { snapshotJson: true },
      });
      publishedDocuments = versions.flatMap((row) => {
        try {
          return [normalizeExperienceDocument(JSON.parse(row.snapshotJson || "{}"), document.categoryKey)];
        } catch {
          return [];
        }
      });
    } catch {
      publishedDocuments = [];
    }
    const diversity = publishedDocuments.length > 0
      ? { ...diversityReport(document, publishedDocuments), ...historyBasisFor(publishedDocuments.length), seed: seeded.diversity.seed }
      : seeded.diversity;

    return NextResponse.json({ experience, document, diversity }, { status: 201 });
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

    // Optimistic concurrency, mandatory for every draft write (section ops, studio fixes, theme and brand
    // edits, and whole-document saves). A client sends the draft version it read. Missing or malformed: 428
    // (a precondition is missing; nothing was changed). Stale: 409 (the draft has moved on). The write below
    // is also a compare-and-swap on that version, so a write that lands between this check and the update is
    // refused too.
    const expectedDraftVersion = Number(body?.expectedDraftVersion);
    if (!(Number.isInteger(expectedDraftVersion) && expectedDraftVersion > 0)) {
      return NextResponse.json({ error: VERSION_REQUIRED_MESSAGE, code: VERSION_REQUIRED_CODE }, { status: 428 });
    }
    if (expectedDraftVersion !== Number(experience.draftVersion)) {
      return NextResponse.json({ error: DRAFT_CHANGED_MESSAGE, code: DRAFT_CHANGED_CODE, currentDraftVersion: experience.draftVersion }, { status: 409 });
    }

    let document = parseDocument(experience.draftJson, experience.categoryKey);
    if (!document) document = createExperienceDocument({ categoryKey: experience.categoryKey, businessName: "" });
    let summary: Record<string, unknown> | null = null;

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
        case "studio-fix": {
          // "Fix with JATA" (§36): a health-check remedy applied to the draft through this one
          // write path, so it is normalized, versioned and undoable exactly like a manual edit.
          const fixId = typeof body?.fixId === "string" ? (body.fixId as StudioFixId) : null;
          if (!fixId || !STUDIO_FIX_IDS.includes(fixId)) {
            return NextResponse.json({ error: "That fix is not available." }, { status: 400 });
          }
          const businessRow = await prisma.business.findUnique({
            where: { id: businessId },
            select: { name: true, description: true, location: true, phone: true, whatsapp: true, openingHours: true },
          });
          const hours = (() => {
            if (!businessRow?.openingHours) return null;
            try {
              const parsed = JSON.parse(businessRow.openingHours);
              return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : null;
            } catch {
              return null;
            }
          })();
          const outcome = applyStudioFix(document, fixId, {
            businessName: businessRow?.name || "",
            description: businessRow?.description,
            location: businessRow?.location,
            phone: businessRow?.phone,
            whatsapp: businessRow?.whatsapp,
            openingHours: hours,
          });
          if (outcome.status !== "applied") {
            return NextResponse.json(
              { error: outcome.reason, needsOwnerInput: outcome.needsOwnerInput ?? null, applied: false },
              { status: 409 },
            );
          }
          document = normalizeExperienceDocument(outcome.document, outcome.document.categoryKey);
          summary = { fix: fixId, summary: outcome.summary, changedSections: outcome.changedSections };
          break;
        }
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
        // Design intent chosen in the Studio (photography language + direction) is part of the
        // document, so it travels with the draft and drives future AI generation (§44).
        photographyStyle: typeof body?.photographyStyle === "string" ? body.photographyStyle : document.photographyStyle,
        designDirectionKey: typeof body?.designDirectionKey === "string" ? body.designDirectionKey : document.designDirectionKey,
      };
      document = normalizeExperienceDocument(next, next.categoryKey);
    }

    document.updatedAt = new Date().toISOString();
    const nextVersion = Math.max(1, Number(experience.draftVersion) || 1) + 1;
    // Compare-and-swap on the version this edit was built from. If another write landed first, the
    // row no longer matches, Prisma reports P2025, and the owner gets a conflict instead of an overwrite.
    const updated = await prisma.businessExperience
      .update({
        where: { businessId, draftVersion: experience.draftVersion },
        data: {
          categoryKey: document.categoryKey,
          themeKey: document.themeKey,
          draftJson: JSON.stringify(document),
          draftVersion: nextVersion,
          historyCursor: nextVersion,
        },
        select: { id: true, draftVersion: true, publishedVersion: true, status: true, updatedAt: true },
      })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === "P2025") return null;
        throw error;
      });
    if (!updated) {
      return NextResponse.json({ error: DRAFT_CHANGED_MESSAGE, code: DRAFT_CHANGED_CODE }, { status: 409 });
    }

    // One revision per owner-visible change — the single mechanism behind Undo and Redo for
    // sections, design, photos, catalogue edits and AI copy alike (§45). Recording can fail
    // without failing the edit, so an owner never loses work to a history write (§47).
    const affected = typeof body?.sectionId === "string" ? document.sections.find((entry) => entry.id === body.sectionId) : null;
    const affectedType = affected?.type || (isSectionType(body?.type) ? body.type : null);
    const changeKind = op
      ? op
      : body?.brand
        ? "brand"
        : body?.settings
          ? "settings"
          : body?.themeKey || body?.photographyStyle || body?.designDirectionKey
            ? "theme"
            : "document";
    await recordDraftRevision(prisma, {
      businessId,
      draftVersion: nextVersion,
      discardAfter: draftCursorOf(experience),
      document,
      label: describeDraftChange(changeKind, {
        type: affectedType || undefined,
        label: affectedType ? sectionLabel(affectedType) : undefined,
        fixLabel: typeof summary?.summary === "string" ? summary.summary : undefined,
      }),
      source: op === "studio-fix" ? "AI" : "EDIT",
      createdById: session.userId,
    });

    return NextResponse.json({
      experience: updated,
      document,
      saved: true,
      canUndo: nextVersion > 1,
      ...(summary ? { summary } : {}),
    });
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: SAFE_ERRORS.noAccess }, { status: error.status });
    }
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("experience update failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
