import { MetadataRoute } from "next";
import prisma from "@/lib/db";
import { getBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  let businesses: { slug: string; updatedAt: Date }[] = [];
  try {
    businesses = await prisma.business.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true } });
  } catch {}
  return [
    { url: `${base}/`, lastModified: new Date() },
    ...businesses.map((b) => ({ url: `${base}/b/${b.slug}`, lastModified: b.updatedAt })),
  ];
}
