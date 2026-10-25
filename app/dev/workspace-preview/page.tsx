import DashboardClient from "@/components/DashboardClient";
import DashboardNav from "@/components/DashboardNav";
import { BrandMark } from "@/components/ui/BrandMark";
import { WorkspaceDoor } from "@/components/workspace/WorkspaceDoor";
import { PlanCard } from "@/components/workspace/PlanCard";
import { WorkspaceHero, WorkspacePanel } from "@/components/workspace/WorkspaceUI";
import { PLAN_BADGES, PLAN_INCLUDES } from "@/lib/landing";
import { WORKSPACE_HERO_PHOTO, categoryLabel, photoForCategory } from "@/lib/workspaceImagery";
import { StatusPill } from "@/components/ui/StatusPill";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { notFound } from "next/navigation";
import type { Metadata } from "next";

/**
 * Developer preview of the workspace design system.
 *
 * Development only (`notFound()` in a production build, no environment flag can switch it on).
 * It exists so the workspace can be reviewed at phone and desktop widths — by a person or by a
 * screenshot script — in an environment where signing in against a real database is not
 * possible. It renders the *real* components (`DashboardClient`, `PlanCard`, `WorkspaceDoor`,
 * `WorkspaceHero`, the chrome) with obvious synthetic fixtures, so it can never be mistaken for
 * a customer's dashboard: every block below is labelled, and the numbers are fixtures, not
 * performance claims.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workspace design preview (development only)",
  robots: { index: false, follow: false },
};

const businesses = [
  {
    id: "biz-1",
    slug: "marys-beauty-studio",
    name: "Mary's Beauty Studio",
    category: "Beauty & Salon",
    isPublished: true,
    status: "ACTIVE",
    theme: "clean",
    phone: "+254712345678",
    whatsapp: "+254712345678",
    location: "Kitengela, Kajiado",
    lat: -1.5,
    lng: 36.9,
    description: "Braids, nails and bridal makeup.",
    aftercallMsg: "Thanks for contacting us!",
    logoUrl: null,
    coverUrl: "/landing/marys-beauty-studio.jpg",
    createdAt: "2026-03-04T08:00:00.000Z",
    publicUrl: "https://jata-aftercall.vercel.app/b/marys-beauty-studio",
    referralUrl: "https://jata-aftercall.vercel.app/register?ref=abc123",
    subscription: { status: "ACTIVE", expiresAt: "2026-12-24T00:00:00.000Z", planName: "Monthly" },
    lastPayment: { status: "PAID", createdAt: "2026-10-24T09:12:00.000Z" },
    services: [
      { id: "s1", title: "Knotless braids", priceLabel: "From KES 1,500", priceFrom: 1500 },
      { id: "s2", title: "Gel nails", priceLabel: "From KES 800", priceFrom: 800 },
      { id: "s3", title: "Bridal makeup", priceLabel: "From KES 2,500", priceFrom: 2500 },
    ],
    servicesCount: 3,
    offer: { title: "Weekday braiding offer", subtitle: "Book Monday–Wednesday", isActive: true },
    hasOffer: true,
    hasExperience: true,
    catalogueCount: 6,
    hasUnpublishedChanges: true,
    entitlementStatus: "ACTIVE",
  },
  {
    id: "biz-2",
    slug: "nyumbani-kitchen",
    name: "Nyumbani Kitchen",
    category: "Restaurant",
    isPublished: false,
    status: "PENDING",
    theme: "warm",
    phone: "+254733111222",
    whatsapp: null,
    location: "",
    lat: null,
    lng: null,
    description: null,
    aftercallMsg: null,
    logoUrl: null,
    coverUrl: null,
    createdAt: "2026-10-20T08:00:00.000Z",
    publicUrl: "https://jata-aftercall.vercel.app/b/nyumbani-kitchen",
    referralUrl: null,
    subscription: null,
    lastPayment: null,
    services: [],
    servicesCount: 0,
    offer: null,
    hasOffer: false,
    hasExperience: false,
    catalogueCount: 0,
    hasUnpublishedChanges: false,
    entitlementStatus: null,
  },
];

const metricsMap = {
  "biz-1": { views: 412, whatsapp: 96, calls: 38, directions: 27, shares: 11, serviceClicks: 54 },
  "biz-2": { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0 },
};

const plans = [
  { id: "p1", key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
  { id: "p2", key: "ANNUAL", name: "Annual", priceKES: 999, durationDays: 365 },
  { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk", priceKES: 499, durationDays: 30 },
  { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Website Studio", priceKES: 999, durationDays: 30 },
];

export default function WorkspaceDesignPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="ws-shell min-h-screen">
      <header className="ws-chrome">
        <div className="ws-chrome__row">
          <BrandMark href="/dashboard" compact />
          <span className="ws-chrome__tag">Workspace</span>
          <div className="ws-chrome__actions">
            <span className="ws-chrome__account">mary@example.com</span>
            <Link href="/" className="jata-btn jata-btn-secondary">
              Home
            </Link>
            <button className="jata-btn jata-btn-ghost">Log out</button>
          </div>
        </div>
        <DashboardNav isAdmin={false} />
      </header>
      <main className="ws-main">
        <p className="ws-muted ws-tiny mb-3 rounded-lg border border-dashed border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-3 py-2">
          Developer preview · synthetic sample data · not a customer dashboard · development builds only.
        </p>
        <div className="ws-stack">
          <DashboardClient businesses={businesses as never} metricsMap={metricsMap as never} accountEmail="mary@example.com" />

          <section aria-label="Plans visual check" className="ws-stack">
            <WorkspaceHero
              compact
              kicker="Subscription"
              title={
                <>
                  One plan. <em>Clear price.</em> No surprises.
                </>
              }
              subtitle="Prices are in Kenyan shillings and come straight from your plan catalogue."
              photo={WORKSPACE_HERO_PHOTO}
              actions={
                <>
                  <Link href="#plans" className="ws-btn-amber">
                    <ArrowRight size={16} aria-hidden="true" /> Choose a plan
                  </Link>
                  <Link href="#payments" className="ws-btn-outline">
                    Payment history
                  </Link>
                </>
              }
            />
            <div className="ws-plans" id="plans">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  includes={PLAN_INCLUDES[plan.key] ?? []}
                  badge={PLAN_BADGES[plan.key]}
                  blurb={plan.key === "INTERACTIVE_BUSINESS" ? "Build, edit and preview your interactive business website." : null}
                  href="#checkout"
                  current={plan.key === "MONTHLY"}
                />
              ))}
            </div>
          </section>

          <ul className="ws-stack">
            {businesses.map((business) => (
              <WorkspaceDoor
                key={business.id}
                coverUrl={business.coverUrl}
                photo={photoForCategory(business.category)}
                title={business.name}
                meta={`${categoryLabel(business.category)} · /b/${business.slug}`}
                pills={
                  <>
                    <StatusPill tone={business.isPublished ? "success" : "neutral"}>{business.isPublished ? "Live" : "Draft"}</StatusPill>
                    <StatusPill tone={business.hasUnpublishedChanges ? "warning" : "info"}>
                      {business.hasUnpublishedChanges ? "Unpublished changes" : "Published"}
                    </StatusPill>
                  </>
                }
                note={<p className="ws-muted ws-tiny">Your site is live. Editing here never changes what customers see until you publish.</p>}
                actions={
                  <>
                    <Link className="jata-btn jata-btn-primary" href="#studio">
                      Open studio <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                    <Link className="jata-btn jata-btn-secondary" href={`/b/${business.slug}`}>
                      <ExternalLink size={15} aria-hidden="true" /> View site
                    </Link>
                  </>
                }
              />
            ))}
          </ul>

          <WorkspacePanel title="What each number means" meta="Every metric is measured, never estimated">
            <p className="ws-muted ws-small">
              These are counts recorded by your own pages. An empty chart means no responses have been recorded yet.
            </p>
          </WorkspacePanel>
        </div>
      </main>
    </div>
  );
}
