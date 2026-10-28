/**
 * `<img>` is used deliberately where the image URL is owner-supplied (a business cover or
 * logo) or comes from a fixed local registry with explicit width/height. next/image would
 * require the optimizer to fetch arbitrary remote URLs and would not respect the aspect-ratio
 * container these images fill, so the raw element with `loading="lazy"` is the safer choice.
 */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  ChartColumn,
  Check,
  CreditCard,
  ExternalLink,
  Eye,
  Globe,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Share2,
  Sparkles,
  Store,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHead, CardTitle, SectionHeading } from "@/components/ui/Card";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { Alert, EmptyState, Skeleton } from "@/components/ui/StateBlocks";
import { StatusPill } from "@/components/ui/StatusPill";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { notify } from "@/components/ui/Toaster";
import { LocationFields, locationError } from "@/components/LocationFields";
import { isValidKePhone } from "@/lib/phone";
import { SAFE_ERRORS } from "@/lib/safeError";
import { getSubscriptionPageUrl } from "@/lib/subscriptionFlow";
import { nextActionFor } from "@/lib/nextAction";
import { businessStatusLabel, subscriptionStatusLabel } from "@/lib/statusLabels";
import { daysUntil, formatDate, formatNumber } from "@/lib/dateFormat";
import { Reveal } from "@/components/ui/Reveal";
import ReferralShareCard from "@/components/ReferralShareCard";
import {
  WorkspaceEmpty,
  WorkspaceFact,
  WorkspaceFacts,
  WorkspaceHero,
  WorkspaceHeroStat,
  WorkspacePanel,
  WorkspaceSectionHead,
  WorkspaceStat,
} from "@/components/workspace/WorkspaceUI";
import {
  WORKSPACE_HERO_PHOTO,
  WORKSPACE_PHOTOS,
  businessInitials,
  categoryLabel,
  photoForCategory,
  safeImageUrl,
} from "@/lib/workspaceImagery";

// Recharts is a large dependency and a chart is never on the critical path: it loads after the
// owner can already read their numbers, and never blocks a payment or a publish.
const AnalyticsChart = dynamic(() => import("@/components/ui/AnalyticsChart"), {
  ssr: false,
  loading: () => <Skeleton variant="block" className="h-52" />,
});

type ServiceRow = { id: string; title: string; priceLabel: string | null; priceFrom: number | null };

export type Biz = {
  id: string;
  slug: string;
  name: string;
  category: string;
  isPublished: boolean;
  status: string;
  theme: string;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  description?: string | null;
  aftercallMsg?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  createdAt?: string | null;
  publicUrl: string;
  /** Stage 2: the owner's own referral link, when the page is eligible to share one. */
  referralUrl?: string | null;
  subscription: { status: string; expiresAt: string | null; planName: string } | null;
  lastPayment?: { status: string; createdAt: string } | null;
  services?: ServiceRow[];
  servicesCount: number;
  offer?: { title: string; subtitle: string | null; isActive: boolean } | null;
  hasOffer: boolean;
  /** Interactive Business state (§15) — optional so every business card keeps working. */
  hasExperience?: boolean;
  catalogueCount?: number;
  hasUnpublishedChanges?: boolean;
  entitlementStatus?: string | null;
};

type Metrics = { views: number; whatsapp: number; calls: number; directions: number; shares: number; serviceClicks?: number };
type Notice = { kind: "success" | "error"; text: string } | null;

export const EMPTY_METRICS: Metrics = { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0 };

function totalResponses(m: Metrics) {
  return (m.views || 0) + (m.whatsapp || 0) + (m.calls || 0) + (m.directions || 0) + (m.shares || 0) + (m.serviceClicks || 0);
}

