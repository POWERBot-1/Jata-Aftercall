import { notFound } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getBusinessUrl } from "@/lib/url";
import { resolveTheme } from "@/lib/themes";
import BusinessPage from "@/components/BusinessPage";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

async function getBusiness(slug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: { services: { orderBy: { sortOrder: "asc" } }, offer: true, subscription: true },
  });
  return business;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const business = await getBusiness(params.slug);
  if (!business) return { title: "Page not found" };
  const title = `${business.name} | ${business.location || business.category}`;
  const description = business.description || `${business.name} — ${business.category} in ${business.location || "Kenya"}. WhatsApp, call, directions, services & offers.`;
  const url = getBusinessUrl(business.slug);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: "website",
      siteName: "JATA AFTERCALL",
    },
    alternates: { canonical: url },
  };
}

export default async function PublicBusinessPage({ params }: Props) {
  const business = await getBusiness(params.slug);
  if (!business) notFound();

  // Enforce published + subscription check (§40 configurable behavior)
  // If expired/suspended, still show but with banner unless isPublished false
  if (!business.isPublished) {
    // Allow owner to preview unpublished via ?preview=... (not gating here), but for public: 404
    // Check if subscription is suspended — show degraded view
    if (business.status === "SUSPENDED") {
      // Show suspended banner but keep SEO title
    } else {
      notFound();
    }
  }

  // Graceful expiry check — lazy evaluation (§40)
  let showExpiredBanner = false;
  if (business.subscription) {
    const now = new Date();
    if (business.subscription.expiresAt && now > business.subscription.expiresAt) {
      showExpiredBanner = true;
    }
  }

  const theme = resolveTheme(business.theme);

  return (
    <>
      {showExpiredBanner && (
        <div className="bg-amber-100 py-2 text-center text-xs font-semibold text-amber-900">This page&apos;s subscription has expired — contact the owner to renew.</div>
      )}
      <BusinessPage
        business={{
          id: business.id,
          slug: business.slug,
          name: business.name,
          category: business.category,
          phone: business.phone,
          whatsapp: business.whatsapp,
          location: business.location,
          description: business.description,
          theme: business.theme,
          aftercallMsg: business.aftercallMsg,
          openingHours: business.openingHours,
          socialLinks: business.socialLinks,
        }}
        services={business.services}
        offer={business.offer}
        theme={theme}
      />
    </>
  );
}
