import prisma from "@/lib/db";

/**
 * Materialize the independent website content row from the legacy default-site
 * experience exactly once. The legacy row remains authoritative until the later
 * public-render cutover phase; this helper never mutates it.
 */
export async function ensureStudioWebsiteContent(websiteId: string, businessId: string) {
  const legacy = await prisma.businessExperience.findUnique({
    where: { businessId },
    select: {
      draftJson: true,
      publishedJson: true,
      draftVersion: true,
      historyCursor: true,
      publishedVersion: true,
      publishedAt: true,
      publishedById: true,
      themeKey: true,
      categoryKey: true,
    },
  });

  const content = await prisma.studioWebsiteContent.upsert({
    where: { websiteId },
    create: {
      id: `swc_${websiteId}`,
      websiteId,
      draftJson: legacy?.draftJson ?? null,
      publishedJson: legacy?.publishedJson ?? null,
      draftVersion: legacy?.draftVersion ?? 0,
      historyCursor: legacy?.historyCursor ?? legacy?.draftVersion ?? 0,
      publishedVersion: legacy?.publishedVersion ?? 0,
      publishedAt: legacy?.publishedAt ?? null,
      publishedById: legacy?.publishedById ?? null,
    },
    update: {},
  });

  if (content.draftJson && content.draftVersion > 0) {
    await prisma.studioWebsiteDraftRevision.upsert({
      where: { websiteId_draftVersion: { websiteId, draftVersion: content.draftVersion } },
      create: {
        id: `swdr_${websiteId}_${content.draftVersion}`,
        websiteId,
        draftVersion: content.draftVersion,
        source: "MIGRATION",
        label: "Initial draft copied from the existing Website Studio",
        snapshotJson: content.draftJson,
      },
      update: {},
    });
  }

  if (legacy?.publishedJson && Number(legacy.publishedVersion) > 0) {
    await prisma.studioWebsiteVersion.upsert({
      where: { websiteId_version: { websiteId, version: legacy.publishedVersion } },
      create: {
        id: `swv_${websiteId}_${legacy.publishedVersion}`,
        websiteId,
        version: legacy.publishedVersion,
        snapshotJson: legacy.publishedJson,
        themeKey: legacy.themeKey,
        categoryKey: legacy.categoryKey,
        note: "Initial snapshot migrated from the legacy default site",
        publishedById: legacy.publishedById,
        publishedAt: legacy.publishedAt ?? new Date(),
      },
      update: {},
    });
  }

  return content;
}
