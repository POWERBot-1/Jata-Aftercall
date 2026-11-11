import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { getInteractiveEntitlement } from "@/lib/experience/entitlement";

export const dynamic = "force-dynamic";

const BLOCK_TYPES = new Set([
  "navbar", "hero", "features", "pricing", "cta", "footer", "testimonials",
  "stats", "faq", "team", "contact", "newsletter", "logocloud", "divider",
  "banner", "content", "image", "video", "gallery",
]);

function validateSiteConfig(input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "A valid OpenPage site configuration is required." };
  const value = input as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 160) return { ok: false, error: "The site name is missing or too long." };
  if (!Array.isArray(value.blocks)) return { ok: false, error: "The OpenPage blocks array is required." };
  if (value.blocks.length > 250) return { ok: false, error: "This site contains too many blocks." };
  const validateBlocks = (blocks: unknown[]) => blocks.every((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const item = block as Record<string, unknown>;
    return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 120
      && typeof item.type === "string" && BLOCK_TYPES.has(item.type)
      && typeof item.variant === "string" && item.variant.length <= 80
      && !!item.props && typeof item.props === "object" && !Array.isArray(item.props);
  });
  if (!validateBlocks(value.blocks)) return { ok: false, error: "One or more OpenPage blocks are invalid." };
  if (value.pages !== undefined) {
    if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 50) return { ok: false, error: "The OpenPage pages array is invalid." };
    for (const page of value.pages) {
      if (!page || typeof page !== "object" || Array.isArray(page)) return { ok: false, error: "An OpenPage page is invalid." };
      const item = page as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string" || !Array.isArray(item.blocks) || item.blocks.length > 250 || !validateBlocks(item.blocks)) {
        return { ok: false, error: "An OpenPage page or its blocks are invalid." };
      }
    }
  }
  return { ok: true, value };
}

function statusOf(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return status >= 400 && status <= 599 ? status : 500;
}

/** Read the native OpenPage document for one authorized JATA website. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  const websiteId = new URL(request.url).searchParams.get("websiteId")?.trim() || "";
  if (!websiteId) return NextResponse.json({ error: "Choose a website first." }, { status: 400 });
  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "read");
    const document = await prisma.openPageSiteDocument.findUnique({
      where: { websiteId: access.websiteId },
      include: { revisions: { orderBy: { draftVersion: "desc" }, take: 20, select: { draftVersion: true, source: true, createdById: true, createdAt: true } } },
    });
    return NextResponse.json({
      website: { id: access.websiteId, businessId: access.businessId, slug: access.slug, name: access.name },
      document: document ? {
        config: JSON.parse(document.draftJson),
        draftVersion: document.draftVersion,
        publishedVersion: document.publishedVersion,
        publishedAt: document.publishedAt,
        updatedAt: document.updatedAt,
        revisions: document.revisions,
      } : null,
    });
  } catch (error) {
    const status = statusOf(error);
    return NextResponse.json({ error: status === 404 ? "Studio website not found." : status === 403 ? "You do not have permission to access this website." : "We could not load this OpenPage document." }, { status });
  }
}

/** Save OpenPage-native JSON independently of the legacy ExperienceDocument renderer. */
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

  const validated = validateSiteConfig(body.config);
  if (!validated.ok) return NextResponse.json({ error: validated.error, code: "openpage_schema_invalid" }, { status: 422 });

  let serialized: string;
  try {
    serialized = JSON.stringify(validated.value);
  } catch {
    return NextResponse.json({ error: "The OpenPage document is not valid JSON." }, { status: 400 });
  }
  if (serialized.length > 1_500_000) return NextResponse.json({ error: "The OpenPage document exceeds the 1.5 MB limit." }, { status: 413 });
  if (/data:image\//i.test(serialized)) return NextResponse.json({ error: "Store images in the JATA media library and reference their URLs; inline image data is not accepted." }, { status: 422 });

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "edit");
    const entitlement = await getInteractiveEntitlement(access.businessId);
    if (!entitlement.entitled) {
      return NextResponse.json({ error: entitlement.reason, code: "website_studio_entitlement_required" }, { status: 402 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.openPageSiteDocument.findUnique({ where: { websiteId: access.websiteId } });
      if (!current) {
        if (expectedDraftVersion !== 0) return { conflict: true as const, currentDraftVersion: 0 };
        const created = await tx.openPageSiteDocument.create({
          data: {
            websiteId: access.websiteId,
            draftJson: serialized,
            draftVersion: 1,
            revisions: {
              create: {
                draftVersion: 1,
                snapshotJson: serialized,
                source: "EDIT",
                createdById: session.userId,
              },
            },
          },
        });
        return { conflict: false as const, draftVersion: created.draftVersion };
      }

      if (current.draftVersion !== expectedDraftVersion) {
        return { conflict: true as const, currentDraftVersion: current.draftVersion };
      }

      const nextVersion = current.draftVersion + 1;
      const changed = await tx.openPageSiteDocument.updateMany({
        where: { websiteId: access.websiteId, draftVersion: expectedDraftVersion },
        data: { draftJson: serialized, draftVersion: nextVersion },
      });
      if (changed.count !== 1) {
        const latest = await tx.openPageSiteDocument.findUnique({
          where: { websiteId: access.websiteId },
          select: { draftVersion: true },
        });
        return { conflict: true as const, currentDraftVersion: latest?.draftVersion ?? null };
      }

      await tx.openPageSiteRevision.create({
        data: {
          websiteId: access.websiteId,
          draftVersion: nextVersion,
          snapshotJson: serialized,
          source: "EDIT",
          createdById: session.userId,
        },
      });
      return { conflict: false as const, draftVersion: nextVersion };
    });

    if (result.conflict) {
      return NextResponse.json({
        error: "This OpenPage draft changed in another window. Reload the latest draft.",
        code: "openpage_draft_version_conflict",
        currentDraftVersion: result.currentDraftVersion,
      }, { status: 409 });
    }
    return NextResponse.json({ saved: true, websiteId, draftVersion: result.draftVersion, config: validated.value });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      const latest = await prisma.openPageSiteDocument.findUnique({
        where: { websiteId },
        select: { draftVersion: true },
      }).catch(() => null);
      return NextResponse.json({
        error: "This OpenPage draft changed in another window. Reload the latest draft.",
        code: "openpage_draft_version_conflict",
        currentDraftVersion: latest?.draftVersion ?? null,
      }, { status: 409 });
    }
    const status = statusOf(error);
    return NextResponse.json({
      error: status === 404 ? "Studio website not found." : status === 403 ? "You do not have permission to edit this website." : "We could not save this OpenPage document.",
    }, { status });
  }
}
