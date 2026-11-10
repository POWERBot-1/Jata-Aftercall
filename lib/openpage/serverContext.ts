import "server-only";

/**
 * Tenant-scoped read model for prompt-to-site generation and refinement.
 *
 * Every query is filtered by the businessId that `guardStudioWebsiteMutation` has already
 * authorised. No recent layout or content is read across tenants. Nothing is written.
 */

import prisma from "@/lib/db";
import { createExperienceDocument } from "@/lib/experience/document";
import { validateExperienceJson } from "@/lib/experience/schema";
import type { ExperienceDocument } from "@/lib/experience/types";
import type { StudioBusinessFacts } from "./requirements";

const RECENT_PUBLISHED_LIMIT = 5;

export type StudioGenerationContext = {
  business: {
    id: string;
    name: string;
    slug: string;
    categoryKey: string;
    description: string | null;
    location: string | null;
    phone: string | null;
    whatsapp: string | null;
    openingHours: string | null;
    isPublished: boolean;
  };
  baseDocument: ExperienceDocument;
  draftVersion: number;
  publishedVersion: number;
  hasExperience: boolean;
  counts: { products: number; services: number; media: number };
  recent: ExperienceDocument[];
  facts: StudioBusinessFacts;
};

export type StudioContextResult =
  | { ok: true; context: StudioGenerationContext }
  | { ok: false; status: number; error: string; code?: string };

function parseHours(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export async function loadStudioGenerationContext(businessId: string): Promise<StudioContextResult> {
  const [business, experience, products, services, media, versions] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, slug: true, category: true, description: true, location: true, phone: true, whatsapp: true, openingHours: true, isPublished: true },
    }),
    prisma.businessExperience.findUnique({
      where: { businessId },
      select: { draftJson: true, categoryKey: true, themeKey: true, draftVersion: true, publishedVersion: true },
    }),
    prisma.product.count({ where: { businessId, isActive: true } }),
    prisma.service.count({ where: { businessId, isActive: true } }),
    prisma.mediaAsset.count({ where: { businessId } }),
    prisma.experienceVersion.findMany({
      where: { businessId },
      orderBy: { version: "desc" },
      take: RECENT_PUBLISHED_LIMIT,
      select: { snapshotJson: true },
    }),
  ]);

  if (!business) return { ok: false, status: 404, error: "We couldn't find that business." };

  const categoryKey = experience?.categoryKey || business.category || "other";
  let baseDocument: ExperienceDocument;

  if (experience?.draftJson) {
    const parsed = validateExperienceJson(experience.draftJson, categoryKey);
    if (!parsed.ok) {
      return {
        ok: false,
        status: 409,
        error: "This draft could not be opened safely. Restore a supported version before generating a new website.",
        code: "experience_schema_invalid",
      };
    }
    baseDocument = parsed.document;
  } else {
    baseDocument = createExperienceDocument({
      categoryKey,
      businessName: business.name,
      description: business.description,
      phone: business.phone,
      whatsapp: business.whatsapp,
      location: business.location,
      themeKey: experience?.themeKey,
    });
  }

  const recent: ExperienceDocument[] = versions.flatMap((row) => {
    const parsed = validateExperienceJson(row.snapshotJson || "{}", baseDocument.categoryKey);
    return parsed.ok ? [parsed.document] : [];
  });

  const openingHours = parseHours(business.openingHours);
  const facts: StudioBusinessFacts = {
    name: business.name,
    categoryKey: baseDocument.categoryKey,
    description: business.description,
    location: business.location,
    phone: business.phone,
    whatsapp: business.whatsapp,
    openingHours,
    products,
    services,
    images: media,
  };

  return {
    ok: true,
    context: {
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        categoryKey: baseDocument.categoryKey,
        description: business.description,
        location: business.location,
        phone: business.phone,
        whatsapp: business.whatsapp,
        openingHours: business.openingHours,
        isPublished: business.isPublished,
      },
      baseDocument,
      draftVersion: experience?.draftVersion ?? 1,
      publishedVersion: experience?.publishedVersion ?? 0,
      hasExperience: Boolean(experience),
      counts: { products, services, media },
      recent,
      facts,
    },
  };
}
