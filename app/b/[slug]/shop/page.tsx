import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { requestCache } from "@/lib/request-cache";
import { seoMetadataFor } from "@/lib/experience/structuredData";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { CatalogueClient } from "@/components/storefront/CatalogueClient";
import { priceBandsFor, itemCardDataFor } from "@/lib/experience/catalogue";

import { documentBusinessRecipe, recipeCatalogue, BUSINESS_RECIPES, sectionBusinessRecipe } from "@/lib/experience/businessRecipes";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string }> };

// M11 #418: shared per-request with `generateMetadata` and the body (lib/request-cache.ts).
const canPreview = requestCache(async (slug: string): Promise<boolean> => {
  const session = await getSession();
  if (!session) return false;
  if (session.role === "ADMIN") return true;
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { ownerId: true, members: { select: { userId: true } } },
  });
  if (!business) return false;
  return business.ownerId === session.userId || business.members.some((member) => member.userId === session.userId);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data) return { title: "Page not found", robots: { index: false, follow: false } };
  return seoMetadataFor({
    business: data.business,
    document: data.document,
    pageTitle: data.profile.catalogueLabel,
    isPreview: data.isPreview,
  }) as Metadata;
}

export default async function ShopPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { category } = await searchParams;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data) notFound();

  const booking = data.profile.capabilities.includes("booking");
  const recipe = documentBusinessRecipe(data.document);
  const definition = BUSINESS_RECIPES.find((entry) => entry.key === recipe?.key);
  const catalogue = recipe ? recipeCatalogue(data, recipe) : booking && data.items.length === 0 ? data.services : data.profile.capabilities.includes("commerce") || data.profile.capabilities.includes("catalogue") ? data.items : data.services;
  const prices = catalogue.map((item) => item.price).filter((price): price is number => typeof price === "number" && price > 0);

  return (
    <StorefrontShell data={data} previewNotice={data.isPreview ? "Draft preview — only you can see these unpublished changes." : null}>
      <section className="eb-section">
        <div className="eb-container">
          <header className="eb-section-head">
            <div>
              <h1 className="eb-h2">{data.profile.catalogueLabel}</h1>
              <p className="eb-lede">
                {catalogue.length} {catalogue.length === 1 ? data.profile.itemNoun.toLowerCase() : data.profile.itemNounPlural.toLowerCase()}
                {prices.length ? ` · from ${Math.min(...prices).toLocaleString("en-KE")} KES` : ""}
              </p>
            </div>
          </header>
          <CatalogueClient
            items={catalogue}
            data={itemCardDataFor(data)}
            businessId={data.business.id}
            initialCategory={category}
            recipe={recipe}
            recipeLayout={data.document.sections.find((section) => section.type === definition?.primarySection && sectionBusinessRecipe(section, data.document))?.layout}
            filters={{
              categories: recipe ? [...new Set(catalogue.map((item) => item.category).filter((value): value is string => Boolean(value)))] : data.categories,
              priceBands: (definition?.source === "services" || booking) ? [] : priceBandsFor(catalogue),
              showStockFilter: definition ? definition.source === "products" : !booking,
              searchPlaceholder: data.profile.searchPlaceholder,
              itemNoun: data.profile.itemNoun,
              itemNounPlural: data.profile.itemNounPlural,
            }}
          />
        </div>
      </section>
    </StorefrontShell>
  );
}
