import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import AIDashboardClient from "@/components/AIDashboardClient";
import AIFrontDeskWorkspace from "@/components/ai/AIFrontDeskWorkspace";
import AIHandoffAutomationPause from "@/components/ai/AIHandoffAutomationPause";
import { WorkspaceHero } from "@/components/workspace/WorkspaceUI";
import { WORKSPACE_HERO_PHOTO } from "@/lib/workspaceImagery";
import { getExtendedAIConfig } from "@/lib/ai-config";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { getAIPackageStatus, AI_FRONT_DESK_PLAN_KEY } from "@/lib/ai-entitlement";
import { isFrontDeskTierKey } from "@/lib/frontDeskTiers";
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

  const selectBusiness = {
    id: true, name: true, slug: true, category: true, description: true,
    location: true, phone: true, whatsapp: true, openingHours: true,
  };
  const candidateBusiness = await (sp?.businessId
    ? prisma.business.findUnique({ where: { id: sp.businessId }, select: selectBusiness })
    : prisma.business.findFirst({ where: { ownerId: user.id }, select: selectBusiness })
  ).catch(() => null);
  const business = candidateBusiness && await canAccessBusiness(user.id, candidateBusiness.id, user.role)
    ? candidateBusiness
    : null;

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

  const [aiConfig, brain, entitlement, readiness, publication] = await Promise.all([
    prisma.aIConfiguration.findUnique({ where: { businessId } }).catch(() => null),
    getBusinessBrain(businessId).catch(() => null),
    getAIPackageStatus(businessId).catch(() => null),
    evaluateAIReadiness(businessId).catch(() => null),
    getAIFrontDeskPublication(businessId).catch(() => null),
  ]);
  // Price card shows the tier the business actually holds (any of the four Front Desk tiers),
  // falling back to the Starter row when no tier is active yet — never a browser-supplied price.
  const heldTierKey =
    entitlement?.packageKey && isFrontDeskTierKey(entitlement.packageKey)
      ? entitlement.packageKey
      : AI_FRONT_DESK_PLAN_KEY;
  const plan = await prisma.planConfig
    .findUnique({ where: { key: heldTierKey } })
    .catch(() => null);

  const extended = brain?.extendedConfig ?? (await getExtendedAIConfig(businessId, aiConfig));
  const hours = formatOpeningHours(business.openingHours);
  const handoffTasks = await prisma.erpTask.findMany({
    where: { businessId, sourceType: "AI_FRONT_DESK_HANDOFF" },
    select: { id: true, title: true, status: true, priority: true, dueAt: true },
    orderBy: { createdAt: "desc" }, take: 20,
  }).catch(() => []);

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

      <section className="ws-card" aria-labelledby="ai-handoff-tasks">
        <div className="ws-card-header">
          <div>
            <p className="ws-kicker">Internal work queue</p>
            <h2 id="ai-handoff-tasks">Human follow-up tasks</h2>
            <p>Created only when the AI Front Desk explicitly requests human intervention. Creating a task does not send a customer message.</p>
          </div>
          <Link className="ws-btn-outline" href={`/dashboard/erp/${encodeURIComponent(businessId)}/tasks`}>Manage tasks</Link>
        </div>
        {handoffTasks.length ? (
          <ul>{handoffTasks.map((task) => (
            <li key={task.id}><strong>{task.title}</strong> — {task.status}, {task.priority}{task.dueAt ? `, due ${new Date(task.dueAt).toLocaleDateString()}` : ", no due date"}</li>
          ))}</ul>
        ) : <p>No AI Front Desk handoff tasks yet.</p>}
        <AIHandoffAutomationPause businessId={businessId} enabled={aiConfig?.followupEventsEnabled === true} />
      </section>

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
