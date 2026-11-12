import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadStorefront, type StorefrontData } from "@/lib/experience/storefront";
import { seoMetadataFor, structuredDataFor } from "@/lib/experience/structuredData";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { publicPageDecision } from "@/lib/publication";
import { getDefaultOpenPageSite, resolveOpenPagePublicConfig } from "@/lib/openpage/public-site";
import { getInteractiveEntitlement } from "@/lib/experience/entitlement";
import { OpenPagePublicSite } from "@/components/studio/openpage/OpenPagePublicSite";
import type { SiteConfig } from "@/vendor/openpage/src/blocks/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; sitePath: string[] }> };

/**
 * Public URL for an independently published secondary Studio website:
 * `/b/<businessSlug>/<websiteSlug>`.
 *
 * Tenant and site gating both live in `loadStorefront` →
 * `lib/experience/publication-state.ts`, which resolves the site by
 * (businessId, slug) AND requires that exact site to be published. Nothing here may
 * substitute the tenant's default site when the requested one is missing, unpublished
 * or suspended: that would serve one site's content on another site's URL.
 */
async function loadPublicSite(slug: string, siteSlug: string): Promise<StorefrontData | null> {
  if (siteSlug.includes("/")) return null;
  try {
    return await loadStorefront(slug, { websiteSlug: siteSlug });
  } catch {
    return null;
  }
}

async function loadNativeOpenPagePath(slug: string, sitePath: string[]): Promise<{ config: SiteConfig; businessName: string } | null> {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, isPublished: true, status: true, members: { select: { userId: true, role: true } }, name: true },
  });
  if (!business) return null;
  const session = await getSession();
  const viewer = session ? { userId: session.userId, role: session.role } : null;
  const decision = publicPageDecision({
    business: {
      isPublished: business.isPublished,
      ownerId: business.ownerId,
      ownerMemberIds: business.members.filter((member) => member.role === "OWNER").map((member) => member.userId),
    },
    viewer,
  });
  if (decision !== "public" || business.status === "SUSPENDED") return null;

  const nativeSite = await getDefaultOpenPageSite(business.id);
  if (!nativeSite || nativeSite.status !== "PUBLISHED") return null;
  const native = resolveOpenPagePublicConfig(nativeSite, { allowDraft: false, preferDraft: false });
  if (!native || !(await getInteractiveEntitlement(business.id)).entitled) return null;
  const config = native.config as unknown as SiteConfig;
  const expectedPath = `/${sitePath.filter(Boolean).join("/")}`;
  const normalizePath = (value: string) => `/${value.split("/").filter(Boolean).join("/")}`;
  if (!(config.pages ?? []).some((page) => normalizePath(page.path) === normalizePath(expectedPath))) return null;
  return { config, businessName: business.name };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, sitePath } = await params;
  const siteSlug = sitePath.join("/");
  const native = await loadNativeOpenPagePath(slug, sitePath);
  if (native) {
    const siteName = typeof native.config.name === "string" ? native.config.name : native.businessName;
    return {
      title: `${siteName} | ${native.businessName}`,
      alternates: { canonical: `/b/${slug}/${siteSlug}` },
    };
  }
  const site = await loadPublicSite(slug, siteSlug);
  if (!site) return { title: "Website not found | JATA AFTERCALL", robots: { index: false, follow: false } };
  return seoMetadataFor({
    business: site.business,
    document: site.document,
    isPreview: false,
    // The secondary site is its own canonical page, not a duplicate of the default one.
    canonicalPath: `/b/${site.business.slug}/${siteSlug}`,
  }) as Metadata;
}

export default async function PublicStudioWebsitePage({ params }: Props) {
  const { slug, sitePath } = await params;
  const siteSlug = sitePath.join("/");
  const native = await loadNativeOpenPagePath(slug, sitePath);
  if (native) {
    return <OpenPagePublicSite config={native.config} pagePath={`/${sitePath.join("/")}`} />;
  }
  const site = await loadPublicSite(slug, siteSlug);
  if (!site) notFound();
  // `ExperienceSite` is the same composition the default site uses: it supplies the
  // shared `StorefrontShell` (brand navigation, action bar, footer, motion controller)
  // and the template family, so this route inherits the whole design and motion
  // contract instead of re-deriving it. `shell={false}` is deliberately unused here.
  return <ExperienceSite data={site} previewNotice={null} />;
}