function waLink(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

/**
 * Inline result banner.
 *
 * Toasts are additive, never the only evidence: this element is next to the control that
 * produced the result and is announced through a live region, so a customer who misses the
 * toast — or uses a screen reader — still gets the outcome.
 */
function NoticeBar({ notice }: { notice: Notice }) {
  if (!notice) return <p role="status" aria-live="polite" className="sr-only" />;
  return (
    <Alert tone={notice.kind === "error" ? "danger" : "success"} live>
      {notice.text}
    </Alert>
  );
}

/**
 * The workspace overview.
 *
 * Layout: hero band (real totals) → portfolio comparison (only for multiple businesses) →
 * one rich card per business. Each card leads with the business's own photograph (or the
 * category illustration when the owner has not uploaded one), then its real response
 * numbers, then its next step, then the controls that change it.
 */
export default function DashboardClient({
  businesses,
  metricsMap,
  accountEmail,
  teamFreeAccess = false,
}: {
  businesses: Biz[];
  metricsMap: Record<string, Metrics>;
  accountEmail?: string;
  /** Verified server-side entitlement; the client never decides this. */
  teamFreeAccess?: boolean;
}) {
  const totals = useMemo(
    () =>
      businesses.reduce<Metrics>(
        (sum, business) => {
          const m = metricsMap[business.id] || EMPTY_METRICS;
          return {
            views: sum.views + (m.views || 0),
            whatsapp: sum.whatsapp + (m.whatsapp || 0),
            calls: sum.calls + (m.calls || 0),
            directions: sum.directions + (m.directions || 0),
            shares: sum.shares + (m.shares || 0),
            serviceClicks: (sum.serviceClicks || 0) + (m.serviceClicks || 0),
          };
        },
        { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0 },
      ),
    [businesses, metricsMap],
  );

  if (businesses.length === 0) {
    return (
      <div className="ws-stack">
        <WorkspaceHero
          kicker="Your workspace"
          title={
            <>
              Start with <em>one page</em> customers can act on.
            </>
          }
          subtitle="Set up your business, choose a plan and share one link. WhatsApp, Call, Directions and your services sit on it — no website build, no developer."
          photo={WORKSPACE_HERO_PHOTO}
          actions={
            <>
              <Link href="/onboarding" className="ws-btn-amber">
                Start setup <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/dashboard/subscription" className="ws-btn-outline">
                See plans
              </Link>
            </>
          }
          meta="Seven short steps · your answers save as you go · pay with M-Pesa or card"
        />
        <WorkspaceEmpty
          title="No business page yet"
          text="Your workspace fills up as soon as you add a business: the page, its plan, its AI front desk, its website and its till all live here."
          photo={WORKSPACE_PHOTOS.retail}
          actions={
            <>
              <Button href="/onboarding">Start setup</Button>
              <Button href="/dashboard/subscription" variant="secondary">
                See plans
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const multiple = businesses.length > 1;
  const liveCount = businesses.filter((business) => business.isPublished).length;
  const responseTotal = totalResponses(totals);
  const firstName = businesses[0]?.name || "your business";

  return (
    <div className="ws-stack">
      <WorkspaceHero
        kicker="Your workspace"
        title={
          multiple ? (
            <>
              Everything for <em>{businesses.length} businesses</em>, in one place.
            </>
          ) : (
            <>
              Everything for <em>{firstName}</em>, in one place.
            </>
          )
        }
        subtitle={
          multiple
            ? "Each business keeps its own page, plan, website and till. The numbers below are the real counts recorded across all of them."
            : "Your public page, your AI front desk, your website studio and your till, side by side. Customers see the page; you see what they do on it."
        }
        photo={WORKSPACE_HERO_PHOTO}
        stats={
          <>
            <WorkspaceHeroStat label="Page views" value={formatNumber(totals.views)} />
            <WorkspaceHeroStat label="WhatsApp taps" value={formatNumber(totals.whatsapp)} />
            <WorkspaceHeroStat label="Calls" value={formatNumber(totals.calls)} />
            <WorkspaceHeroStat label="Directions" value={formatNumber(totals.directions)} />
          </>
        }
        actions={
          <>
            <Link href="/dashboard/studio" className="ws-btn-amber">
              <Wand2 size={16} aria-hidden="true" /> Open Website Studio
            </Link>
            <Link href="/dashboard/subscription" className="ws-btn-outline">
              <CreditCard size={16} aria-hidden="true" /> Manage plan
            </Link>
            <Link href="/onboarding" className="ws-btn-quiet">
              <Sparkles size={16} aria-hidden="true" /> Add a business
            </Link>
          </>
        }
        meta={`${liveCount} of ${businesses.length} ${businesses.length === 1 ? "page" : "pages"} live to customers · ${
          responseTotal ? `${formatNumber(responseTotal)} recorded customer responses` : "no customer responses recorded yet"
        }${accountEmail ? ` · signed in as ${accountEmail}` : ""}`}
      />

      {multiple ? <PortfolioSummary totals={totals} count={businesses.length} /> : null}
      {multiple ? <BusinessTable businesses={businesses} metricsMap={metricsMap} /> : null}

      <div className="ws-stack">
        {businesses.map((b, index) => (
          <Reveal key={b.id} as="div" delay={index * 0.03}>
            <BusinessCard b={b} m={metricsMap[b.id] || EMPTY_METRICS} teamFreeAccess={teamFreeAccess} />
          </Reveal>
        ))}
      </div>

      <WorkspacePanel title="What each number means" meta="Every metric is measured, never estimated">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MeaningRow icon={<Eye size={15} />} label="Page views" text="Times a customer opened your public page." />
          <MeaningRow icon={<MessageCircle size={15} />} label="WhatsApp taps" text="Times a customer tapped your WhatsApp button." />
          <MeaningRow icon={<Phone size={15} />} label="Calls" text="Times a customer tapped to call your number." />
          <MeaningRow icon={<Navigation size={15} />} label="Directions" text="Times a customer asked for directions to you." />
        </div>
        <p className="ws-muted ws-tiny mt-3">
          These are counts recorded by your own pages. We do not estimate visitors, infer customers or show a number we cannot
          measure — an empty chart means no responses have been recorded yet.
        </p>
      </WorkspacePanel>
    </div>
  );
}

function MeaningRow({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--ws-line)] bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[0.78rem] font-bold">
        <span aria-hidden="true" className="text-[color:var(--ws-amber-deep)]">
          {icon}
        </span>
        {label}
      </p>
      <p className="ws-muted ws-tiny mt-0.5">{text}</p>
    </div>
  );
}

/** Owner-level summary across every business, only shown when there is more than one. */
function PortfolioSummary({ totals, count }: { totals: Metrics; count: number }) {
  const total = totalResponses(totals);
  return (
    <Card labelledBy="portfolio-title" raised>
      <CardHead>
        <div>
          <CardTitle id="portfolio-title">All {count} businesses</CardTitle>
          <p className="ws-muted ws-tiny mt-0.5">Combined, from the same recorded events as each card below.</p>
        </div>
        <StatusPill tone={total ? "success" : "neutral"}>{total ? `${formatNumber(total)} responses` : "No responses yet"}</StatusPill>
      </CardHead>
      <CardBody className="space-y-5">
        <MetricGrid label="Customer responses across all businesses">
          <Metric label="Page views" value={formatNumber(totals.views)} />
          <Metric label="WhatsApp taps" value={formatNumber(totals.whatsapp)} />
          <Metric label="Calls" value={formatNumber(totals.calls)} />
          <Metric label="Directions" value={formatNumber(totals.directions)} />
        </MetricGrid>
        <div>
          <SectionHeading title="Where customers respond" meta="Real data, all businesses" />
          <AnalyticsChart
            title="Responses"
            series={[
              { label: "Views", value: totals.views, colour: "var(--ws-amber)" },
              { label: "WhatsApp", value: totals.whatsapp, colour: "var(--ws-jade)" },
              { label: "Calls", value: totals.calls, colour: "var(--jata-info)" },
              { label: "Directions", value: totals.directions, colour: "var(--ws-ember)" },
              { label: "Shares", value: totals.shares, colour: "#7c3aed" },
            ]}
          />
        </div>
      </CardBody>
    </Card>
  );
}

/** Sortable comparison table — useful only when there is more than one business. */
function BusinessTable({ businesses, metricsMap }: { businesses: Biz[]; metricsMap: Record<string, Metrics> }) {
  const rows = businesses.map((b) => {
    const m = metricsMap[b.id] || EMPTY_METRICS;
    const sub = subscriptionStatusLabel(b.subscription?.status);
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      state: b.isPublished ? "Live" : "Draft",
      plan: sub.label,
      responses: totalResponses(m),
      views: m.views || 0,
    };
  });

  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: "name",
      header: "Business",
      cell: (row) => (
        <Link href={`/dashboard/businesses/${row.id}`} className="font-semibold hover:underline">
          {row.name}
        </Link>
      ),
      sortValue: (row) => row.name.toLowerCase(),
    },
    {
      id: "state",
      header: "Page",
      cell: (row) => <StatusPill tone={row.state === "Live" ? "success" : "neutral"}>{row.state}</StatusPill>,
      sortValue: (row) => row.state,
    },
    { id: "plan", header: "Plan", cell: (row) => row.plan, sortValue: (row) => row.plan },
    { id: "views", header: "Views", cell: (row) => formatNumber(row.views), sortValue: (row) => row.views, align: "end" },
    { id: "responses", header: "Responses", cell: (row) => formatNumber(row.responses), sortValue: (row) => row.responses, align: "end" },
  ];

  return (
    <Card labelledBy="business-table-title">
      <CardHead>
        <CardTitle id="business-table-title">Compare your businesses</CardTitle>
        <p className="ws-section-head__meta">Sortable</p>
      </CardHead>
      <CardBody>
        <DataTable rows={rows} columns={columns} initialSort={{ id: "views", desc: true }} caption="Your businesses by page activity" />
      </CardBody>
    </Card>
  );
}

