import type { Metadata } from "next";
import prisma from "@/lib/db";
import { loadPublicCatalogue, StorefrontError } from "@/lib/erp/storefront";
import { StoreCart } from "@/components/erp/StoreCart";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const catalogue = await loadPublicCatalogue(prisma, slug);
    return {
      title: `${catalogue.businessName} — order online`,
      description: catalogue.settings.about || `Order from ${catalogue.businessName}. Pay on collection or delivery.`,
      robots: { index: true, follow: true },
    };
  } catch {
    return { title: "Shop", robots: { index: false, follow: false } };
  }
}

/**
 * The public shop.
 *
 * It renders from the same catalogue the POS uses, with prices computed by the same sale-window
 * rules. If the shop is closed, a customer sees a closed state and no fake "add to cart" buttons.
 */
type Catalogue = Awaited<ReturnType<typeof loadPublicCatalogue>>;

export default async function StorePage({ params }: Props) {
  const { slug } = await params;
  // Fetch first, render second: a render-time throw cannot be caught by this try/catch, so the
  // JSX must not live inside it (react-hooks/error-boundaries).
  let catalogue: Catalogue | null = null;
  let closedMessage = "This shop is not available right now.";
  try {
    catalogue = await loadPublicCatalogue(prisma, slug);
  } catch (error) {
    closedMessage = error instanceof StorefrontError ? error.message : closedMessage;
  }

  if (!catalogue) {
    return (
      <div className="erp">
        <main className="erp-content" style={{ maxWidth: 560, paddingTop: 48 }}>
          <section className="erp-card">
            <span className="erp-badge" data-tone="warn">Shop closed</span>
            <h1 style={{ fontSize: "1.4rem", margin: "10px 0 6px" }}>{closedMessage}</h1>
            <p className="erp-muted erp-small">
              The business has not opened this ordering page, or it has paused orders. Nothing was charged and no order was created.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="erp">
      <main className="erp-content" style={{ maxWidth: 1060, paddingTop: 20 }}>
        <StoreCart
          slug={slug}
          businessName={catalogue.businessName}
          location={catalogue.location}
          products={catalogue.products}
          categories={catalogue.categories}
          settings={{
            allowDelivery: catalogue.settings.allowDelivery,
            allowPickup: catalogue.settings.allowPickup,
            deliveryFeeCents: catalogue.settings.deliveryFeeCents,
            minimumOrderCents: catalogue.settings.minimumOrderCents,
            deliveryAreas: catalogue.settings.deliveryAreas,
            headline: catalogue.settings.headline,
            about: catalogue.settings.about,
          }}
          acceptance={catalogue.acceptance}
        />
        <p className="erp-footer">Prices and availability come from {catalogue.businessName}. Pay the shop directly — this page takes no payment.</p>
      </main>
    </div>
  );
}
