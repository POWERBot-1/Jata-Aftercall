"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Eye, MessageCircle, Phone, Share2, TrendingUp } from "lucide-react";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHead, CardTitle, SectionHeading } from "@/components/ui/Card";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { Alert, EmptyState, Skeleton } from "@/components/ui/StateBlocks";
import { StatusPill } from "@/components/ui/StatusPill";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { notify } from "@/components/ui/Toaster";
import { LocationFields, locationError } from "@/components/LocationFields";
import { SAFE_ERRORS } from "@/lib/safeError";
import { getSubscriptionPageUrl } from "@/lib/subscriptionFlow";
import { nextActionFor } from "@/lib/nextAction";
import { businessStatusLabel, subscriptionStatusLabel } from "@/lib/statusLabels";
import { formatDate, formatNumber } from "@/lib/dateFormat";
import { Reveal } from "@/components/ui/Reveal";
import ReferralShareCard from "@/components/ReferralShareCard";

// Recharts is a large dependency and a chart is never on the critical path: it loads after the
// owner can already read their numbers, and never blocks a payment or a publish.
const AnalyticsChart = dynamic(() => import("@/components/ui/AnalyticsChart"), {
  ssr: false,
  loading: () => <Skeleton variant="block" className="h-52" />,
});

type Biz = {
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
  publicUrl: string;
  /** Stage 2: the owner's own referral link, when the page is eligible to share one. */
  referralUrl?: string | null;
  subscription: { status: string; expiresAt: string | null; planName: string } | null;
  servicesCount: number;
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

export default function DashboardClient({ businesses, metricsMap }: { businesses: Biz[]; metricsMap: Record<string, Metrics> }) {
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
      <Card className="mt-2" labelledBy="dashboard-empty-title">
        <CardBody>
          <EmptyState
            title="No business page yet"
            actions={
              <>
                <Button href="/onboarding">Start setup</Button>
                <Button href="/dashboard/subscription" variant="secondary">
                  See plans
                </Button>
              </>
            }
          >
            <span id="dashboard-empty-title">Set one up in seven short steps. Your page goes live once your subscription payment is confirmed.</span>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  const multiple = businesses.length > 1;

  return (
    <div className="space-y-6">
      {multiple ? <PortfolioSummary totals={totals} count={businesses.length} /> : null}

      {multiple ? <BusinessTable businesses={businesses} metricsMap={metricsMap} /> : null}

      <div className="space-y-6">
        {businesses.map((b, index) => (
          <Reveal key={b.id} as="div" delay={index * 0.03}>
            <BusinessCard b={b} m={metricsMap[b.id] || EMPTY_METRICS} />
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/** Owner-level summary across every business, only shown when there is more than one. */
function PortfolioSummary({ totals, count }: { totals: Metrics; count: number }) {
  const total = totalResponses(totals);
  return (
    <Card labelledBy="portfolio-title">
      <CardHead>
        <CardTitle id="portfolio-title">All {count} businesses</CardTitle>
        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--jata-muted)]">
          {total ? `${formatNumber(total)} customer responses` : "No responses yet"}
        </p>
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
              { label: "Views", value: totals.views, colour: "var(--jata-accent)" },
              { label: "WhatsApp", value: totals.whatsapp, colour: "var(--jata-live)" },
              { label: "Calls", value: totals.calls, colour: "var(--jata-info)" },
              { label: "Directions", value: totals.directions, colour: "#7c3aed" },
              { label: "Shares", value: totals.shares, colour: "#0891b2" },
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
        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--jata-muted)]">Sortable</p>
      </CardHead>
      <CardBody>
        <DataTable rows={rows} columns={columns} initialSort={{ id: "views", desc: true }} caption="Your businesses by page activity" />
      </CardBody>
    </Card>
  );
}

type Section = "profile" | "services" | "offer" | null;

function BusinessCard({ b, m }: { b: Biz; m: Metrics }) {
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
  });

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
    { label: "Views", value: m.views || 0, colour: "var(--jata-accent)" },
    { label: "WhatsApp", value: m.whatsapp || 0, colour: "var(--jata-live)" },
    { label: "Calls", value: m.calls || 0, colour: "var(--jata-info)" },
    { label: "Directions", value: m.directions || 0, colour: "#7c3aed" },
  ];

  return (
    <Card as="article" labelledBy={`biz-${b.id}-name`} interactive>
      <CardHead>
        <div className="min-w-0">
          <h2 id={`biz-${b.id}-name`} className="jata-surface__title [overflow-wrap:anywhere]">
            {b.name}
          </h2>
          <p className="mt-0.5 text-[0.8rem] text-[color:var(--jata-muted)] [overflow-wrap:anywhere]">
            {b.category} · /b/{b.slug}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusPill tone={b.isPublished ? "success" : "neutral"} icon={b.isPublished ? <Eye size={12} /> : undefined}>
              {b.isPublished ? "Live" : "Draft"}
            </StatusPill>
            <StatusPill tone={sub.tone}>Plan: {sub.label}</StatusPill>
            {b.status === "SUSPENDED" ? <StatusPill tone={bizStatus.tone}>{bizStatus.label}</StatusPill> : null}
            {b.hasUnpublishedChanges ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
          </div>
        </div>
      </CardHead>

      <CardBody className="space-y-5">
        {notice ? <NoticeBar notice={notice} /> : null}

        {/* Next step — exactly one, always the highest-priority action. */}
        <section aria-label="Next step" className="jata-surface jata-surface--muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.72rem] font-bold uppercase tracking-wider text-[color:var(--jata-muted)]">Next step</p>
              <p className="mt-0.5 font-semibold">{action.title}</p>
              <p className="text-sm text-[color:var(--jata-muted)]">{action.detail}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {actionControl()}
              <Button href={`/dashboard/businesses/${b.id}`} variant="secondary" icon={<TrendingUp size={15} />}>
                Open studio
              </Button>
            </div>
          </div>
        </section>

        {/* Subscription */}
        <section aria-label="Subscription" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="min-w-0">
            <span className="font-semibold">Subscription:</span>{" "}
            {b.subscription
              ? `${b.subscription.planName} — ${sub.label}${b.subscription.expiresAt ? ` · until ${formatDate(b.subscription.expiresAt)}` : ""}`
              : "No plan yet. Choose a plan to unlock publishing."}
            {sub.help ? ` ${sub.help}` : ""}
          </p>
          {action.key !== "renew" && action.key !== "subscribe" ? (
            <Link href={getSubscriptionPageUrl(b.id)} className="jata-btn jata-btn-ghost underline">
              Manage plan
            </Link>
          ) : null}
        </section>

        {b.referralUrl ? <ReferralShareCard url={b.referralUrl} /> : null}

        {/* Activity */}
        <section aria-labelledby={`biz-${b.id}-activity`}>
          <SectionHeading id={`biz-${b.id}-activity`} title="Activity" meta="Since your page went live" />
          <MetricGrid label={`Activity for ${b.name}`}>
            <Metric label="Views" value={formatNumber(m.views)} />
            <Metric label="WhatsApp" value={formatNumber(m.whatsapp)} />
            <Metric label="Calls" value={formatNumber(m.calls)} />
            <Metric label="Directions" value={formatNumber(m.directions)} />
          </MetricGrid>
          <div className="mt-4">
            <AnalyticsChart title="Responses" series={responseSeries} />
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button href={`/dashboard/businesses/${b.id}`} variant="secondary" icon={<TrendingUp size={15} />}>
            Website studio
          </Button>
          <Button href={`/b/${b.slug}`} variant="secondary" icon={<ExternalLink size={15} />}>
            {b.isPublished ? "View page" : "Preview"}
          </Button>
          {action.key !== "share" ? (
            <Button variant="secondary" onClick={() => void share()} icon={<Share2 size={15} />}>
              {b.isPublished ? "Share" : "Copy link"}
            </Button>
          ) : null}
          <Button href={`https://wa.me/${(b.whatsapp || b.phone || "").replace(/\D/g, "")}`} variant="ghost" icon={<MessageCircle size={15} />} ariaLabel={`Message ${b.name} on WhatsApp`}>
            WhatsApp
          </Button>
          {b.phone ? (
            <Button href={`tel:${b.phone}`} variant="ghost" icon={<Phone size={15} />} ariaLabel={`Call ${b.name}`}>
              Call
            </Button>
          ) : null}
        </div>

        {/* Editing */}
        <div className="space-y-2">
          <EditSection title="Edit profile, contact &amp; location" open={open === "profile"} onToggle={(o) => setOpen(o ? "profile" : null)}>
            <EditForm business={b} busy={busy} onSave={(body) => patch(body, "Profile saved.")} />
          </EditSection>
          <EditSection title={`Services (${b.servicesCount} listed)`} open={open === "services"} onToggle={(o) => setOpen(o ? "services" : null)}>
            <ServiceManager businessId={b.id} onSaved={() => router.refresh()} />
          </EditSection>
          <EditSection title={b.hasOffer ? "Offer (live)" : "Offer (none yet)"} open={open === "offer"} onToggle={(o) => setOpen(o ? "offer" : null)}>
            <OfferManager businessId={b.id} onSaved={() => router.refresh()} />
          </EditSection>
        </div>

        {b.isPublished ? (
          <div className="border-t border-[color:var(--jata-line)] pt-3">
            <button
              type="button"
              disabled={busy}
              className="jata-btn jata-btn-ghost underline"
              onClick={() => patch({ isPublished: false }, "Unpublished. Your page is now a private draft.")}
            >
              Unpublish page
            </button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function EditSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <details
      className="jata-surface"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== open) onToggle(next);
      }}
    >
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold">{title}</summary>
      <div className="border-t border-[color:var(--jata-line)] px-4 pb-4">{children}</div>
    </details>
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
    <div className="mt-3 space-y-2">
      <Field id={`${business.id}-name`} label="Business name">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field id={`${business.id}-category`} label="Category">
        <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
      </Field>
      <Field id={`${business.id}-phone`} label="Phone">
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field id={`${business.id}-whatsapp`} label="WhatsApp">
        <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
      </Field>
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
          setProblem(p);
          if (!p) void onSave({ ...form, whatsapp: form.whatsapp || form.phone });
        }}
      >
        Save profile
      </Button>
    </div>
  );
}

function ServiceManager({ businessId, onSaved }: { businessId: string; onSaved: () => void }) {
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
    <div className="mt-3 space-y-2">
      <Field id={`${businessId}-service`} label="Service or product">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${businessId}-service-price`} label="Price label" hint="For example From KES 1,500.">
        <input value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Button loading={saving} onClick={add}>
        Add service
      </Button>
      <NoticeBar notice={msg} />
    </div>
  );
}

function OfferManager({ businessId, onSaved }: { businessId: string; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
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
    <div className="mt-3 space-y-2">
      <Field id={`${businessId}-offer`} label="Offer title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${businessId}-offer-sub`} label="Offer detail">
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </Field>
      <Button loading={saving} onClick={save}>
        Save offer
      </Button>
      <NoticeBar notice={msg} />
    </div>
  );
}
