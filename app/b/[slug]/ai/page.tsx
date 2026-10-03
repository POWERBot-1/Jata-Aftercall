import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { DEFAULT_SUGGESTED_ACTIONS } from "@/lib/ai-front-desk";
import { generateAILinkQRCodeSvg, getShareableAILink } from "@/lib/qr";
import AIFrontDeskCustomerClient from "@/components/AIFrontDeskCustomerClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await prisma.business
    .findUnique({
      where: { slug },
      select: { name: true, category: true, description: true },
    })
    .catch(() => null);

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

  const business = await prisma.business
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
    .catch(() => null);

  if (!business) {
    notFound();
  }

  const isPreviewRequested = sp?.preview === "true" || sp?.preview === "1";
  if (isPreviewRequested) {
    const user = await getCurrentUser().catch(() => null);
    if (!user) {
      redirect(`/login?callbackUrl=/b/${business.slug}/ai?preview=true`);
    }
    const allowed = await canAccessBusiness(user.id, business.id, user.role);
    if (!allowed) {
      notFound();
    }
  } else if (!business.isPublished) {
    notFound();
  } else {
    // A live AI Front Desk is the KES 499 / 30-day package: an unpublished/unpaid business
    // never gets a customer-facing AI, even though the wider business page may be published
    // under a different package (§2, §3, §49). The check is server-side and fails closed.
    const entitlement = await getAIPackageStatus(business.id).catch(() => null);
    if (!entitlement || entitlement.entitled !== true) {
      notFound();
    }
  }

  const brain = await getBusinessBrain(business.id);
  const share = getShareableAILink(business.slug);
  const qrSvg = generateAILinkQRCodeSvg(share.url, 180);
  const greeting =
    brain.extendedConfig.greetingMessage ||
    `Welcome to ${business.name}! Ask me about our products, prices, delivery fees, opening hours, or place an order directly.`;

  return (
    <AIFrontDeskCustomerClient
      business={business}
      products={brain.products.filter((p) => p.isActive !== false)}
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
      pauseAllOrdering={brain.extendedConfig.pauseAllOrdering}
      qrSvg={qrSvg}
      shareUrl={share.url}
      previewMode={isPreviewRequested}
    />
  );
}
