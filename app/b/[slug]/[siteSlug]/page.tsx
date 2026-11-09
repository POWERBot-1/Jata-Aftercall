import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadStorefront, type StorefrontData } from "@/lib/experience/storefront";
import { seoMetadataFor, structuredDataFor } from "@/lib/experience/structuredData";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; siteSlug: string }> };

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
  try {
    return await loadStorefront(slug, { websiteSlug: siteSlug });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, siteSlug } = await params;
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
  const { slug, siteSlug } = await params;
  const site = await loadPublicSite(slug, siteSlug);
  if (!site) notFound();
  // `ExperienceSite` is the same composition the default site uses: it supplies the
  // shared `StorefrontShell` (brand navigation, action bar, footer, motion controller)
  // and the template family, so this route inherits the whole design and motion
  // contract instead of re-deriving it. `shell={false}` is deliberately unused here.
  return <ExperienceSite data={site} previewNotice={null} />;
}
