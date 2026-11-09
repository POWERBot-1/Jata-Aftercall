import { notFound } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { seoMetadataFor } from "@/lib/experience/structuredData";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; siteSlug: string }> };

/** Public URL for an independently published secondary Studio website. */
async function loadPublicSite(slug: string, siteSlug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, isPublished: true, status: true },
  });
  if (!business || !business.isPublished || business.status === "SUSPENDED") return null;
  return loadStorefront(slug, { websiteSlug: siteSlug });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const site = await loadPublicSite(slug, siteSlug);
  if (!site) return { title: "Website not found | JATA AFTERCALL", robots: { index: false, follow: false } };
  return seoMetadataFor({ business: site.business, document: site.document, isPreview: false }) as Metadata;
}

export default async function PublicStudioWebsitePage({ params }: Props) {
  const { slug, siteSlug } = await params;
  const site = await loadPublicSite(slug, siteSlug);
  if (!site) notFound();
  return <ExperienceSite data={site} previewNotice={null} />;
}
