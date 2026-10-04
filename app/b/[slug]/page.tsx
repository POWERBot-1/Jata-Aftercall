import { notFound } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveTheme } from "@/lib/themes";
import BusinessPage from "@/components/BusinessPage";
import { publicPageDecision, type PublicBusinessAccess, type PublicViewer } from "@/lib/publication";
import { ensureReferralCode, referralPath } from "@/lib/referral";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { loadStorefront } from "@/lib/experience/storefront";
import { seoMetadataFor } from "@/lib/experience/structuredData";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ preview?: string }> };

async function getBusiness(slug: string) {
  return prisma.business.findUnique({
    where: { slug },
    include: {
      services: { orderBy: { sortOrder: "asc" } },
      offer: true,
      subscription: true,
      members: { select: { userId: true, role: true } },
    },
  });
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

function canPreviewDraft(business: NonNullable<Awaited<ReturnType<typeof getBusiness>>>, viewer: PublicViewer): boolean {
  if (!viewer) return false;
  if (viewer.role === "ADMIN") return true;
  if (viewer.userId === business.ownerId) return true;
  return (business.members || []).some((member) => member.userId === viewer.userId);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusiness(slug);
  if (!business) return { title: "Page not found", robots: { index: false, follow: false } };
  const viewer = await viewerFromSession();
  const decision = publicPageDecision({ business: accessOf(business), viewer });
  if (decision === "missing" || decision === "not_found") {
    return { title: "Page not found", robots: { index: false, follow: false } };
  }

  // Interactive Business websites own their metadata (§33).
  const experience = await loadStorefront(slug, { allowDraft: canPreviewDraft(business, viewer) });
  if (experience) {
    return seoMetadataFor({ business, document: experience.document, isPreview: experience.isPreview }) as Metadata;
  }

  const title = `${business.name} | ${business.location || business.category}`;
  const description =
    business.description ||
    `${business.name} — ${business.category} in ${business.location || "Kenya"}. WhatsApp, call, directions, services & offers.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/b/${business.slug}`,
      type: "website",
      siteName: "JATA AFTERCALL",
      images: [{ url: "/og.jpg", width: 1200, height: 630, alt: `${business.name} — JATA AFTERCALL` }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.jpg"] },
    alternates: { canonical: `/b/${business.slug}` },
    robots: decision === "preview" ? { index: false, follow: false } : undefined,
  };
}

export default async function PublicBusinessPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const business = await getBusiness(slug);
  const viewer = await viewerFromSession();
  const decision = publicPageDecision({ business: business ? accessOf(business) : null, viewer });
  if (!business || decision === "missing" || decision === "not_found") notFound();

  // ── Interactive Business: category-aware experience (§4, §39) ──
  // The existing /b/<slug> route is preserved; a business with a published experience is
  // rendered by the experience engine, everyone else keeps the classic AFTERCALL page.
  const draftAllowed = canPreviewDraft(business, viewer);
  // Owners (and only owners) can ask to see their unpublished draft next to the live site.
  const previewParam = (await searchParams)?.preview;
  const preferDraft = draftAllowed && previewParam === "draft";
  let experience = null;
  try {
    experience = await loadStorefront(slug, { allowDraft: draftAllowed, preferDraft });
  } catch {
    experience = null;
  }

  if (experience) {
    return (
      <ExperienceSite
        data={experience}
        previewNotice={
          experience.isPreview
            ? "Draft preview — only you can see these unpublished changes."
            : decision === "preview"
              ? "Draft preview. Only you can see this unpublished page."
              : null
        }
      />
    );
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

  // Stage 2: the referral CTA is shown to public visitors of an eligible (published, not
  // suspended) page. The code is minted lazily on first eligible use.
  let referralHref: string | null = null;
  if (decision === "public") {
    const code = await ensureReferralCode(business.id);
    if (code) referralHref = referralPath(code);
  }

  // The "Ask AI Front Desk" entry is offered only when the paid AI package is live for this
  // business — the AI page itself answers 404 otherwise. Same server-side check, fails closed.
  let aiFrontDeskLive = false;
  if (decision === "public") {
    try {
      aiFrontDeskLive = (await getAIPackageStatus(business.id)).entitled === true;
    } catch {
      aiFrontDeskLive = false;
    }
  }

  return (
    <>
      {decision === "preview" && (
        <div className="bg-zinc-900 py-2 text-center text-xs font-semibold text-white">Draft preview. Only you can see this unpublished page.</div>
      )}
      {showExpiredBanner && business.isPublished && (
        <div className="bg-amber-100 py-2 text-center text-xs font-semibold text-amber-900">
          This page&apos;s subscription has expired — contact the owner to renew.
        </div>
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
        referralHref={referralHref}
        aiFrontDeskLive={aiFrontDeskLive}
      />
    </>
  );
}
