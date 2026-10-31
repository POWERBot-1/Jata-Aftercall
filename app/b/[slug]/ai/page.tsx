import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { getAIFrontDeskPublication } from "@/lib/ai-publication";
import { DEFAULT_SUGGESTED_ACTIONS } from "@/lib/ai-front-desk";
import { generateAILinkQRCodeSvg, getShareableAILink } from "@/lib/qr";
import AIFrontDeskCustomerClient from "@/components/AIFrontDeskCustomerClient";
import { publicProductPrice } from "@/lib/ai-public-products";
import { loadStorefront } from "@/lib/experience/storefront";
import { isRenderPreference } from "@/lib/experience/renderMode";
import { requestCache } from "@/lib/request-cache";

export const dynamic = "force-dynamic";

// M11 #418: one per-request business load shared by `generateMetadata` and the body
// (see lib/request-cache.ts).
const getAIBusiness = requestCache(async (slug: string) =>
  prisma.business
    .findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        description: true,
        location: true,
        phone: true,
        whatsapp: true,
        openingHours: true,
        isPublished: true,
      },
    })
    .catch(() => null),
);

// M11 #418: the full per-request chain (business → preview access / entitlement → brain)
// shared by generateMetadata and the body, so no body-only await lags the SSR root segment
// behind the head (see lib/request-cache.ts). Access policy stays in the body as
// redirect()/notFound(); the loader only reports flags.
const loadAIPageData = requestCache(async (slug: string, isPreviewRequested: boolean) => {
  const business = await getAIBusiness(slug);
  if (!business) return { business: null, user: null, allowed: false, entitled: false, publication: null, brain: null, blocked: "missing" as const };
  if (isPreviewRequested) {
    const user = await getCurrentUser().catch(() => null);
    if (!user) return { business, user: null, allowed: false, entitled: false, publication: null, brain: null, blocked: "login" as const };
    const allowed = await canAccessBusiness(user.id, business.id, user.role);
    if (!allowed) return { business, user, allowed: false, entitled: false, publication: null, brain: null, blocked: "forbidden" as const };
    // The owner's private preview is reachable without a subscription (setup policy), but it is
    // labelled PREVIEW and never LIVE, because nothing has been published or paid for yet.
    const publication = await getAIFrontDeskPublication(business.id, { preview: true }).catch(() => null);
    const [brain, storefront] = await Promise.all([getBusinessBrain(business.id), loadStorefront(slug, { allowDraft: true, preferDraft: true }).catch(() => null)]);
    return { business, user, allowed: true, entitled: false, publication, brain, storefront, blocked: null };
  }
  // The single source of truth: published + activated + server-verified entitlement. A LIVE desk
  // is the only thing a customer may reach, so DRAFT/PREVIEW/PAUSED/MAINTENANCE/SUSPENDED all
  // resolve to notFound() here — exactly like an unpublished page.
  const publication = await getAIFrontDeskPublication(business.id).catch(() => null);
  if (!publication || publication.publiclyOperational !== true) {
    return { business, user: null, allowed: false, entitled: false, publication, brain: null, blocked: "forbidden" as const };
  }
  const [brain, storefront] = await Promise.all([getBusinessBrain(business.id), loadStorefront(slug).catch(() => null)]);
  return { business, user: null, allowed: true, entitled: true, publication, brain, storefront, blocked: null };
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ preview?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const isPreviewRequested = sp?.preview === "true" || sp?.preview === "1";
  // M11 #418: shares the body's full data chain via the request cache.
  const data = await loadAIPageData(slug, isPreviewRequested);
  const business = data.business;

  if (!business) {
    return { title: "AI Business Front Desk — Not Found | JATA" };
  }

  return {
    title: `${business.name} — AI Front Desk | JATA Aftercall`,
    description: `Ask ${business.name} about products, prices, stock, delivery, bookings, and orders.`,
  };
}

export default async function PublicAIFrontDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const isPreviewRequested = sp?.preview === "true" || sp?.preview === "1";

  // M11 #418: one shared per-request load (also awaited by generateMetadata).
  const data = await loadAIPageData(slug, isPreviewRequested);
  const business = data.business;
  if (!business) {
    notFound();
  }
  if (data.blocked === "login") {
    redirect(`/login?callbackUrl=/b/${business.slug}/ai?preview=true`);
  }
  if (data.blocked === "forbidden") {
    // A live AI Front Desk is the KES 499 / 30-day package: an unpublished/unpaid business
    // never gets a customer-facing AI, even though the wider business page may be published
    // under a different package (§2, §3, §49). The check is server-side and fails closed.
    notFound();
  }
  const brain = data.brain!;
  // Missing/unreadable configuration fails closed to static without changing access or content.
  const storefront = "storefront" in data ? data.storefront : null;
  const preference = !storefront ? "lite" : isRenderPreference(storefront.document.renderPreference) ? storefront.document.renderPreference : "auto";
  const publicationState = data.publication?.state ?? (isPreviewRequested ? "PREVIEW" : "DRAFT");
  const share = getShareableAILink(business.slug);
  const qrSvg = generateAILinkQRCodeSvg(share.url, 180);
  const greeting =
    brain.extendedConfig.greetingMessage ||
    `Welcome to ${business.name}! Ask me about our products, prices, delivery fees, opening hours, or place an order directly.`;

  return (
    <AIFrontDeskCustomerClient
      motionPreference={preference}
      motionEnabled={Boolean(storefront && storefront.theme.treatment.motion !== "none")}
      business={business}
      products={brain.products
        .filter((p) => p.isActive !== false)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          stockStatus: p.stockStatus,
          preOrderAllowed: p.preOrderAllowed,
          // Expose only the effective price now and the original while a sale is active; never expose window metadata.
          ...publicProductPrice(p),
        }))}
      services={brain.services.filter((s) => s.isActive !== false)}
      deliveryZones={brain.delivery.zones}
      greetingMessage={greeting}
      suggestedActions={[...DEFAULT_SUGGESTED_ACTIONS]}
      operationalStatus={
        brain.extendedConfig.operationalStatus === "PAUSED" ||
        brain.extendedConfig.operationalStatus === "MAINTENANCE"
          ? brain.extendedConfig.operationalStatus
          : "LIVE"
      }
      publicationState={publicationState}
      pauseAllOrdering={brain.extendedConfig.pauseAllOrdering}
      qrSvg={qrSvg}
      shareUrl={share.url}
      previewMode={isPreviewRequested}
    />
  );
}
