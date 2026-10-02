import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { findItem, loadStorefront } from "@/lib/experience/storefront";
import { seoMetadataFor } from "@/lib/experience/structuredData";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { ItemDetailClient, ItemViewTracker } from "@/components/storefront/ItemDetailClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; id: string }> };

async function canPreview(slug: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  if (session.role === "ADMIN") return true;
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { ownerId: true, members: { select: { userId: true } } },
  });
  if (!business) return false;
  return business.ownerId === session.userId || business.members.some((member) => member.userId === session.userId);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data) return { title: "Page not found", robots: { index: false, follow: false } };
  const item = findItem(data, id);
  if (!item) return { title: "Page not found", robots: { index: false, follow: false } };
  return seoMetadataFor({
    business: data.business,
    document: data.document,
    pageTitle: item.name,
    isPreview: data.isPreview,
  }) as Metadata;
}

export default async function ItemPage({ params }: Props) {
  const { slug, id } = await params;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data) notFound();
  const item = findItem(data, id);
  if (!item) notFound();

  const pool = [...data.items, ...data.services].filter((entry) => entry.id !== item.id);
  const related = pool
    .filter((entry) => entry.category && entry.category === item.category)
    .slice(0, 4)
    .concat(pool.filter((entry) => entry.category !== item.category).slice(0, 4))
    .slice(0, 4)
    .map((entry) => ({ id: entry.id, name: entry.name, price: entry.price, imageUrl: entry.imageUrl }));

  return (
    <StorefrontShell data={data} previewNotice={data.isPreview ? "Draft preview — only you can see these unpublished changes." : null}>
      <ItemViewTracker businessId={data.business.id} itemId={item.id} kind={item.kind} />
      <section className="eb-section">
        <div className="eb-container">
          <ItemDetailClient
            item={item}
            slug={slug}
            businessId={data.business.id}
            capabilities={data.profile.capabilities}
            cta={data.profile.cta}
            itemNoun={data.profile.itemNoun}
            related={related}
          />
        </div>
      </section>
    </StorefrontShell>
  );
}
