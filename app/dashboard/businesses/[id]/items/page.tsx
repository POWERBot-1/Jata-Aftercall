import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/db";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { ItemsEditor } from "@/components/dashboard/ItemsEditor";

export const metadata: Metadata = { title: "Catalogue" };
export const dynamic = "force-dynamic";

export default async function ItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);

  // Tenant-scoped read: the ownership check in loadWorkspace has already run (§37).
  const [products, services] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: id },
      include: { variants: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.service.findMany({ where: { businessId: id }, orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }], take: 200 }),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">{workspace.profile.catalogueLabel}</h1>
        <p className="text-sm text-zinc-600">
          The form adapts to {workspace.profile.label.toLowerCase()}: only the fields that matter for your trade.
        </p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <ItemsEditor
        businessId={id}
        categoryKey={workspace.document.categoryKey}
        itemNoun={workspace.profile.itemNoun}
        itemNounPlural={workspace.profile.itemNounPlural}
        productFields={workspace.profile.productFields}
        serviceFields={workspace.profile.serviceFields}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description ?? null,
          category: product.category ?? null,
          basePriceKES: product.basePriceKES ?? null,
          salePriceKES: product.salePriceKES ?? null,
          imageUrl: product.imageUrl ?? null,
          images: product.images ?? null,
          brand: product.brand ?? null,
          portionSize: product.portionSize ?? null,
          ingredients: product.ingredients ?? null,
          prepMinutes: product.prepMinutes ?? null,
          tags: product.tags ?? null,
          addOns: product.addOns ?? null,
          variantOptions: product.variantOptions ?? null,
          stockStatus: String(product.stockStatus),
          isFeatured: product.isFeatured,
          isActive: product.isActive,
          sortOrder: product.sortOrder,
          variants: product.variants.map((variant) => ({ id: variant.id, label: variant.label, priceKES: variant.priceKES ?? null })),
        }))}
        services={services.map((service) => ({
          id: service.id,
          title: service.title,
          description: service.description ?? null,
          category: service.category ?? null,
          staffName: service.staffName ?? null,
          priceLabel: service.priceLabel ?? null,
          priceFrom: service.priceFrom ?? null,
          priceToKES: service.priceToKES ?? null,
          depositKES: service.depositKES ?? null,
          durationMinutes: service.durationMinutes ?? null,
          imageUrl: service.imageUrl ?? null,
          pricingType: String(service.pricingType),
          isFeatured: service.isFeatured,
          isActive: service.isActive,
          sortOrder: service.sortOrder,
        }))}
      />
    </div>
  );
}