type Section = "profile" | "services" | "offer" | null;

function BusinessCard({ b, m, teamFreeAccess = false }: { b: Biz; m: Metrics; teamFreeAccess?: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [open, setOpen] = useState<Section>(null);
  const [busy, setBusy] = useState(false);
  const sub = subscriptionStatusLabel(b.subscription?.status);
  const bizStatus = businessStatusLabel(b.status);
  const action = nextActionFor({
    isPublished: b.isPublished,
    hasContact: Boolean(b.phone || b.whatsapp),
    hasLocation: Boolean(b.location || (typeof b.lat === "number" && typeof b.lng === "number")),
    servicesCount: b.servicesCount,
    subscriptionStatus: b.subscription?.status ?? null,
    expiresAt: b.subscription?.expiresAt ?? null,
    hasExperience: b.hasExperience,
    catalogueCount: b.catalogueCount,
    hasUnpublishedChanges: b.hasUnpublishedChanges,
    entitlementStatus: b.entitlementStatus ?? null,
    teamFreeAccess,
  });

  const coverUrl = safeImageUrl(b.coverUrl);
  const logoUrl = safeImageUrl(b.logoUrl);
  const photo = photoForCategory(b.category);
  const whatsappHref = waLink(b.whatsapp || b.phone);
  const days = b.subscription?.expiresAt ? daysUntil(b.subscription.expiresAt) : null;

  async function patch(body: Record<string, unknown>, success = "Saved.") {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: b.id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text = data.error || SAFE_ERRORS.saveFailed;
        setNotice({ kind: "error", text });
        notify.error("Change not saved", text);
        return false;
      }
      setNotice({ kind: "success", text: success });
      notify.success(success);
      router.refresh();
      return true;
    } catch {
      setNotice({ kind: "error", text: SAFE_ERRORS.saveFailed });
      notify.error("Change not saved", SAFE_ERRORS.saveFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: b.id, eventType: "SHARE_CLICK" }),
    }).catch(() => {});
    if (navigator.share) {
      navigator.share({ title: b.name, url: b.publicUrl }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(b.publicUrl);
      setNotice({ kind: "success", text: "Link copied. Paste it into WhatsApp, SMS or social media." });
      notify.success("Link copied", "Paste it into WhatsApp, SMS or social media.");
    } catch {
      setNotice({ kind: "success", text: `Copy your link: ${b.publicUrl}` });
    }
  }

  function actionControl() {
    switch (action.key) {
      case "add-contact":
      case "add-location":
        return <Button onClick={() => setOpen("profile")}>{action.key === "add-contact" ? "Add contact details" : "Add location"}</Button>;
      case "add-services":
        return <Button onClick={() => setOpen("services")}>Add a service</Button>;
      case "start-experience":
        return <Button href={`/dashboard/businesses/${b.id}`}>Start my website</Button>;
      case "add-items":
        return <Button href={`/dashboard/businesses/${b.id}/items`}>Add what I sell</Button>;
      case "publish-changes":
        return <Button href={`/dashboard/businesses/${b.id}/preview`}>Review &amp; publish</Button>;
      case "publish":
        return (
          <Button loading={busy} onClick={() => patch({ isPublished: true }, "Published. Your page is live.")}>
            Publish page
          </Button>
        );
      case "renew":
      case "subscribe":
        return <Button href={getSubscriptionPageUrl(b.id)}>{action.key === "renew" ? "Renew plan" : "Choose a plan"}</Button>;
      default:
        return <Button onClick={() => void share()}>Share page</Button>;
    }
  }

  const responseSeries = [
    { label: "Views", value: m.views || 0, colour: "var(--ws-amber)" },
    { label: "WhatsApp", value: m.whatsapp || 0, colour: "var(--ws-jade)" },
    { label: "Calls", value: m.calls || 0, colour: "var(--jata-info)" },
    { label: "Directions", value: m.directions || 0, colour: "#c2410c" },
  ];

  const activity = [
    b.createdAt ? { title: "Business created", meta: formatDate(b.createdAt), icon: <Sparkles size={12} /> } : null,
    b.isPublished ? { title: "Page live to customers", meta: `Shared at /b/${b.slug}`, icon: <Globe size={12} /> } : { title: "Page is a private draft", meta: "Publish to show it to customers", icon: <Eye size={12} /> },
    b.lastPayment ? { title: "Latest plan payment", meta: formatDate(b.lastPayment.createdAt), icon: <CreditCard size={12} /> } : null,
    b.subscription?.expiresAt ? { title: "Plan access ends", meta: formatDate(b.subscription.expiresAt), icon: <CalendarDays size={12} /> } : null,
    b.hasUnpublishedChanges ? { title: "Website changes saved, not published", meta: "Review and publish them", icon: <Wand2 size={12} /> } : null,
  ].filter(Boolean) as Array<{ title: string; meta: string; icon: React.ReactNode }>;

  return (
    <article className="ws-biz" aria-labelledby={`biz-${b.id}-name`}>
      <div className="ws-biz__cover">
        {coverUrl ? (
          // The owner's own cover photograph: the strongest possible thumbnail for their page.
          // Decorative — the business name and facts are directly below it.
          <img src={coverUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        ) : (
          <WorkspaceCover photo={photo} />
        )}
        <div className="ws-biz__cover-top">
          <div className="ws-cover-pills">
            <StatusPill tone={b.isPublished ? "success" : "neutral"} icon={b.isPublished ? <Eye size={11} /> : undefined}>
              {b.isPublished ? "Live" : "Draft"}
            </StatusPill>
            <StatusPill tone={sub.tone}>{sub.label === "No subscription" ? "No plan yet" : sub.label}</StatusPill>
            {b.hasUnpublishedChanges ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
            {b.status === "SUSPENDED" ? <StatusPill tone={bizStatus.tone}>{bizStatus.label}</StatusPill> : null}
          </div>
        </div>
        <div className="ws-biz__cover-id">
          <span className="ws-avatar" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full rounded-[inherit] object-cover" loading="lazy" /> : businessInitials(b.name)}
          </span>
          <div className="min-w-0">
            <h2 id={`biz-${b.id}-name`} className="ws-biz__name">
              {b.name}
            </h2>
            <p className="ws-biz__meta">
              {categoryLabel(b.category)}
              {b.location ? ` · ${b.location}` : ""} · /b/{b.slug}
            </p>
          </div>
        </div>
      </div>

      <div className="ws-biz__body">
        {notice ? <NoticeBar notice={notice} /> : null}

        {/* Next step — exactly one, always the highest-priority action. */}
        <section aria-label="Next step" className="ws-next">
          <div className="ws-next__copy">
            <p className="ws-next__label">
              <TrendingUp size={12} aria-hidden="true" /> Next step
            </p>
            <p className="ws-next__title">{action.title}</p>
            <p className="ws-next__detail">{action.detail}</p>
          </div>
          <div className="ws-next__actions">
            {actionControl()}
            <Button href={`/dashboard/businesses/${b.id}`} variant="secondary">
              Open studio
            </Button>
          </div>
        </section>

        {/* Real response numbers. */}
        <section aria-labelledby={`biz-${b.id}-activity`}>
          <WorkspaceSectionHead id={`biz-${b.id}-activity`} title="How customers respond" meta="Recorded by your page" />
          <div className="ws-stats ws-stats--5">
            <WorkspaceStat label="Views" value={formatNumber(m.views)} metric="views" icon={<Eye size={13} />} />
            <WorkspaceStat label="WhatsApp" value={formatNumber(m.whatsapp)} metric="whatsapp" icon={<MessageCircle size={13} />} />
            <WorkspaceStat label="Calls" value={formatNumber(m.calls)} metric="calls" icon={<Phone size={13} />} />
            <WorkspaceStat label="Directions" value={formatNumber(m.directions)} metric="directions" icon={<Navigation size={13} />} />
            <WorkspaceStat label="Shares" value={formatNumber(m.shares)} metric="shares" icon={<Share2 size={13} />} />
          </div>
          <div className="mt-3">
            <AnalyticsChart title="Responses" series={responseSeries} />
          </div>
        </section>

        {/* Quick actions */}
        <section aria-label="Quick actions">
          <WorkspaceSectionHead title="Quick actions" />
          <div className="ws-actions">
            <Link href={`/dashboard/businesses/${b.id}`} className="ws-action">
              <Wand2 size={16} aria-hidden="true" /> Website Studio
            </Link>
            <Link href={`/b/${b.slug}`} className="ws-action" data-primary={b.isPublished ? "true" : undefined}>
              <ExternalLink size={16} aria-hidden="true" /> {b.isPublished ? "View live page" : "Preview page"}
            </Link>
            <button type="button" onClick={() => void share()} className="ws-action">
              <Share2 size={16} aria-hidden="true" /> {b.isPublished ? "Share page" : "Copy link"}
            </button>
            {whatsappHref ? (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="ws-action">
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp
              </a>
            ) : null}
            {b.phone ? (
              <a href={`tel:${b.phone}`} className="ws-action">
                <Phone size={16} aria-hidden="true" /> Call
              </a>
            ) : null}
            <Link href={`/dashboard/ai?businessId=${b.id}`} className="ws-action">
              <Bot size={16} aria-hidden="true" /> AI Front Desk
            </Link>
            <Link href={`/dashboard/pos/${b.id}`} className="ws-action">
              <Store size={16} aria-hidden="true" /> Business POS
            </Link>
            <Link href={`/dashboard/businesses/${b.id}/insights`} className="ws-action">
              <ChartColumn size={16} aria-hidden="true" /> Insights
            </Link>
            <Link href={getSubscriptionPageUrl(b.id)} className="ws-action">
              <CreditCard size={16} aria-hidden="true" /> Plan &amp; billing
            </Link>
            <Link href={`/dashboard/businesses/${b.id}/photos`} className="ws-action">
              <Sparkles size={16} aria-hidden="true" /> Photos
            </Link>
          </div>
        </section>

        <div className="ws-grid-2">
          <div className="ws-col">
            {/* Facts */}
            <section aria-labelledby={`biz-${b.id}-facts`}>
              <WorkspaceSectionHead id={`biz-${b.id}-facts`} title="Page & plan" />
              <WorkspaceFacts>
                <WorkspaceFact label="Public address" icon={<Globe size={13} />}>
                  <Link href={`/b/${b.slug}`} className="underline underline-offset-2">
                    /b/{b.slug}
                  </Link>
                </WorkspaceFact>
                <WorkspaceFact label="Plan" icon={<CreditCard size={13} />}>
                  {b.subscription ? b.subscription.planName : "No plan yet"}
                </WorkspaceFact>
                <WorkspaceFact label="Plan status" icon={<Check size={13} />}>
                  {sub.label}
                  {days !== null && b.subscription?.status === "ACTIVE" ? ` · ${days > 0 ? `${days} days left` : "ends today"}` : ""}
                </WorkspaceFact>
                <WorkspaceFact label="Location" icon={<MapPin size={13} />}>
                  {b.location || "Not added yet"}
                </WorkspaceFact>
                <WorkspaceFact label="Services" icon={<Sparkles size={13} />}>
                  {b.servicesCount} listed
                </WorkspaceFact>
                <WorkspaceFact label="Website" icon={<Wand2 size={13} />}>
                  {b.hasExperience ? (b.hasUnpublishedChanges ? "Saved changes not published" : "Website set up") : "Not started"}
                </WorkspaceFact>
              </WorkspaceFacts>
              {sub.help ? <p className="ws-muted ws-tiny mt-2">{sub.help}</p> : null}
            </section>

            {b.referralUrl ? <ReferralShareCard url={b.referralUrl} /> : null}
          </div>

          <div className="ws-col">
            <section aria-labelledby={`biz-${b.id}-timeline`}>
              <WorkspaceSectionHead id={`biz-${b.id}-timeline`} title="Activity" meta="Facts, not estimates" />
              <ol className="ws-timeline">
                {activity.map((entry) => (
                  <li key={entry.title}>
                    <span className="ws-timeline__dot" aria-hidden="true" />
                    <span>
                      <span className="ws-timeline__title">{entry.title}</span>
                      <span className="ws-timeline__meta block">{entry.meta}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>

        {/* Editing — progressive disclosure, one panel at a time. */}
        <section aria-label="Edit this business">
          <WorkspaceSectionHead title="Edit" meta="Changes save to your live data" />
          <details className="ws-editor" open={open === "profile"} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open ? "profile" : null)}>
            <summary>
              <Sparkles size={15} aria-hidden="true" /> Profile, contact &amp; location
            </summary>
            <div className="ws-editor__body">
              <EditForm business={b} busy={busy} onSave={(body) => patch(body, "Profile saved.")} />
            </div>
          </details>
          <details className="ws-editor" open={open === "services"} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open ? "services" : null)}>
            <summary>
              <Check size={15} aria-hidden="true" /> Services ({b.servicesCount} listed)
            </summary>
            <div className="ws-editor__body">
              <ServiceManager businessId={b.id} services={b.services || []} onSaved={() => router.refresh()} />
            </div>
          </details>
          <details className="ws-editor" open={open === "offer"} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open ? "offer" : null)}>
            <summary>
              <TrendingUp size={15} aria-hidden="true" /> Offer {b.offer?.title ? `— ${b.offer.title}` : "(none yet)"}
            </summary>
            <div className="ws-editor__body">
              <OfferManager businessId={b.id} offer={b.offer || null} onSaved={() => router.refresh()} />
            </div>
          </details>
        </section>

        {b.isPublished ? (
          <div className="border-t border-[color:var(--ws-line)] pt-3">
            <button
              type="button"
              disabled={busy}
              className="jata-btn jata-btn-ghost"
              onClick={() => patch({ isPublished: false }, "Unpublished. Your page is now a private draft.")}
            >
              Unpublish page
            </button>
            <p className="ws-muted ws-tiny mt-1">
              Unpublishing hides the page from customers immediately. Your plan, services and website stay saved.
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** The category illustration behind a card that has no owner-uploaded cover. */
function WorkspaceCover({ photo }: { photo: ReturnType<typeof photoForCategory> }) {
  return (
    <picture>
      {photo.webpSrcSet || photo.webp ? <source type="image/webp" srcSet={photo.webpSrcSet ?? photo.webp} sizes="(min-width: 900px) 78rem, 100vw" /> : null}
      <img
        src={photo.src}
        srcSet={photo.srcSet}
        sizes="(min-width: 900px) 78rem, 100vw"
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}

function EditForm({ business, busy, onSave }: { business: Biz; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const [form, setForm] = useState({
    name: business.name,
    category: business.category,
    phone: business.phone || "",
    whatsapp: business.whatsapp || "",
    location: business.location || "",
    lat: business.lat === null || business.lat === undefined ? "" : String(business.lat),
    lng: business.lng === null || business.lng === undefined ? "" : String(business.lng),
    description: business.description || "",
    aftercallMsg: business.aftercallMsg || "",
    theme: business.theme,
  });
  const [problem, setProblem] = useState("");
  return (
    <div className="mt-1 space-y-2">
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field id={`${business.id}-name`} label="Business name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field id={`${business.id}-category`} label="Category">
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </Field>
        <Field
          id={`${business.id}-phone`}
          label="Nominated contact number"
          hint="Kenyan mobile, e.g. 0724 317 010. Powers the Call button on your public page."
        >
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            inputMode="tel"
            autoComplete="tel"
            placeholder="0724 317 010"
            maxLength={20}
          />
        </Field>
        <Field
          id={`${business.id}-whatsapp`}
          label="WhatsApp number"
          hint="Kenyan mobile. Leave blank to use the nominated contact number above."
        >
          <input
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            inputMode="tel"
            autoComplete="tel"
            placeholder="0724 317 010"
            maxLength={20}
          />
        </Field>
      </div>
      <LocationFields
        idPrefix={business.id}
        value={{ location: form.location, lat: form.lat, lng: form.lng }}
        onChange={(v) => setForm({ ...form, ...v })}
      />
      <Field id={`${business.id}-description`} label="Description">
        <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field id={`${business.id}-banner`} label="After-call message" hint="Shown at the top of your page.">
        <input maxLength={120} value={form.aftercallMsg} onChange={(e) => setForm({ ...form, aftercallMsg: e.target.value })} />
      </Field>
      <Field id={`${business.id}-theme`} label="Page style" hint="Clean, dark, or warm.">
        <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
          <option value="clean">Clean</option>
          <option value="dark">Dark</option>
          <option value="warm">Warm</option>
        </select>
      </Field>
      <FormError>{problem}</FormError>
      <Button
        loading={busy}
        onClick={() => {
          const p = locationError(form);
          // Client-side mirror of the server KE gate (parseContactNumber in app/api/business);
          // the API remains the authoritative boundary for direct requests.
          const contactProblem =
            form.phone.trim() && !isValidKePhone(form.phone)
              ? "Enter a valid Kenyan mobile number for the nominated contact (e.g. 0724 317 010)."
              : form.whatsapp.trim() && !isValidKePhone(form.whatsapp)
                ? "Enter a valid Kenyan mobile number for WhatsApp (e.g. 0724 317 010), or leave it blank."
                : "";
          setProblem(p || contactProblem);
          if (!p && !contactProblem) void onSave({ ...form, whatsapp: form.whatsapp || form.phone });
        }}
      >
        Save profile
      </Button>
    </div>
  );
}

function ServiceManager({ businessId, services, onSaved }: { businessId: string; services: ServiceRow[]; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  async function add() {
    if (saving) return;
    if (title.trim().length < 2) {
      setMsg({ kind: "error", text: "Enter a service name (at least 2 characters)." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, title, priceLabel: price || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: data.error || SAFE_ERRORS.serviceFailed });
        notify.error("Service not saved", data.error || SAFE_ERRORS.serviceFailed);
        return;
      }
      setMsg({ kind: "success", text: "Service saved." });
      notify.success("Service saved");
      setTitle("");
      setPrice("");
      onSaved();
    } catch {
      setMsg({ kind: "error", text: SAFE_ERRORS.serviceFailed });
      notify.error("Service not saved", SAFE_ERRORS.serviceFailed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-1 space-y-3">
      {services.length === 0 ? (
        <EmptyState title="No services yet">Add the services or products customers ask about most, with a price if you have one.</EmptyState>
      ) : (
        <ul className="divide-y divide-[color:var(--ws-line-soft)]">
          {services.map((service) => (
            <li key={service.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{service.title}</span>
              <span className="ws-muted shrink-0 text-[0.78rem]">
                {service.priceLabel || (typeof service.priceFrom === "number" ? `From KES ${formatNumber(service.priceFrom)}` : "—")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field id={`${businessId}-service`} label="Service or product">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id={`${businessId}-service-price`} label="Price label" hint="For example From KES 1,500.">
          <input value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <Button loading={saving} onClick={add}>
        Add service
      </Button>
      <NoticeBar notice={msg} />
    </div>
  );
}

function OfferManager({ businessId, offer, onSaved }: { businessId: string; offer: { title: string; subtitle: string | null; isActive: boolean } | null; onSaved: () => void }) {
  const [title, setTitle] = useState(offer?.title || "");
  const [subtitle, setSubtitle] = useState(offer?.subtitle || "");
  const [msg, setMsg] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    if (!title.trim()) {
      setMsg({ kind: "error", text: "Enter an offer title." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, title, subtitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "error", text: data.error || SAFE_ERRORS.offerFailed });
        notify.error("Offer not saved", data.error || SAFE_ERRORS.offerFailed);
        return;
      }
      setMsg({ kind: "success", text: "Offer saved." });
      notify.success("Offer saved");
      onSaved();
    } catch {
      setMsg({ kind: "error", text: SAFE_ERRORS.offerFailed });
      notify.error("Offer not saved", SAFE_ERRORS.offerFailed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-1 space-y-3">
      {offer?.isActive ? (
        <p className="ws-muted ws-tiny">
          Live offer: <strong>{offer.title}</strong>
          {offer.subtitle ? ` — ${offer.subtitle}` : ""}
        </p>
      ) : (
        <p className="ws-muted ws-tiny">No offer is showing on your page yet. Saving one publishes it immediately.</p>
      )}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field id={`${businessId}-offer`} label="Offer title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id={`${businessId}-offer-sub`} label="Offer detail">
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </Field>
      </div>
      <Button loading={saving} onClick={save}>
        Save offer
      </Button>
      <NoticeBar notice={msg} />
    </div>
  );
}
