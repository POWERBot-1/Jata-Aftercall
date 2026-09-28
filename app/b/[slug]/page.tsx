import { notFound } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getBusinessUrl } from "@/lib/url";
import { resolveTheme } from "@/lib/themes";
import BusinessPage from "@/components/BusinessPage";
import { getSession } from "@/lib/auth";
import { publicPageDecision, type PublicBusinessAccess, type PublicViewer } from "@/lib/publication";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function getBusiness(slug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      services: { orderBy: { sortOrder: "asc" } },
      offer: true,
      subscription: true,
      members: { select: { userId: true, role: true } },
    },
  });
  return business;
}

function accessOf(business: NonNullable<Awaited<ReturnType<typeof getBusiness>>>): PublicBusinessAccess {
  return {
    isPublished: business.isPublished,
    ownerId: business.ownerId,
    ownerMemberIds: business.members.filter((member) => member.role === "OWNER").map((member) => member.userId),
  };
}

async function viewerFromSession(): Promise<PublicViewer> {
  const session = await getSession();
  if (!session) return null;
  return { userId: session.userId, role: session.role };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusiness(slug);
  if (!business) return { title: "Page not found", robots: { index: false, follow: false } };
  const decision = publicPageDecision({ business: accessOf(business), viewer: await viewerFromSession() });
  if (decision === "missing" || decision === "not_found") {
    return { title: "Page not found", robots: { index: false, follow: false } };
  }
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
    robots: decision === "preview" ? { index: false, follow: false } : undefined,
  };
}

export default async function PublicBusinessPage({ params }: Props) {
  const { slug } = await params;
  const business = await getBusiness(slug);
  const decision = publicPageDecision({
    business: business ? accessOf(business) : null,
    viewer: await viewerFromSession(),
  });
  if (!business || decision === "missing" || decision === "not_found") notFound();

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
      {decision === "preview" && (
        <div className="bg-zinc-900 py-2 text-center text-xs font-semibold text-white">Draft preview. Only you can see this unpublished page.</div>
      )}
      {showExpiredBanner && business.isPublished && (
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
          lat: business.lat,
          lng: business.lng,
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
