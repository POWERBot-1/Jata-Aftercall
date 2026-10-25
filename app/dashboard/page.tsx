import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getBusinessMetrics, EMPTY_METRICS } from "@/lib/analytics";
import { getBusinessUrl } from "@/lib/url";
import DashboardClient from "@/components/DashboardClient";
import { ensureReferralCode, referralLink } from "@/lib/referral";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Workspace" };
export const dynamic = "force-dynamic";

/**
 * The owner's workspace overview.
 *
 * Every value on this screen is read from the database for the signed-in owner (or every
 * business, for an admin). Nothing is estimated, sampled or invented: the response counts
 * come from `getBusinessMetrics`, the plan from the business's own subscription, and the
 * "next step" from `nextActionFor`. A metric that cannot be read renders as zero with the
 * same explanation the rest of the product uses, never as a made-up figure.
 */
export default async function DashboardPage() {
  const session = await getSession();
  // Only owners and members can see a workspace; an anonymous request goes to sign-in rather
  // than rendering a blank page (the shell performs the same check for every other route).
  if (!session) redirect("/login");

  const businesses = await prisma.business.findMany({
    where: session.role === "ADMIN" ? {} : { ownerId: session.userId },
    include: {
      services: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true, priceLabel: true, priceFrom: true } },
      offer: { select: { title: true, subtitle: true, isActive: true } },
      subscription: { include: { plan: true } },
      // One row only: the most recent payment, for the activity timeline.
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Metrics per business. A failure on one business must not blank the whole dashboard.
  const metricsMap: Record<string, Awaited<ReturnType<typeof getBusinessMetrics>>> = {};
  for (const b of businesses) {
    try {
      metricsMap[b.id] = await getBusinessMetrics(b.id);
    } catch {
      metricsMap[b.id] = { ...EMPTY_METRICS };
    }
  }

  // Interactive Business state per business (§15): is there a website, does it have content,
  // and are there unpublished changes waiting?
  const interactive: Record<string, { hasExperience: boolean; catalogueCount: number; hasUnpublishedChanges: boolean; entitlementStatus: string | null }> = {};
  try {
    const experiences = await prisma.businessExperience.findMany({
      where: { businessId: { in: businesses.map((entry) => entry.id) } },
      select: { businessId: true, draftJson: true, publishedJson: true },
    });
    const [productCounts, serviceCounts, entitlements] = await Promise.all([
      prisma.product.groupBy({ by: ["businessId"], where: { businessId: { in: businesses.map((entry) => entry.id) }, isActive: true }, _count: { _all: true } }),
      prisma.service.groupBy({ by: ["businessId"], where: { businessId: { in: businesses.map((entry) => entry.id) }, isActive: true }, _count: { _all: true } }),
      prisma.interactiveBusinessEntitlement.findMany({ where: { businessId: { in: businesses.map((entry) => entry.id) } }, select: { businessId: true, status: true } }),
    ]);
    const products = new Map<string, number>((productCounts as Array<{ businessId: string; _count: { _all: number } }>).map((row) => [row.businessId, row._count._all]));
    const services = new Map<string, number>((serviceCounts as Array<{ businessId: string; _count: { _all: number } }>).map((row) => [row.businessId, row._count._all]));
    const entitlementRows = new Map<string, string>((entitlements as Array<{ businessId: string; status: string }>).map((row) => [row.businessId, String(row.status)]));
    for (const business of businesses) {
      const experience = experiences.find((entry) => entry.businessId === business.id) || null;
      interactive[business.id] = {
        hasExperience: Boolean(experience),
        catalogueCount: (products.get(business.id) || 0) + (services.get(business.id) || 0),
        hasUnpublishedChanges: Boolean(experience?.draftJson) && experience?.draftJson !== experience?.publishedJson,
        entitlementStatus: entitlementRows.get(business.id) || null,
      };
    }
  } catch {
    // Interactive data is additive: if it cannot be read, the dashboard behaves as before.
  }

  // Stage 2: resolve the owner's own referral link per business. Only eligible (published, not
  // suspended) pages get a code; a failure simply hides the referral card.
  const referralUrls: Record<string, string> = {};
  for (const b of businesses) {
    try {
      if (b.isPublished && b.status !== "SUSPENDED") {
        const code = await ensureReferralCode(b.id);
        if (code) referralUrls[b.id] = referralLink(code);
      }
    } catch {
      // ignore — referral sharing is optional
    }
  }

  return (
    <DashboardClient
      accountEmail={session.email || ""}
      businesses={businesses.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        category: b.category,
        isPublished: b.isPublished,
        status: b.status,
        theme: b.theme,
        phone: b.phone,
        whatsapp: b.whatsapp,
        location: b.location,
        lat: b.lat,
        lng: b.lng,
        description: b.description,
        aftercallMsg: b.aftercallMsg,
        logoUrl: b.logoUrl,
        coverUrl: b.coverUrl,
        createdAt: b.createdAt.toISOString(),
        publicUrl: getBusinessUrl(b.slug),
        referralUrl: referralUrls[b.id] || null,
        subscription: b.subscription
          ? { status: b.subscription.status, expiresAt: b.subscription.expiresAt?.toISOString() || null, planName: b.subscription.plan.name }
          : null,
        lastPayment: b.payments[0] ? { status: b.payments[0].status, createdAt: b.payments[0].createdAt.toISOString() } : null,
        services: b.services.map((service) => ({ id: service.id, title: service.title, priceLabel: service.priceLabel, priceFrom: service.priceFrom })),
        servicesCount: b.services.length,
        offer: b.offer ? { title: b.offer.title, subtitle: b.offer.subtitle, isActive: b.offer.isActive } : null,
        hasOffer: !!b.offer,
        hasExperience: interactive[b.id]?.hasExperience ?? false,
        catalogueCount: interactive[b.id]?.catalogueCount ?? 0,
        hasUnpublishedChanges: interactive[b.id]?.hasUnpublishedChanges ?? false,
        entitlementStatus: interactive[b.id]?.entitlementStatus ?? null,
      }))}
      metricsMap={metricsMap}
    />
  );
}
