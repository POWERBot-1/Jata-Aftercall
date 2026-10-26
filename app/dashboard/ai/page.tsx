import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import AIDashboardClient from "@/components/AIDashboardClient";
import AIFrontDeskWorkspace from "@/components/ai/AIFrontDeskWorkspace";
import { WorkspaceHero } from "@/components/workspace/WorkspaceUI";
import { WORKSPACE_HERO_PHOTO } from "@/lib/workspaceImagery";
import { getExtendedAIConfig } from "@/lib/ai-config";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { getAIPackageStatus, AI_FRONT_DESK_PLAN_KEY } from "@/lib/ai-entitlement";
import { evaluateAIReadiness } from "@/lib/ai-readiness";
import { getAIFrontDeskPublication } from "@/lib/ai-publication";
import { formatOpeningHours } from "@/lib/openingHours";
import { Bot, ExternalLink, Settings2 } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Front Desk — JATA Aftercall",
  description:
    "Set up, preview and publish the AI Front Desk for your business, and see whether it is live, paused or waiting for a verified subscription.",
};

/**
 * The AI Front Desk screen.
 *
 * Two parts, one page: the guided setup journey (welcome → business information → answers →
 * private preview → publish) and, below it, the operations console that owns conversations,
 * orders, leads and knowledge review. Data loading is server-side and tenant-scoped, and every
 * status shown comes from `lib/ai-publication.ts` — derived from persisted publication state plus
 * a server-verified subscription — so a LIVE badge can never be caused by a frontend flag.
 */
