import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { requestCache } from "@/lib/request-cache";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { CheckoutClient } from "@/components/storefront/CheckoutClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

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

// M11 #418: metadata shares the page's single storefront load so the SSR root segment
// completes with the head — the hydration bootstrap scripts are emitted after the content.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  return { title: "Checkout", robots: { index: false, follow: false } };
}

export default async function StorefrontCheckoutPage({ params }: Props) {
  const { slug } = await params;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data) notFound();

  return (
    <StorefrontShell data={data}>
      <section className="eb-section" data-motion-recipe="fade">
        <div className="eb-container">
          <h1 className="eb-h2" style={{ marginBottom: "1.75rem" }}>Checkout</h1>
          <CheckoutClient
            slug={slug}
            businessId={data.business.id}
            businessName={data.business.name}
            deliveryEnabled={data.document.settings.deliveryEnabled !== false}
            pickupEnabled={data.document.settings.pickupEnabled !== false}
            deliveryFeeKES={data.document.settings.deliveryFeeKES || 0}
            deliveryNote={data.document.settings.deliveryNote}
            minOrderKES={data.document.settings.minOrderKES || 0}
            cartNoun={data.profile.cta.cart}
          />
        </div>
      </section>
    </StorefrontShell>
  );
}
