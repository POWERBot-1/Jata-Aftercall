import "server-only";

import prisma from "@/lib/db";

type NativeSite = {
  websiteId: string;
  status: string;
  slug: string;
  draftJson: string | null;
  publishedJson: string | null;
  draftVersion: number;
  publishedVersion: number;
};

export async function getDefaultOpenPageSite(businessId: string): Promise<NativeSite | null> {
  const site = await prisma.studioWebsite.findFirst({
    where: { businessId, isDefault: true },
    select: {
      id: true,
      slug: true,
      status: true,
      openPageDocument: {
        select: { draftJson: true, publishedJson: true, draftVersion: true, publishedVersion: true },
      },
    },
  });
  if (!site) return null;
  return {
    websiteId: site.id,
    slug: site.slug,
    status: site.status,
    draftJson: site.openPageDocument?.draftJson ?? null,
    publishedJson: site.openPageDocument?.publishedJson ?? null,
    draftVersion: site.openPageDocument?.draftVersion ?? 0,
    publishedVersion: site.openPageDocument?.publishedVersion ?? 0,
  };
}

export function resolveOpenPagePublicConfig(
  site: NativeSite | null,
  options: { allowDraft: boolean; preferDraft: boolean },
): { config: Record<string, unknown>; isPreview: boolean; publishedVersion: number } | null {
  if (!site || site.status === "SUSPENDED" || site.status === "UNPUBLISHED") return null;
  const json = options.allowDraft && options.preferDraft
    ? site.draftJson
    : site.status === "PUBLISHED"
      ? site.publishedJson
      : null;
  if (!json) return null;
  try {
    const config = JSON.parse(json);
    if (!config || typeof config !== "object" || Array.isArray(config) || !Array.isArray(config.blocks)) return null;
    return {
      config,
      isPreview: options.allowDraft && options.preferDraft,
      publishedVersion: site.publishedVersion,
    };
  } catch {
    return null;
  }
}
