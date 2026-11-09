import prisma from "@/lib/db";

/**
 * Materialize the independent website content row from the legacy default-site
 * experience exactly once. The legacy row remains authoritative until the later
 * public-render cutover phase; this helper never mutates it.
 *
 * CONCURRENCY
 * -----------
 * Two requests can reach this helper simultaneously — an owner opening Studio while the
 * publish endpoint runs, or two publish calls racing. A read-then-create, or a Prisma
 * `upsert` with an explicit `id`, is not atomic against a concurrent insert: both callers
 * see no row, both try to create, and the loser fails with P2002 on the primary key. That
 * turned a legal publication into a 500 instead of the 409/200 the state machine promises.
 *
 * Every write below is therefore an insert that tolerates the row already existing
 * (`createMany({ skipDuplicates: true })` → `ON CONFLICT DO NOTHING`), and the result is
 * read back afterwards. Seeding is idempotent by construction, so no partial history row can
 * be left behind by a failed caller.
 */
export async function ensureStudioWebsiteContent(websiteId: string, businessId: string) {
  const existing = await prisma.studioWebsiteContent.findUnique({ where: { websiteId } });
  if (existing) {
    await seedHistory(websiteId, businessId, existing);
    return existing;
  }

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

  await prisma.studioWebsiteContent.createMany({
    data: [
      {
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
    ],
    skipDuplicates: true,
  });

  const content = await prisma.studioWebsiteContent.findUnique({ where: { websiteId } });
  // A concurrent caller created it between our read and our insert; that row is as good as
  // the one we would have written, and it is the one the unique constraint kept.
  if (!content) throw new Error("STUDIO_WEBSITE_CONTENT_UNAVAILABLE");
  await seedHistory(websiteId, businessId, content);
  return content;
}

type ContentRow = {
  draftJson: string | null;
  draftVersion: number;
  publishedJson: string | null;
  publishedVersion: number;
};

/**
 * Seed the migrated draft revision and publication version for this site. Both are
 * append-only and idempotent: a second caller inserts nothing, and the site's stable
 * identifiers survive a retry without ever rewriting history.
 */
async function seedHistory(websiteId: string, businessId: string, content: ContentRow) {
  if (!content.draftJson || Number(content.draftVersion) <= 0) {
    // No draft to migrate; still make sure a migrated publication has its version row.
    await seedPublishedVersion(websiteId, businessId, content);
    return;
  }

  await prisma.studioWebsiteDraftRevision.createMany({
    data: [
      {
        id: `swdr_${websiteId}_${content.draftVersion}`,
        websiteId,
        draftVersion: Number(content.draftVersion),
        source: "MIGRATION",
        label: "Initial draft copied from the existing Website Studio",
        snapshotJson: content.draftJson,
      },
    ],
    skipDuplicates: true,
  });

  await seedPublishedVersion(websiteId, businessId, content);
}

async function seedPublishedVersion(websiteId: string, businessId: string, content: ContentRow) {
  if (!content.publishedJson || Number(content.publishedVersion) <= 0) return;

  const legacy = await prisma.businessExperience.findUnique({
    where: { businessId },
    select: { themeKey: true, categoryKey: true, publishedById: true, publishedAt: true },
  });

  await prisma.studioWebsiteVersion.createMany({
    data: [
      {
        id: `swv_${websiteId}_${content.publishedVersion}`,
        websiteId,
        version: Number(content.publishedVersion),
        snapshotJson: content.publishedJson,
        themeKey: legacy?.themeKey ?? null,
        categoryKey: legacy?.categoryKey ?? null,
        note: "Initial snapshot migrated from the legacy default site",
        publishedById: legacy?.publishedById ?? null,
        publishedAt: legacy?.publishedAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
}