export default async function AIDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ businessId?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    redirect("/login?callbackUrl=/dashboard/ai");
  }

  const business = await prisma.business
    .findFirst({
      where: sp?.businessId
        ? { id: sp.businessId, ...(user.role === "ADMIN" ? {} : { ownerId: user.id }) }
        : { ownerId: user.id },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        location: true,
        phone: true,
        whatsapp: true,
        openingHours: true,
      },
    })
    .catch(() => null);

  const businessId = business?.id || "";
  const businessSlug = business?.slug || "my-business";

  if (!businessId) {
    return (
      <div className="ws-stack">
        <WorkspaceHero
          compact
          kicker="AI Front Desk"
          title={
            <>
              One business first, then the <em>front desk</em>.
            </>
          }
          subtitle="The front desk answers from your business information, so it needs a business to work from. Create your business page, then come back."
          photo={WORKSPACE_HERO_PHOTO}
          actions={
            <Link href="/onboarding" className="ws-btn-amber">
              <Bot size={16} aria-hidden="true" /> Create your business
            </Link>
          }
        />
      </div>
    );
  }

  const [aiConfig, brain, entitlement, readiness, publication, plan] = await Promise.all([
    prisma.aIConfiguration.findUnique({ where: { businessId } }).catch(() => null),
    getBusinessBrain(businessId).catch(() => null),
    getAIPackageStatus(businessId).catch(() => null),
    evaluateAIReadiness(businessId).catch(() => null),
    getAIFrontDeskPublication(businessId).catch(() => null),
    prisma.planConfig.findUnique({ where: { key: AI_FRONT_DESK_PLAN_KEY } }).catch(() => null),
  ]);

  const extended = brain?.extendedConfig ?? (await getExtendedAIConfig(businessId, aiConfig));
  const hours = formatOpeningHours(business.openingHours);

  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="AI Front Desk"
        title={
          <>
            Answers your customers can <em>trust</em>.
          </>
        }
        subtitle="Your front desk answers from your own services, prices, offer and opening hours — and shows you the questions it could not answer, so you can fix the page instead of guessing."
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <Link href="#welcome" className="ws-btn-amber">
              <Settings2 size={16} aria-hidden="true" /> Set up AI Front Desk
            </Link>
            {publication?.publiclyOperational ? (
              <Link
                href={`/b/${businessSlug}/ai`}
                className="ws-btn-outline"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} aria-hidden="true" /> Open customer view
              </Link>
            ) : (
              <Link
                href={`/b/${businessSlug}/ai?preview=true`}
                className="ws-btn-outline"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} aria-hidden="true" /> Open private preview
              </Link>
            )}
            <Link href="/dashboard" className="ws-btn-quiet">
              <Bot size={16} aria-hidden="true" /> Back to overview
            </Link>
          </>
        }
        meta={`${business.name} · /b/${businessSlug}/ai · answers are grounded in your business data, never invented`}
      />

      <AIFrontDeskWorkspace
        businessId={businessId}
        businessSlug={businessSlug}
        initialProfile={{
          name: business.name || "",
          category: business.category || "",
          description: business.description || "",
          location: business.location || "",
          phone: business.phone || "",
          whatsapp: business.whatsapp || "",
          openingHours:
            hours
              .map((row) => (row.label ? `${row.label} ${row.value}` : row.value))
              .filter(Boolean)
              .join(" · ") || "",
        }}
        initialResponses={{
          greetingMessage: extended.greetingMessage || "",
          fallbackMessage: extended.fallbackMessage || "",
          toneOfVoice: extended.toneOfVoice || "Friendly",
          languageBehavior: extended.languageBehavior || "English + Swahili",
          orderingAllowed: extended.orderingAllowed !== false,
          bookingsAllowed: extended.bookingsAllowed !== false,
          preordersAllowed: extended.preordersAllowed === true,
          escalationRules: extended.escalationRules || "",
          afterHoursMessage: extended.afterHoursMessage || "",
        }}
        initialCatalogue={{
          products: (brain?.products || []).slice(0, 30).map((product) => ({
            id: product.id,
            name: product.name,
            priceKES: typeof (product as { basePriceKES?: number }).basePriceKES === "number"
              ? (product as { basePriceKES?: number }).basePriceKES
              : null,
            stockStatus: product.stockStatus,
          })),
          services: (brain?.services || []).slice(0, 30).map((service) => ({
            id: service.id,
            title: service.title,
            priceFrom: service.priceFrom,
          })),
          zones: (brain?.delivery?.zones || []).map((zone) => ({ name: zone.name, feeKES: zone.feeKES })),
          faqCount: brain?.faqs?.length || 0,
        }}
        initialPublication={
          publication ?? {
            state: "DRAFT",
            publiclyOperational: false,
            isPublished: false,
            operationalStatus: "DRAFT",
            entitled: false,
            entitlementStatus: entitlement?.status || "NONE",
            reason: "Draft — publish after an active AI Business Front Desk subscription is confirmed.",
          }
        }
        initialEntitlement={{
          status: entitlement?.status || "NONE",
          entitled: entitlement?.entitled === true,
          // Carried through so the first paint already knows whether the billing records were
          // readable, instead of showing "not active" for an unverifiable subscription.
          verification: entitlement?.verification,
          reason: entitlement?.reason || "Choose the AI Business Front Desk plan to go live.",
          priceKES: entitlement?.priceKES,
          currency: entitlement?.currency || "KES",
          billingCycleDays: entitlement?.billingCycleDays,
          expiresAt: entitlement?.expiresAt ? new Date(entitlement.expiresAt).toISOString() : null,
          graceUntil: entitlement?.graceUntil ? new Date(entitlement.graceUntil).toISOString() : null,
        }}
        initialReadiness={{
          ready: readiness?.ready === true,
          canPublish: readiness?.canPublish === true,
          missingItems: readiness?.missingItems || [],
          checks: (readiness?.checks || []).map((check) => ({
            id: check.id,
            label: check.label,
            passed: check.passed,
            detail: check.detail,
          })),
        }}
        plan={
          plan
            ? { name: plan.name, priceKES: plan.priceKES, durationDays: plan.durationDays }
            : null
        }
      />

      <AIDashboardClient
        businessId={businessId}
        businessName={business.name || "Your Business"}
        businessSlug={businessSlug}
        userEmail={user.email}
        isAdmin={user.role === "ADMIN"}
        initialPublication={publication}
      />
    </div>
  );
}
